import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.draws.services import execute_draw, move_player_to_team
from apps.matches.models import Confirmation
from apps.matches.services import set_confirmation
from common.permissions import ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import MatchFactory, MembershipFactory, OrganizationFactory, PlayerFactory


def authenticated_client(user, organization=None):
    client = APIClient()
    access = str(RefreshToken.for_user(user).access_token)
    headers = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
    if organization is not None:
        headers["HTTP_X_ORGANIZATION_ID"] = str(organization.id)
    client.credentials(**headers)
    return client


def confirm_players(match, players):
    for player in players:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)


@pytest.mark.django_db
def test_execute_draw_logs_draw_created():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)

    draw = execute_draw(match=match)

    log = AuditLog.objects.get(action=AuditLog.Action.DRAW_CREATED, draw=draw)
    assert log.organization_id == org.id
    assert log.match_id == match.id
    assert log.after["players_count"] == 6


@pytest.mark.django_db
def test_move_player_logs_team_from_and_team_to():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)

    team_player = draw.teams.first().team_players.first()
    source_team = team_player.team
    target_team = draw.teams.exclude(id=source_team.id).first()

    move_player_to_team(
        draw=draw, team_player_id=team_player.id, target_team_id=target_team.id, reason="ajuste manual"
    )

    log = AuditLog.objects.get(action=AuditLog.Action.PLAYER_MOVED, player=team_player.player)
    assert log.team_from_id == source_team.id
    assert log.team_to_id == target_team.id
    assert log.before["team_id"] == source_team.id
    assert log.before["team_name"] == source_team.name
    assert log.after["team_id"] == target_team.id
    assert log.after["team_name"] == target_team.name
    assert log.reason == "ajuste manual"

    # A trilha guardava **só** o time. A posição é metade do que muda numa
    # movimentação manual, e era justamente a metade que não ficava registrada
    # — sem ela, "João foi para o Time 2" não diz se ele virou zagueiro.
    for state in (log.before, log.after):
        assert "position_id" in state
        assert "position_code" in state
        assert "line_index" in state
        assert "slot_index" in state


@pytest.mark.django_db
def test_confirmation_change_is_logged_only_when_status_actually_changes():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    player = PlayerFactory(organization=org)

    set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
    set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)  # repetido, no-op

    logs = AuditLog.objects.filter(action=AuditLog.Action.CONFIRMATION_CHANGED, player=player)
    assert logs.count() == 1
    assert logs.first().after == {"status": "confirmed"}


@pytest.mark.django_db
def test_audit_log_endpoint_is_isolated_per_organization():
    org_a = OrganizationFactory()
    org_b = OrganizationFactory()
    membership_a = MembershipFactory(organization=org_a, role=ROLE_VISUALIZADOR)

    match_a = MatchFactory(organization=org_a, teams_count=2, min_players=4, max_players=10)
    players_a = [PlayerFactory(organization=org_a) for _ in range(4)]
    confirm_players(match_a, players_a)
    execute_draw(match=match_a)

    match_b = MatchFactory(organization=org_b, teams_count=2, min_players=4, max_players=10)
    players_b = [PlayerFactory(organization=org_b) for _ in range(4)]
    confirm_players(match_b, players_b)
    execute_draw(match=match_b)

    client = authenticated_client(membership_a.user, organization=org_a)
    response = client.get("/api/audit-logs/")

    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) > 0
    assert all(entry["match"] == match_a.id for entry in results)


@pytest.mark.django_db
def test_organizador_move_via_api_is_captured_with_ip():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)

    team_player = draw.teams.first().team_players.first()
    target_team = draw.teams.exclude(id=team_player.team_id).first()

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/draws/{draw.id}/move-player/",
        {"team_player_id": team_player.id, "target_team_id": target_team.id},
        format="json",
    )

    assert response.status_code == 200
    log = AuditLog.objects.get(action=AuditLog.Action.PLAYER_MOVED, player_id=team_player.player_id)
    assert log.user_id == membership.user_id
    assert log.ip_address is not None


# --- Ciclo de vida da partida na trilha de auditoria -------------------------


@pytest.mark.django_db
def test_creating_and_editing_a_match_is_audited():
    """O pedido lista "criação de partidas" e "edição de partidas" entre as
    ações auditáveis — antes só o sorteio e a presença eram registrados."""
    from apps.audit.models import AuditLog
    from common.permissions import ROLE_ORGANIZADOR

    from .factories import MembershipFactory, OrganizationFactory
    from .test_roles_and_superadmin import client_for

    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    criada = client.post(
        "/api/matches/",
        {
            "scheduled_date": "2030-05-10",
            "scheduled_time": "21:00",
            "teams_count": 2,
            "min_players_per_team_line": 1,
            "max_players_per_team_line": 6,
        },
        format="json",
    )
    assert criada.status_code == 201
    match_id = criada.json()["id"]

    log_criacao = AuditLog.objects.get(action=AuditLog.Action.MATCH_CREATED)
    assert log_criacao.match_id == match_id
    assert log_criacao.user_id == membership.user_id
    assert log_criacao.after["scheduled_time"] == "21:00:00"

    client.patch(f"/api/matches/{match_id}/", {"location": "Quadra nova"}, format="json")
    client.patch(f"/api/matches/{match_id}/", {"scheduled_time": "19:30"}, format="json")

    edicoes = AuditLog.objects.filter(action=AuditLog.Action.MATCH_UPDATED).order_by("created_at")
    assert edicoes.count() == 2
    # Só o que mudou entra na trilha — um PATCH de local não grava dez campos.
    assert set(edicoes[0].after) == {"location"}
    assert edicoes[1].before["scheduled_time"] == "21:00:00"
    assert edicoes[1].after["scheduled_time"] == "19:30:00"


@pytest.mark.django_db
def test_an_edit_that_changes_nothing_does_not_pollute_the_trail():
    from apps.audit.models import AuditLog
    from common.permissions import ROLE_ORGANIZADOR

    from .factories import MatchFactory, MembershipFactory, OrganizationFactory
    from .test_roles_and_superadmin import client_for

    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, location="Mesma quadra")

    client_for(membership.user, org).patch(
        f"/api/matches/{match.id}/", {"location": "Mesma quadra"}, format="json"
    )

    assert not AuditLog.objects.filter(action=AuditLog.Action.MATCH_UPDATED).exists()


@pytest.mark.django_db
def test_canceling_a_match_is_audited():
    from apps.audit.models import AuditLog
    from common.permissions import ROLE_ORGANIZADOR

    from .factories import MatchFactory, MembershipFactory, OrganizationFactory
    from .test_roles_and_superadmin import client_for

    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org)

    client_for(membership.user, org).post(
        f"/api/matches/{match.id}/cancel/", {"reason": "Chuva"}, format="json"
    )

    log = AuditLog.objects.get(action=AuditLog.Action.MATCH_CANCELED)
    assert log.after["status"] == "canceled"
    assert log.reason == "Chuva"
