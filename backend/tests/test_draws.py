import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.draws.models import Draw, TeamPlayer
from apps.draws.repositories import PairHistoryRepository
from apps.draws.services import execute_draw
from apps.matches.models import Confirmation
from apps.matches.services import set_confirmation
from common.exceptions import InsufficientPlayersError
from common.permissions import ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import (
    MatchFactory,
    MembershipFactory,
    OrganizationFactory,
    PlayerFactory,
    PositionFactory,
)


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
def test_execute_draw_raises_when_below_minimum():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(2)]
    confirm_players(match, players)

    with pytest.raises(InsufficientPlayersError):
        execute_draw(match=match)


@pytest.mark.django_db
def test_execute_draw_creates_teams_and_marks_match_drawn():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org, skill_level=3) for _ in range(6)]
    confirm_players(match, players)

    draw = execute_draw(match=match)

    match.refresh_from_db()
    assert match.status == match.Status.DRAWN
    assert match.draw_executed_at is not None
    assert draw.teams.count() == 2
    assert TeamPlayer.objects.filter(team__draw=draw).count() == 6
    assert draw.is_current is True


@pytest.mark.django_db
def test_redraw_supersedes_previous_draw_but_keeps_history():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)

    first_draw = execute_draw(match=match)
    second_draw = execute_draw(match=match)

    first_draw.refresh_from_db()
    assert first_draw.is_current is False
    assert second_draw.is_current is True
    assert Draw.objects.filter(match=match).count() == 2


@pytest.mark.django_db
def test_execute_draw_puts_the_weakest_players_in_different_teams():
    """A restrição dos piores vale no caminho real (jogadores do banco, posições
    reais, capacidade da partida) — não só no motor puro."""
    org = OrganizationFactory()
    position = PositionFactory(organization=org)
    match = MatchFactory(organization=org, teams_count=3, min_players=6, max_players=12)

    weakest = [
        PlayerFactory(organization=org, primary_position=position, skill_level=1, name=name)
        for name in ("João", "Pedro", "Carlos")
    ]
    others = [
        PlayerFactory(organization=org, primary_position=position, skill_level=4) for _ in range(6)
    ]
    confirm_players(match, weakest + others)

    draw = execute_draw(match=match)

    team_by_player = {
        team_player.player_id: team_player.team_id
        for team_player in TeamPlayer.objects.filter(team__draw=draw)
    }
    teams_of_weakest = {team_by_player[player.id] for player in weakest}
    assert len(teams_of_weakest) == 3


@pytest.mark.django_db
def test_draw_audit_records_the_weakest_split_score():
    org = OrganizationFactory()
    position = PositionFactory(organization=org)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [
        PlayerFactory(organization=org, primary_position=position, skill_level=level)
        for level in (1, 1, 4, 4, 5, 5)
    ]
    confirm_players(match, players)

    draw = execute_draw(match=match)

    log = AuditLog.objects.get(action=AuditLog.Action.DRAW_CREATED, draw=draw)
    assert log.after["score_weakest_split"] == 0
    assert "score_guest_balance" in log.after


@pytest.mark.django_db
def test_pair_history_accumulates_weight_across_draws():
    org = OrganizationFactory()
    position = PositionFactory(organization=org)
    players = [
        PlayerFactory(organization=org, primary_position=position, skill_level=3) for _ in range(4)
    ]

    match1 = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    confirm_players(match1, players)
    execute_draw(match=match1)

    match2 = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    confirm_players(match2, players)
    execute_draw(match=match2)

    history = PairHistoryRepository.compute(organization=org, window=10)
    assert len(history) > 0
    assert all(weight > 0 for weight in history.values())


@pytest.mark.django_db
def test_organizador_can_trigger_manual_draw_via_api():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(f"/api/matches/{match.id}/draw/")

    assert response.status_code == 201
    data = response.json()
    assert len(data["teams"]) == 2
    assert sum(len(team["team_players"]) for team in data["teams"]) == 6


@pytest.mark.django_db
def test_visualizador_cannot_trigger_manual_draw():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(f"/api/matches/{match.id}/draw/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_manual_draw_endpoint_returns_400_when_insufficient_players():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(2)]
    confirm_players(match, players)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(f"/api/matches/{match.id}/draw/")

    assert response.status_code == 400


@pytest.mark.django_db
def test_organizador_can_move_player_between_teams():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)

    team_a, team_b = draw.teams.all()
    team_player = team_a.team_players.first()
    other_team_id = team_b.id if team_player.team_id == team_a.id else team_a.id

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/draws/{draw.id}/move-player/",
        {"team_player_id": team_player.id, "target_team_id": other_team_id},
        format="json",
    )

    assert response.status_code == 200
    team_player.refresh_from_db()
    assert team_player.team_id == other_team_id


@pytest.mark.django_db
def test_moving_a_player_does_not_run_a_new_draw_and_keeps_the_snapshot():
    """Arrastar é correção manual: não nasce `Draw` novo, os scores gravados
    continuam sendo os da execução original e a foto do jogador (posição, nível)
    acompanha ele para o time de destino."""
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)

    team_player = draw.teams.first().team_players.select_related("position_snapshot").first()
    position_before = team_player.position_snapshot_id
    skill_before = team_player.skill_snapshot
    scores_before = (draw.total_score, draw.score_balance, draw.score_repetition)
    target_team = draw.teams.exclude(id=team_player.team_id).first()

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/draws/{draw.id}/move-player/",
        {"team_player_id": team_player.id, "target_team_id": target_team.id},
        format="json",
    )

    assert response.status_code == 200
    assert Draw.objects.filter(match=match).count() == 1

    draw.refresh_from_db()
    assert (draw.total_score, draw.score_balance, draw.score_repetition) == scores_before

    team_player.refresh_from_db()
    assert team_player.team_id == target_team.id
    assert team_player.position_snapshot_id == position_before
    assert team_player.skill_snapshot == skill_before


@pytest.mark.django_db
def test_visualizador_cannot_move_player():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)
    team_player = draw.teams.first().team_players.first()
    other_team = draw.teams.exclude(id=team_player.team_id).first()

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/draws/{draw.id}/move-player/",
        {"team_player_id": team_player.id, "target_team_id": other_team.id},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_cannot_move_player_to_team_from_another_draw():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)

    other_match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    confirm_players(other_match, players)
    other_draw = execute_draw(match=other_match)
    foreign_team = other_draw.teams.first()

    team_player = draw.teams.first().team_players.first()

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/draws/{draw.id}/move-player/",
        {"team_player_id": team_player.id, "target_team_id": foreign_team.id},
        format="json",
    )

    assert response.status_code == 400
