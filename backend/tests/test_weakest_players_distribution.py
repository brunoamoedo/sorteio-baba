"""
Regra dos piores jogadores: com N times, os N jogadores de menor nível têm de
cair em times diferentes — sempre que isso for matematicamente possível.

É uma **restrição**, não um critério a ser negociado com os demais: os testes
aqui verificam que ela vale para vários números de times, com empates de nível,
com posições diferentes, com times de tamanhos diferentes e — o caso que dá
nome ao arquivo — mesmo quando juntar dois dos piores melhoraria o equilíbrio
de estrelas.
"""

from collections import Counter

import pytest

from apps.draws.domain.entities import Player
from apps.draws.domain.scoring import (
    ScoringWeights,
    compute_score,
    minimum_weakest_split_cost,
    weakest_split_cost,
    weakest_tiers,
)
from apps.draws.domain.strategies.simulated_annealing import SimulatedAnnealingStrategy

GOL, ZAG, ME, AT = 1, 2, 3, 4

#: Várias sementes por caso: a têmpera é estocástica e a promessa é "sempre",
#: não "quase sempre". Se alguma semente violar a restrição, o teste quebra.
SEEDS = [1, 2, 3, 7, 11, 42, 99]


def make_players(specs):
    """specs: lista de (skill, primary, secondary) — o índice vira o id."""
    return [
        Player(id=i + 1, skill_level=skill, primary_position_id=primary, secondary_position_id=secondary)
        for i, (skill, primary, secondary) in enumerate(specs)
    ]


def solve_all_seeds(players, teams_count, weights=None, pair_history=None):
    return [
        SimulatedAnnealingStrategy(max_iterations=4000, seed=seed).solve(
            players,
            teams_count=teams_count,
            pair_history=pair_history or {},
            weights=weights or ScoringWeights(),
        )
        for seed in SEEDS
    ]


def teams_of_weakest(players, team_of, count):
    """Times ocupados pelos `count` jogadores de menor nível (desempate por id
    só para escolher um conjunto concreto quando há empate — a asserção de
    separação usa as camadas, não esta lista)."""
    weakest = sorted(range(len(players)), key=lambda i: (players[i].skill_level, players[i].id))[:count]
    return [team_of[i] for i in weakest]


def max_per_team(indices, team_of, teams_count):
    counts = Counter(team_of[i] for i in indices)
    return max([counts.get(team, 0) for team in range(teams_count)])


# --------------------------------------------------------------------------
# 1 a 3 — N times, os N piores em times diferentes
# --------------------------------------------------------------------------


@pytest.mark.parametrize("teams_count", [3, 4, 5])
def test_weakest_players_go_to_different_teams(teams_count):
    # Um jogador de 1 estrela por time (os "piores") e o resto claramente acima.
    specs = [(1, AT, None)] * teams_count + [(4, ZAG, None), (5, AT, None), (3, ME, None)] * teams_count
    players = make_players(specs)

    for solution in solve_all_seeds(players, teams_count):
        teams = teams_of_weakest(players, solution.team_of, teams_count)
        assert sorted(teams) == list(range(teams_count)), (
            f"os {teams_count} piores caíram em {teams} — deveriam ocupar um time cada"
        )


# --------------------------------------------------------------------------
# 4 — empate de nível
# --------------------------------------------------------------------------


def test_tied_weakest_players_are_spread_as_evenly_as_possible():
    """4 jogadores ⭐ para 3 times: é impossível dar um a cada time, mas 2-1-1 é
    obrigatório — nunca 3-1-0."""
    specs = [(1, AT, None)] * 4 + [(3, ZAG, None)] * 4 + [(5, ME, None)] * 4
    players = make_players(specs)
    one_star = [i for i, player in enumerate(players) if player.skill_level == 1]

    for solution in solve_all_seeds(players, teams_count=3):
        assert max_per_team(one_star, solution.team_of, 3) == 2


def test_second_tier_does_not_hide_two_weakest_in_the_same_team():
    """2 jogadores ⭐ e 3 ⭐⭐ para 3 times. "Os 3 piores" inclui um ⭐⭐, mas os
    dois ⭐ continuam tendo de ficar separados — é o que as camadas cumulativas
    de `weakest_tiers` garantem."""
    specs = [(1, AT, None), (1, ZAG, None), (2, ME, None), (2, AT, None), (2, ZAG, None)]
    specs += [(5, AT, None), (5, ZAG, None), (5, ME, None)]
    players = make_players(specs)

    for solution in solve_all_seeds(players, teams_count=3):
        assert solution.team_of[0] != solution.team_of[1]


def test_tie_break_is_not_registration_order():
    """Com todos os piores empatados, quem abre o rodízio muda de sorteio para
    sorteio: a ordem de cadastro não pode ser o critério de desempate."""
    specs = [(1, AT, None)] * 3 + [(4, ZAG, None)] * 6
    players = make_players(specs)

    assignments = {tuple(solution.team_of[:3]) for solution in solve_all_seeds(players, teams_count=3)}
    assert len(assignments) > 1


# --------------------------------------------------------------------------
# 5 a 7 — elenco insuficiente, posições e tamanhos diferentes
# --------------------------------------------------------------------------


def test_fewer_weak_players_than_teams_still_separates_them():
    """2 jogadores ⭐ para 3 times: um time fica sem nenhum (não há como dar um
    a cada), mas os dois nunca podem cair juntos."""
    specs = [(1, AT, None), (1, ZAG, None)] + [(4, ME, None)] * 7
    players = make_players(specs)

    for solution in solve_all_seeds(players, teams_count=3):
        assert solution.team_of[0] != solution.team_of[1]


def test_rule_holds_with_players_of_different_positions():
    """A distribuição por posição é outro critério do score e poderia empurrar
    dois goleiros fracos para o mesmo lado; a separação continua valendo."""
    specs = [
        (1, GOL, None),
        (1, GOL, None),
        (1, ZAG, None),
        (4, ZAG, None),
        (4, ME, None),
        (4, AT, None),
        (5, AT, None),
        (5, ME, None),
        (3, ZAG, None),
    ]
    players = make_players(specs)

    for solution in solve_all_seeds(players, teams_count=3):
        weakest = [0, 1, 2]
        assert sorted(solution.team_of[i] for i in weakest) == [0, 1, 2]


def test_rule_holds_when_teams_have_different_sizes():
    """8 jogadores em 3 times (3-3-2): o time menor não pode virar depósito de
    jogador fraco nem escapar de receber um."""
    specs = [(1, AT, None), (1, ZAG, None), (1, ME, None)] + [(4, AT, None)] * 5
    players = make_players(specs)

    for solution in solve_all_seeds(players, teams_count=3):
        assert sorted(solution.team_of[i] for i in [0, 1, 2]) == [0, 1, 2]
        sizes = sorted(Counter(solution.team_of).values())
        assert sizes == [2, 3, 3]


# --------------------------------------------------------------------------
# 8 — a restrição não é trocada por uma média melhor
# --------------------------------------------------------------------------


def test_weakest_split_is_not_traded_for_a_better_star_balance():
    """5 jogadores em 2 times (3-2), níveis ⭐ ⭐ ⭐⭐⭐⭐ x3.

    Juntar os dois ⭐ dá times de 6 e 8 estrelas (diferença 2); separá-los dá 9 e
    5 (diferença 4). O equilíbrio puro escolheria juntar — e é exatamente isso
    que a restrição proíbe.
    """
    specs = [(1, AT, None), (1, ZAG, None), (4, ME, None), (4, AT, None), (4, ZAG, None)]
    players = make_players(specs)

    for solution in solve_all_seeds(players, teams_count=2):
        assert solution.team_of[0] != solution.team_of[1]

        totals = [0, 0]
        for player, team in zip(players, solution.team_of, strict=True):
            totals[team] += player.skill_level
        assert sorted(totals) == [5, 9]


def test_concentrating_the_weakest_scores_worse_than_spreading_them():
    specs = [(1, AT, None), (1, ZAG, None), (5, ME, None), (5, AT, None)]
    players = make_players(specs)
    weights = ScoringWeights()

    spread = compute_score(players, [0, 1, 1, 0], [False] * 4, 2, {}, weights)
    concentrated = compute_score(players, [0, 0, 1, 1], [False] * 4, 2, {}, weights)

    assert spread.weakest_split == 0
    assert concentrated.weakest_split > 0
    assert spread.total < concentrated.total


# --------------------------------------------------------------------------
# Blocos puros: camadas e piso atingível
# --------------------------------------------------------------------------


def test_weakest_tiers_stops_at_the_first_tier_that_fills_every_team():
    players = make_players([(1, AT, None), (1, ZAG, None), (2, ME, None), (5, AT, None)])

    tiers = weakest_tiers(players, teams_count=2)

    assert tiers == [frozenset({0, 1})]


def test_weakest_tiers_accumulates_levels_until_there_is_one_per_team():
    players = make_players([(1, AT, None), (2, ZAG, None), (2, ME, None), (5, AT, None)])

    tiers = weakest_tiers(players, teams_count=3)

    assert tiers == [frozenset({0}), frozenset({0, 1, 2})]


def test_minimum_cost_is_reachable_and_is_the_floor_of_the_criterion():
    specs = [(1, AT, None)] * 4 + [(3, ZAG, None)] * 4 + [(5, ME, None)] * 4
    players = make_players(specs)
    tiers = weakest_tiers(players, teams_count=3)

    floor = minimum_weakest_split_cost(players, 3, tiers)

    for solution in solve_all_seeds(players, teams_count=3):
        assert weakest_split_cost(solution.team_of, 3, tiers) == pytest.approx(floor)


def test_mensalistas_fill_the_first_teams():
    """**Regra invertida em 11/08/2026.**

    Até aqui os convidados eram *espalhados* entre os times, com um critério
    próprio no algoritmo (`guest_balance`). A regra do produto passou a ser a
    oposta: mensalista tem prioridade nos primeiros times, e o convidado só
    entra depois que eles acabam.

    Aqui: 4 mensalistas e 4 convidados em 2 times de 4 — o time A é todo
    mensalista, o B todo convidado. A garantia é **por construção** (a troca da
    têmpera só acontece entre jogadores do mesmo tipo), não por penalidade que
    o algoritmo pudesse decidir pagar — por isso vale para toda semente."""
    players = [
        Player(id=i + 1, skill_level=3, primary_position_id=AT, secondary_position_id=None, is_guest=i >= 4)
        for i in range(8)
    ]

    for solution in solve_all_seeds(players, teams_count=2):
        convidados_por_time = Counter(solution.team_of[i] for i in range(4, 8))
        assert convidados_por_time[0] == 0, "o primeiro time não pode ter convidado"
        assert convidados_por_time[1] == 4


def test_mensalistas_insuficientes_completam_com_convidados():
    """Faltando mensalista, os primeiros times enchem na ordem e o resto se
    completa — o sorteio nunca falha por falta."""
    players = [
        Player(id=i + 1, skill_level=3, primary_position_id=AT, secondary_position_id=None, is_guest=i >= 3)
        for i in range(8)
    ]

    for solution in solve_all_seeds(players, teams_count=2):
        mensalistas_por_time = Counter(solution.team_of[i] for i in range(3))
        # Time A leva os 4 primeiros: 3 mensalistas + 1 convidado.
        assert mensalistas_por_time[0] == 3
        assert mensalistas_por_time[1] == 0
