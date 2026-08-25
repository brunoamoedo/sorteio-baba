import datetime

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.matches.models import Confirmation, Match
from apps.matches.services import (
    ensure_next_match,
    quick_confirm_names,
    reassign_confirmation,
    set_confirmation,
)
from apps.players.models import Player
from common.exceptions import DomainError
from common.permissions import ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import (
    MatchFactory,
    MembershipFactory,
    OrganizationFactory,
    PlayerFactory,
    PositionFactory,
    RecurringGameFactory,
)


def authenticated_client(user, organization=None):
    client = APIClient()
    access = str(RefreshToken.for_user(user).access_token)
    headers = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
    if organization is not None:
        headers["HTTP_X_ORGANIZATION_ID"] = str(organization.id)
    client.credentials(**headers)
    return client


@pytest.mark.django_db
def test_organizador_can_create_recurring_game():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/recurring-games/",
        {
            "name": "Pelada da Terça",
            "weekday": 1,
            "match_time": "21:00",
            "draw_time": "20:30",
            "teams_count": 2,
            "min_players_per_team_line": 4,
            "max_players_per_team_line": 9,
        },
        format="json",
    )

    assert response.status_code == 201
    # Sem informar `goalkeepers_per_team`, vale o padrão do sistema: 0 goleiros
    # (o goleiro da pelada é fixo e não entra na conta). 2 × 4 = 8; 2 × 9 = 18.
    assert response.json()["goalkeepers_per_team"] == 0
    assert response.json()["min_players"] == 8
    assert response.json()["max_players"] == 18


@pytest.mark.django_db
def test_recurring_game_rejects_min_players_line_above_max():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/recurring-games/",
        {
            "name": "Pelada Inválida",
            "weekday": 1,
            "match_time": "21:00",
            "draw_time": "20:30",
            "teams_count": 4,
            "min_players_per_team_line": 9,
            "max_players_per_team_line": 4,
        },
        format="json",
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_visualizador_cannot_create_recurring_game():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/recurring-games/",
        {
            "name": "Pelada da Terça",
            "weekday": 1,
            "match_time": "21:00",
            "draw_time": "20:30",
            "teams_count": 2,
            "min_players": 10,
            "max_players": 20,
        },
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_ensure_next_match_creates_and_is_idempotent():
    org = OrganizationFactory()
    recurring_game = RecurringGameFactory(organization=org, weekday=2)

    match1 = ensure_next_match(recurring_game)
    match2 = ensure_next_match(recurring_game)

    assert match1 is not None
    assert match1.id == match2.id
    assert match1.scheduled_date.weekday() == 2
    assert Match.objects.filter(recurring_game=recurring_game).count() == 1


@pytest.mark.django_db
def test_ensure_next_match_creates_new_match_after_previous_date_passed():
    org = OrganizationFactory()
    recurring_game = RecurringGameFactory(organization=org, weekday=2)
    past_date = datetime.date.today() - datetime.timedelta(days=14)
    MatchFactory(organization=org, recurring_game=recurring_game, scheduled_date=past_date)

    match = ensure_next_match(recurring_game)

    assert match.scheduled_date > past_date
    assert Match.objects.filter(recurring_game=recurring_game).count() == 2


@pytest.mark.django_db
def test_ensure_next_match_waits_for_configured_generation_window():
    """Com 1 dia de antecedência, a partida só é criada na véspera — não
    semanas antes, como no comportamento padrão."""
    org = OrganizationFactory()
    tomorrow = datetime.date.today() + datetime.timedelta(days=1)
    day_after_tomorrow = datetime.date.today() + datetime.timedelta(days=2)

    far_game = RecurringGameFactory(
        organization=org, weekday=day_after_tomorrow.weekday(), days_before_to_generate=1
    )
    near_game = RecurringGameFactory(
        organization=org, weekday=tomorrow.weekday(), days_before_to_generate=1
    )

    assert ensure_next_match(far_game) is None
    assert Match.objects.filter(recurring_game=far_game).count() == 0

    created = ensure_next_match(near_game)
    assert created is not None
    assert created.scheduled_date == tomorrow


@pytest.mark.django_db
def test_recurring_game_default_generation_window_preserves_previous_behaviour():
    """Sem configurar nada, a próxima partida continua sendo criada assim que
    a anterior passa (recorrência semanal = no máximo 7 dias de distância)."""
    org = OrganizationFactory()
    in_six_days = datetime.date.today() + datetime.timedelta(days=6)
    recurring_game = RecurringGameFactory(organization=org, weekday=in_six_days.weekday())

    assert recurring_game.days_before_to_generate == 7
    match = ensure_next_match(recurring_game)

    assert match is not None
    assert match.scheduled_date == in_six_days


@pytest.mark.django_db
def test_organizador_creates_manual_match_with_per_team_line_bounds():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/matches/",
        {
            "name": "Racha de sábado",
            "location": "Quadra do bairro",
            "notes": "Levar colete",
            "scheduled_date": str(datetime.date.today() + datetime.timedelta(days=2)),
            "scheduled_time": "10:00",
            "draw_time": "09:00",
            "teams_count": 3,
            "min_players_per_team_line": 4,
            "max_players_per_team_line": 6,
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    data = response.json()
    assert data["name"] == "Racha de sábado"
    assert data["recurring_game"] is None
    # Padrão do sistema: 0 goleiros. 3 times × 4 de linha = 12; 3 × 6 = 18.
    assert data["goalkeepers_per_team"] == 0
    assert data["min_players"] == 12
    assert data["max_players"] == 18
    assert data["draw_time"] == "09:00:00"


@pytest.mark.django_db
def test_manual_match_accepts_absolute_totals_without_per_team_line():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/matches/",
        {
            "scheduled_date": str(datetime.date.today()),
            "scheduled_time": "21:00",
            "teams_count": 2,
            "min_players": 10,
            "max_players": 20,
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert response.json()["min_players"] == 10


@pytest.mark.django_db
def test_manual_match_requires_some_player_bounds():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/matches/",
        {
            "scheduled_date": str(datetime.date.today()),
            "scheduled_time": "21:00",
            "teams_count": 2,
        },
        format="json",
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_manual_match_rejects_invalid_configuration():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    base = {
        "scheduled_date": str(datetime.date.today()),
        "scheduled_time": "21:00",
    }

    single_team = client.post(
        "/api/matches/",
        {**base, "teams_count": 1, "min_players_per_team_line": 4, "max_players_per_team_line": 6},
        format="json",
    )
    inverted_bounds = client.post(
        "/api/matches/",
        {**base, "teams_count": 2, "min_players_per_team_line": 8, "max_players_per_team_line": 4},
        format="json",
    )

    assert single_team.status_code == 400
    assert inverted_bounds.status_code == 400


@pytest.mark.django_db
def test_manual_match_cannot_link_recurring_game_from_another_organization():
    org = OrganizationFactory()
    other_org = OrganizationFactory()
    foreign_game = RecurringGameFactory(organization=other_org)
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/matches/",
        {
            "recurring_game": foreign_game.id,
            "scheduled_date": str(datetime.date.today()),
            "scheduled_time": "21:00",
            "teams_count": 2,
            "min_players": 10,
            "max_players": 20,
        },
        format="json",
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_visualizador_cannot_create_or_delete_match():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    match = MatchFactory(organization=org)
    client = authenticated_client(membership.user, organization=org)

    created = client.post(
        "/api/matches/",
        {
            "scheduled_date": str(datetime.date.today()),
            "scheduled_time": "21:00",
            "teams_count": 2,
            "min_players": 10,
            "max_players": 20,
        },
        format="json",
    )
    deleted = client.delete(f"/api/matches/{match.id}/")

    assert created.status_code == 403
    assert deleted.status_code == 403


@pytest.mark.django_db
def test_organizador_updates_and_soft_deletes_match():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org)
    client = authenticated_client(membership.user, organization=org)

    updated = client.patch(
        f"/api/matches/{match.id}/",
        {"name": "Amistoso", "location": "Society do Zé"},
        format="json",
    )
    deleted = client.delete(f"/api/matches/{match.id}/")

    assert updated.status_code == 200
    assert updated.json()["name"] == "Amistoso"
    assert deleted.status_code == 204
    assert not Match.objects.filter(id=match.id).exists()
    assert Match.all_objects.get(id=match.id).is_deleted is True


@pytest.mark.django_db
def test_set_confirmation_sets_and_clears_confirmed_at():
    org = OrganizationFactory()
    match = MatchFactory(organization=org)
    player = PlayerFactory(organization=org)

    outcome = set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
    assert outcome.waitlisted is False
    assert outcome.confirmation.confirmed_at is not None

    outcome = set_confirmation(match=match, player=player, status=Confirmation.Status.DECLINED)
    assert outcome.confirmation.confirmed_at is None
    assert Confirmation.objects.filter(match=match, player=player).count() == 1


@pytest.mark.django_db
def test_set_all_confirmations_confirms_every_active_player():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org)
    ativos = [PlayerFactory(organization=org) for _ in range(3)]
    inativo = PlayerFactory(organization=org, status=Player.Status.INATIVO)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/matches/{match.id}/set-all-confirmations/", {"status": "confirmed"}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["updated"] == 3
    for player in ativos:
        assert Confirmation.objects.get(match=match, player=player).status == Confirmation.Status.CONFIRMED
    assert not Confirmation.objects.filter(match=match, player=inativo).exists()


@pytest.mark.django_db
def test_set_all_confirmations_can_clear_everyone():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org)
    player = PlayerFactory(organization=org)
    set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/matches/{match.id}/set-all-confirmations/", {"status": "declined"}, format="json"
    )

    assert response.status_code == 200
    confirmation = Confirmation.objects.get(match=match, player=player)
    assert confirmation.status == Confirmation.Status.DECLINED
    assert confirmation.confirmed_at is None


@pytest.mark.django_db
def test_set_all_confirmations_does_not_touch_other_organizations():
    org = OrganizationFactory()
    other_org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org)
    PlayerFactory(organization=org)
    foreign_player = PlayerFactory(organization=other_org)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/matches/{match.id}/set-all-confirmations/", {"status": "confirmed"}, format="json"
    )

    assert response.json()["updated"] == 1
    assert not Confirmation.objects.filter(player=foreign_player).exists()


@pytest.mark.django_db
def test_visualizador_cannot_set_all_confirmations():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    match = MatchFactory(organization=org)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/matches/{match.id}/set-all-confirmations/", {"status": "confirmed"}, format="json"
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_roster_endpoint_lists_active_players_with_confirmation_status():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org)
    confirmed_player = PlayerFactory(organization=org, name="Confirmado")
    PlayerFactory(organization=org, name="Pendente")
    set_confirmation(match=match, player=confirmed_player, status=Confirmation.Status.CONFIRMED)

    client = authenticated_client(membership.user, organization=org)
    response = client.get(f"/api/matches/{match.id}/roster/")

    assert response.status_code == 200
    by_name = {row["player"]["name"]: row["confirmation_status"] for row in response.json()}
    assert by_name["Confirmado"] == "confirmed"
    assert by_name["Pendente"] == "pending"


@pytest.mark.django_db
def test_set_confirmation_endpoint_requires_organizer_role():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    match = MatchFactory(organization=org)
    player = PlayerFactory(organization=org)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/matches/{match.id}/set-confirmation/",
        {"player": player.id, "status": "confirmed"},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_dashboard_summary_returns_next_match_and_player_counts():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org)
    PlayerFactory(organization=org, player_type="mensalista", status="ativo")
    PlayerFactory(organization=org, player_type="convidado", status="ativo")
    match = MatchFactory(
        organization=org,
        scheduled_date=datetime.date.today() + datetime.timedelta(days=1),
        status=Match.Status.SCHEDULED,
    )

    client = authenticated_client(membership.user, organization=org)
    response = client.get("/api/dashboard/summary/")

    assert response.status_code == 200
    data = response.json()
    assert data["next_match"]["id"] == match.id
    assert data["players"]["ativos"] == 2
    assert data["players"]["mensalistas"] == 1
    assert data["players"]["convidados"] == 1


@pytest.mark.django_db
def test_quick_confirm_names_matches_mensalista_despite_typo():
    org = OrganizationFactory()
    match = MatchFactory(organization=org)
    mensalista = PlayerFactory(organization=org, name="Felipe Santiago Firmino", player_type="mensalista")

    results = quick_confirm_names(match=match, raw_names=["felipe firmino"])

    assert len(results) == 1
    assert results[0]["resolution"] == "mensalista"
    assert results[0]["player_id"] == mensalista.id
    assert Confirmation.objects.get(match=match, player=mensalista).status == Confirmation.Status.CONFIRMED


@pytest.mark.django_db
def test_quick_confirm_names_does_not_cross_match_on_shared_surname():
    org = OrganizationFactory()
    match = MatchFactory(organization=org)
    position = PositionFactory(organization=org)
    correct = PlayerFactory(
        organization=org, name="Isaac Rodrigues Marocas", player_type="mensalista", primary_position=position
    )
    PlayerFactory(organization=org, name="Irmão marocas", player_type="mensalista", primary_position=position)

    results = quick_confirm_names(match=match, raw_names=["Isak Marocas"])

    assert results[0]["resolution"] == "mensalista"
    assert results[0]["player_id"] == correct.id


@pytest.mark.django_db
def test_quick_confirm_names_creates_convidado_when_no_mensalista_matches():
    org = OrganizationFactory()
    match = MatchFactory(organization=org)
    position = PositionFactory(organization=org)
    PlayerFactory(organization=org, name="Aderval", player_type="mensalista", primary_position=position)

    results = quick_confirm_names(match=match, raw_names=["Zé da Padaria"])

    assert len(results) == 1
    assert results[0]["resolution"] == "convidado_criado"
    created = Player.objects.get(id=results[0]["player_id"])
    assert created.name == "Zé da Padaria"
    assert created.player_type == Player.PlayerType.CONVIDADO
    assert Confirmation.objects.get(match=match, player=created).status == Confirmation.Status.CONFIRMED


@pytest.mark.django_db
def test_reassign_confirmation_fixes_wrongly_created_convidado():
    org = OrganizationFactory()
    match = MatchFactory(organization=org)
    position = PositionFactory(organization=org)
    correct_mensalista = PlayerFactory(
        organization=org, name="Isaac Rodrigues Marocas", player_type="mensalista", primary_position=position
    )

    results = quick_confirm_names(match=match, raw_names=["Fulano Desconhecido"])
    wrong_player = Player.objects.get(id=results[0]["player_id"])
    assert results[0]["resolution"] == "convidado_criado"

    reassign_confirmation(match=match, wrong_player=wrong_player, correct_player=correct_mensalista)

    assert Confirmation.objects.get(match=match, player=correct_mensalista).status == Confirmation.Status.CONFIRMED
    assert Confirmation.objects.get(match=match, player=wrong_player).status == Confirmation.Status.DECLINED
    assert not Player.objects.filter(id=wrong_player.id).exists()


@pytest.mark.django_db
def test_reassign_confirmation_refuses_a_mensalista_already_in_the_match():
    """Corrigir para alguém que já está confirmado não corrigiria nada: o
    convidado errado sairia, o mensalista continuaria onde estava e a partida
    perderia uma vaga em silêncio."""
    org = OrganizationFactory()
    match = MatchFactory(organization=org)
    position = PositionFactory(organization=org)
    ja_confirmado = PlayerFactory(
        organization=org, name="Isaac Rodrigues Marocas", player_type="mensalista", primary_position=position
    )
    set_confirmation(match=match, player=ja_confirmado, status=Confirmation.Status.CONFIRMED)

    results = quick_confirm_names(match=match, raw_names=["Fulano Desconhecido"])
    wrong_player = Player.objects.get(id=results[0]["player_id"])

    with pytest.raises(DomainError):
        reassign_confirmation(match=match, wrong_player=wrong_player, correct_player=ja_confirmado)

    # Nada foi desfeito: o convidado errado continua confirmado até que a
    # correção aponte para alguém que realmente está fora.
    assert Confirmation.objects.get(match=match, player=wrong_player).status == Confirmation.Status.CONFIRMED


@pytest.mark.django_db
def test_quick_confirm_endpoint_requires_organizer_role():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    match = MatchFactory(organization=org)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/matches/{match.id}/quick-confirm/",
        {"names": ["Aderval"]},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_match_api_exposes_automatic_draw_criteria():
    """A interface lê o critério do sorteio automático da API — nunca deduz de
    `draw_time`/`recurring_game` por conta própria."""
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    recurring_game = RecurringGameFactory(organization=org, draw_time=datetime.time(20, 30))
    from_recurring = MatchFactory(organization=org, recurring_game=recurring_game, draw_time=None)
    standalone = MatchFactory(organization=org, recurring_game=None, draw_time=None)

    payload = {match["id"]: match for match in client.get("/api/matches/").json()["results"]}

    recurring_payload = payload[from_recurring.id]
    assert recurring_payload["automatic_draw"] is True
    assert recurring_payload["automatic_draw_source"] == "recurring_game"
    assert recurring_payload["effective_draw_time"] == "20:30:00"
    assert recurring_payload["automatic_draw_at"] is not None

    standalone_payload = payload[standalone.id]
    assert standalone_payload["automatic_draw"] is False
    assert standalone_payload["automatic_draw_source"] is None
    assert standalone_payload["effective_draw_time"] is None
    assert standalone_payload["automatic_draw_at"] is None
