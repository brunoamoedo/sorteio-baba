from apps.draws.domain.entities import Player
from apps.draws.domain.scoring import ScoringWeights, compute_score
from apps.draws.domain.strategies.simulated_annealing import SimulatedAnnealingStrategy

GOL, ZAG, ME, AT = 1, 2, 3, 4


def make_players(specs):
    """specs: list of (skill, primary, secondary)"""
    return [
        Player(id=i + 1, skill_level=skill, primary_position_id=primary, secondary_position_id=secondary)
        for i, (skill, primary, secondary) in enumerate(specs)
    ]


def test_balance_score_is_zero_when_teams_have_equal_skill():
    players = make_players([(5, AT, None), (5, ZAG, None), (3, AT, None), (3, ZAG, None)])
    team_of = [0, 1, 0, 1]  # time 0: 5+3=8, time 1: 5+3=8
    score = compute_score(players, team_of, [False] * 4, 2, {}, ScoringWeights())
    assert score.balance == 0


def test_time_menor_mira_parte_proporcional_e_nao_a_mesma_soma():
    """Times de tamanhos diferentes não devem perseguir a mesma soma.

    Com 3 jogadores num time e 2 no outro, somas iguais obrigam o time menor a
    levar os melhores — era assim que os craques acabavam sempre no último
    time (o que fica com o resto da divisão). O alvo certo é proporcional ao
    tamanho: 5 jogadores somando 15 dão 3 por jogador, logo 9 e 6.
    """
    players = make_players(
        [(5, AT, None), (5, ZAG, None), (2, AT, None), (2, ZAG, None), (1, AT, None)]
    )
    proporcional = [0, 1, 0, 1, 0]  # time 0: 5+2+1=8 (3 jog.), time 1: 5+2=7 (2 jog.)
    somas_iguais = [0, 0, 1, 1, 1]  # time 0: 5+5=10 (2 jog.), time 1: 2+2+1=5 (3 jog.)

    def balance(team_of):
        return compute_score(players, team_of, [False] * 5, 2, {}, ScoringWeights()).balance

    assert balance(proporcional) < balance(somas_iguais)


def test_position_cost_ignores_teams_without_scarce_specialist():
    # 2 goleiros para 4 times: distribuídos em times diferentes não deve ser penalizado
    players = make_players([(3, GOL, None), (3, GOL, None), (3, AT, None), (3, AT, None)])
    team_of = [0, 1, 2, 3]
    score = compute_score(players, team_of, [False] * 4, 4, {}, ScoringWeights())
    assert score.position == 0


def test_position_cost_penalizes_concentration_of_scarce_specialists():
    players = make_players([(3, GOL, None), (3, GOL, None), (3, AT, None), (3, AT, None)])
    team_of_spread = [0, 1, 2, 3]
    team_of_concentrated = [0, 0, 2, 3]

    score_spread = compute_score(players, team_of_spread, [False] * 4, 4, {}, ScoringWeights())
    score_concentrated = compute_score(
        players, team_of_concentrated, [False] * 4, 4, {}, ScoringWeights()
    )
    assert score_concentrated.position > score_spread.position


def test_simulated_annealing_balances_team_skill():
    # soma total 20, times de 3 jogadores cada: um split perfeito 10-10 existe
    # (5+4+1 de cada lado), então o SA deve encontrá-lo.
    specs = [
        (5, AT, None),
        (5, ZAG, None),
        (4, ME, None),
        (4, GOL, None),
        (1, AT, None),
        (1, ZAG, None),
    ]
    players = make_players(specs)

    strategy = SimulatedAnnealingStrategy(max_iterations=3000, seed=42)
    solution = strategy.solve(players, teams_count=2, pair_history={}, weights=ScoringWeights())

    team_totals = [0, 0]
    for player, team in zip(players, solution.team_of, strict=True):
        team_totals[team] += player.skill_level

    assert abs(team_totals[0] - team_totals[1]) <= 1


def test_simulated_annealing_avoids_repeated_pairs_when_possible():
    specs = [(3, AT, None) for _ in range(8)]
    players = make_players(specs)
    # jogadores 1 e 2 jogaram muito juntos recentemente
    pair_history = {(1, 2): 100.0}

    strategy = SimulatedAnnealingStrategy(max_iterations=5000, seed=7)
    solution = strategy.solve(players, teams_count=2, pair_history=pair_history, weights=ScoringWeights())

    team_by_id = {player.id: team for player, team in zip(players, solution.team_of, strict=True)}
    assert team_by_id[1] != team_by_id[2]


def test_simulated_annealing_is_deterministic_given_a_seed():
    specs = [(3, AT, None), (4, ZAG, None), (2, GOL, None), (5, ME, None), (1, AT, None), (3, ZAG, None)]
    players = make_players(specs)

    strategy_a = SimulatedAnnealingStrategy(max_iterations=1000, seed=99)
    strategy_b = SimulatedAnnealingStrategy(max_iterations=1000, seed=99)

    solution_a = strategy_a.solve(players, teams_count=2, pair_history={}, weights=ScoringWeights())
    solution_b = strategy_b.solve(players, teams_count=2, pair_history={}, weights=ScoringWeights())

    assert solution_a.team_of == solution_b.team_of
    assert solution_a.score.total == solution_b.score.total


def test_simulated_annealing_uses_secondary_position_to_relieve_concentration():
    # 3 goleiros natos para 2 times: pelo menos um time terá 2 goleiros a
    # menos que um deles seja realocado via posição secundária.
    specs = [
        (3, GOL, ZAG),
        (3, GOL, None),
        (3, GOL, None),
        (3, AT, None),
    ]
    players = make_players(specs)

    weights = ScoringWeights(balance=0.1, position=5.0, secondary_usage=0.05)
    strategy = SimulatedAnnealingStrategy(max_iterations=6000, seed=3)
    solution = strategy.solve(players, teams_count=2, pair_history={}, weights=weights)

    assert solution.use_secondary[0] is True
