import datetime

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.draws.models import Draw, Team, TeamPlayer, TeamResult
from apps.matches.models import Confirmation
from apps.statistics.services import get_player_statistics
from common.permissions import ROLE_VISUALIZADOR

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


def build_draw(org, match, assignments):
    """assignments: list of (player, skill, result) — cada um vira um time
    de um único jogador, simples o bastante para controlar o resultado."""
    position = PositionFactory(organization=org)
    draw = Draw.objects.create(
        organization=org,
        match=match,
        score_balance=0,
        score_position=0,
        score_repetition=0,
        total_score=0,
        iterations_run=1,
        is_current=True,
    )
    for index, (player, skill, result) in enumerate(assignments):
        team = Team.objects.create(draw=draw, name=f"Time {index}", order_index=index)
        TeamPlayer.objects.create(team=team, player=player, position_snapshot=position, skill_snapshot=skill)
        if result:
            TeamResult.objects.create(team=team, result=result)
    return draw


@pytest.mark.django_db
def test_player_statistics_computes_wins_losses_and_streaks():
    org = OrganizationFactory()
    player = PlayerFactory(organization=org, name="Fulano")
    opponent = PlayerFactory(organization=org, name="Sicrano")

    match1 = MatchFactory(organization=org, scheduled_date=datetime.date(2026, 1, 1))
    build_draw(org, match1, [(player, 3, "win"), (opponent, 3, "loss")])

    match2 = MatchFactory(organization=org, scheduled_date=datetime.date(2026, 1, 8))
    build_draw(org, match2, [(player, 4, "win"), (opponent, 4, "loss")])

    match3 = MatchFactory(organization=org, scheduled_date=datetime.date(2026, 1, 15))
    build_draw(org, match3, [(player, 5, "loss"), (opponent, 5, "win")])

    stats = {s["player_id"]: s for s in get_player_statistics(org)}
    player_stats = stats[player.id]

    assert player_stats["matches_played"] == 3
    assert player_stats["wins"] == 2
    assert player_stats["losses"] == 1
    assert player_stats["win_rate"] == pytest.approx(2 / 3)
    assert player_stats["longest_win_streak"] == 2
    assert player_stats["current_streak_type"] == "loss"
    assert player_stats["current_streak_length"] == 1
    assert player_stats["avg_team_skill"] == pytest.approx((3 + 4 + 5) / 3, abs=0.1)
    assert player_stats["last_match_date"] == datetime.date(2026, 1, 15)


@pytest.mark.django_db
def test_player_statistics_tracks_presences_and_absences():
    org = OrganizationFactory()
    player = PlayerFactory(organization=org)
    match1 = MatchFactory(organization=org)
    match2 = MatchFactory(organization=org)

    Confirmation.objects.create(match=match1, player=player, status=Confirmation.Status.CONFIRMED)
    Confirmation.objects.create(match=match2, player=player, status=Confirmation.Status.DECLINED)

    stats = {s["player_id"]: s for s in get_player_statistics(org)}
    assert stats[player.id]["presences"] == 1
    assert stats[player.id]["absences"] == 1


@pytest.mark.django_db
def test_player_with_no_matches_has_null_aggregates():
    org = OrganizationFactory()
    player = PlayerFactory(organization=org)

    stats = {s["player_id"]: s for s in get_player_statistics(org)}
    player_stats = stats[player.id]

    assert player_stats["matches_played"] == 0
    assert player_stats["win_rate"] is None
    assert player_stats["avg_team_skill"] is None
    assert player_stats["last_match_date"] is None


@pytest.mark.django_db
def test_statistics_endpoint_is_readable_by_visualizador():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    PlayerFactory(organization=org)

    client = authenticated_client(membership.user, organization=org)
    response = client.get("/api/statistics/players/")

    assert response.status_code == 200
    assert len(response.json()) == 1
