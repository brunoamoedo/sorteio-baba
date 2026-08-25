import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.draws.models import TeamResult
from apps.draws.services import execute_draw, set_match_results
from apps.matches.models import Confirmation, Match
from apps.matches.services import set_confirmation
from common.exceptions import DomainError
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
def test_set_match_results_creates_team_results_and_completes_match():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)
    team_a, team_b = draw.teams.all()

    # Só os gols são informados — vitória/derrota e `goals_conceded` são
    # derivados no servidor.
    set_match_results(
        match=match,
        results=[
            {"team_id": team_a.id, "goals_scored": 3},
            {"team_id": team_b.id, "goals_scored": 1},
        ],
    )

    match.refresh_from_db()
    assert match.status == Match.Status.COMPLETED
    assert TeamResult.objects.get(team=team_a).result == "win"
    assert TeamResult.objects.get(team=team_b).result == "loss"
    assert TeamResult.objects.get(team=team_a).goals_conceded == 1
    assert TeamResult.objects.get(team=team_b).goals_conceded == 3


@pytest.mark.django_db
def test_set_match_results_derives_draw_from_equal_goals():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)
    team_a, team_b = draw.teams.all()

    set_match_results(
        match=match,
        results=[
            {"team_id": team_a.id, "goals_scored": 2},
            {"team_id": team_b.id, "goals_scored": 2},
        ],
    )

    assert TeamResult.objects.get(team=team_a).result == "draw"
    assert TeamResult.objects.get(team=team_b).result == "draw"


@pytest.mark.django_db
def test_set_match_results_requires_every_team():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)
    team_a = draw.teams.first()

    with pytest.raises(DomainError):
        set_match_results(match=match, results=[{"team_id": team_a.id, "goals_scored": 1}])

    match.refresh_from_db()
    assert match.status != Match.Status.COMPLETED


@pytest.mark.django_db
def test_set_match_results_rejects_team_from_another_draw():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)
    team_a, team_b = draw.teams.all()

    with pytest.raises(DomainError):
        set_match_results(
            match=match,
            results=[
                {"team_id": team_a.id, "goals_scored": 1},
                {"team_id": team_b.id, "goals_scored": 0},
                {"team_id": 999_999, "goals_scored": 5},
            ],
        )


@pytest.mark.django_db
def test_set_match_results_is_idempotent_via_update_or_create():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)
    team_a, team_b = draw.teams.all()

    def send(goals_a, goals_b):
        set_match_results(
            match=match,
            results=[
                {"team_id": team_a.id, "goals_scored": goals_a},
                {"team_id": team_b.id, "goals_scored": goals_b},
            ],
        )

    send(1, 1)
    send(3, 0)

    assert TeamResult.objects.filter(team=team_a).count() == 1
    assert TeamResult.objects.get(team=team_a).result == "win"
    assert TeamResult.objects.get(team=team_a).goals_scored == 3


@pytest.mark.django_db
def test_organizador_can_set_results_via_api():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm_players(match, players)
    draw = execute_draw(match=match)
    team_a, team_b = draw.teams.all()

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        f"/api/matches/{match.id}/set-results/",
        {
            "results": [
                {"team_id": team_a.id, "goals_scored": 2},
                {"team_id": team_b.id, "goals_scored": 1},
            ]
        },
        format="json",
    )

    assert response.status_code == 200
    match.refresh_from_db()
    assert match.status == Match.Status.COMPLETED


@pytest.mark.django_db
def test_visualizador_cannot_set_results():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(f"/api/matches/{match.id}/set-results/", {"results": []}, format="json")

    assert response.status_code == 403
