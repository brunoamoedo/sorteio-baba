"""Goleiros por time configuráveis.

Contexto: a capacidade sempre somava 1 goleiro fixo por time. Numa pelada em
que o goleiro é fixo (não é sorteado, muitas vezes nem está cadastrado como
jogador), 2 times × 6 de linha virava 14 vagas e o sorteio devolvia **7 de
linha por time** — a vaga do goleiro era ocupada por mais um jogador de linha.
Com `goalkeepers_per_team=0` a partida passa a contar só jogadores de linha.
"""

import pytest

from apps.draws.services import execute_draw
from apps.matches.models import Confirmation, Match, RecurringGame, compute_player_bounds
from apps.matches.services import ensure_next_match, get_match_capacity, set_confirmation
from common.permissions import ROLE_ORGANIZADOR

from .factories import MatchFactory, MembershipFactory, OrganizationFactory, PlayerFactory
from .test_matches import authenticated_client


@pytest.mark.parametrize(
    ("goalkeepers", "expected_min", "expected_max"),
    [(1, 14, 20), (0, 12, 18), (2, 16, 22)],
)
def test_compute_player_bounds_honors_goalkeepers_per_team(goalkeepers, expected_min, expected_max):
    assert compute_player_bounds(
        teams_count=2,
        min_players_per_team_line=6,
        max_players_per_team_line=9,
        goalkeepers_per_team=goalkeepers,
    ) == (expected_min, expected_max)


@pytest.mark.django_db
def test_capacity_without_goalkeeper_counts_only_line_players():
    org = OrganizationFactory()
    match = MatchFactory(
        organization=org, teams_count=2, goalkeepers_per_team=0, min_players=4, max_players=12
    )

    capacity = get_match_capacity(match)

    assert capacity.goalkeepers_per_team == 0
    assert capacity.total_goalkeepers == 0
    assert capacity.line_players_per_team == 6
    assert capacity.total_line_players == 12
    assert capacity.max_players == 12


@pytest.mark.django_db
def test_draw_gives_six_line_players_per_team_when_goalkeeper_is_fixed():
    """O caso relatado: 2 times × 6 de linha, goleiro fixo fora do sorteio.
    Antes saíam 7 por time (14 vagas); agora saem 6 e 6."""
    org = OrganizationFactory()
    match = MatchFactory(
        organization=org, teams_count=2, goalkeepers_per_team=0, min_players=4, max_players=12
    )
    players = [PlayerFactory(organization=org) for _ in range(12)]
    for player in players:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    draw = execute_draw(match=match)

    assert sorted(team.team_players.count() for team in draw.teams.all()) == [6, 6]


@pytest.mark.django_db
def test_extra_confirmations_go_to_waitlist_when_goalkeeper_is_fixed():
    """A vaga do goleiro deixa de existir: quem confirmaria nela vai para a
    fila, em vez de virar um 7º jogador de linha."""
    org = OrganizationFactory()
    match = MatchFactory(
        organization=org, teams_count=2, goalkeepers_per_team=0, min_players=4, max_players=12
    )
    outcomes = [
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
        for _ in range(14)
    ]

    assert [outcome.waitlisted for outcome in outcomes].count(True) == 2


@pytest.mark.django_db
def test_recurring_game_recomputes_totals_and_propagates_to_generated_match():
    org = OrganizationFactory()
    recurring_game = RecurringGame.objects.create(
        organization=org,
        name="Pelada de goleiro fixo",
        weekday=1,
        match_time="21:00",
        draw_time="20:30",
        teams_count=2,
        min_players_per_team_line=6,
        max_players_per_team_line=6,
        goalkeepers_per_team=0,
    )

    assert (recurring_game.min_players, recurring_game.max_players) == (12, 12)

    match = ensure_next_match(recurring_game, force=True)

    assert match is not None
    assert match.goalkeepers_per_team == 0
    assert match.capacity.line_players_per_team == 6
    assert match.max_players == 12


@pytest.mark.django_db
def test_new_matches_default_to_no_goalkeeper():
    """Padrão do sistema: **0 goleiros**. Na prática o goleiro da pelada é fixo,
    não é sorteado e muitas vezes nem está cadastrado — reservar uma vaga para
    ele inflava a partida e travava o sorteio esperando gente que não existe.

    Quem tem goleiro cadastrado e quer a vaga reservada configura 1 no jogo
    recorrente ou na partida."""
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=12)

    assert match.goalkeepers_per_team == 0
    assert match.capacity.line_players_per_team == 6
    assert match.capacity.total_goalkeepers == 0

    com_goleiro = MatchFactory(
        organization=org, teams_count=2, goalkeepers_per_team=1, min_players=4, max_players=14
    )
    assert com_goleiro.capacity.line_players_per_team == 6
    assert com_goleiro.capacity.total_goalkeepers == 2


@pytest.mark.django_db
def test_api_creates_manual_match_without_goalkeeper():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/matches/",
        {
            "scheduled_date": "2030-01-05",
            "scheduled_time": "21:00",
            "teams_count": 2,
            "goalkeepers_per_team": 0,
            "min_players_per_team_line": 1,
            "max_players_per_team_line": 6,
        },
        format="json",
    )

    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["goalkeepers_per_team"] == 0
    assert body["max_players"] == 12
    assert body["capacity"]["line_players_per_team"] == 6
    assert body["capacity"]["total_goalkeepers"] == 0


@pytest.mark.django_db
def test_api_rejects_more_goalkeepers_than_line_players():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/recurring-games/",
        {
            "name": "Configuração absurda",
            "weekday": 1,
            "match_time": "21:00",
            "draw_time": "20:30",
            "teams_count": 2,
            "min_players_per_team_line": 4,
            "max_players_per_team_line": 6,
            "goalkeepers_per_team": 9,
        },
        format="json",
    )

    assert response.status_code == 400
    assert "goalkeepers_per_team" in response.json()


@pytest.mark.django_db
def test_changing_goalkeepers_on_recurring_game_reaches_the_future_match():
    """Alterar os goleiros por time no jogo recorrente realinha a partida futura
    ainda não sorteada — inclusive o total recalculado."""
    org = OrganizationFactory()
    recurring_game = RecurringGame.objects.create(
        organization=org,
        name="Pelada",
        weekday=1,
        match_time="21:00",
        draw_time="20:30",
        teams_count=2,
        min_players_per_team_line=6,
        max_players_per_team_line=6,
        goalkeepers_per_team=1,
    )
    match = ensure_next_match(recurring_game, force=True)
    assert match.status == Match.Status.SCHEDULED
    assert (match.goalkeepers_per_team, match.max_players) == (1, 14)

    recurring_game.goalkeepers_per_team = 0
    recurring_game.save()
    match.refresh_from_db()

    assert match.goalkeepers_per_team == 0
    assert match.max_players == 12
    assert match.capacity.line_players_per_team == 6
    assert match.recurring_game_divergences == []
