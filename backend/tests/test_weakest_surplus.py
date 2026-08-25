"""A sobra dos mais fracos vai para o último time.

A separação dos piores (restrição dura) garante que eles fiquem espalhados,
mas quando há mais fracos que times alguém leva dois. Qual time levava era
indiferente para o custo, então caía no aleatório. A decisão de produto é que
o excedente vá para o **último** time: ele absorve a sobra e os demais ficam
parelhos entre si.

A regra vale **só quando há sobra**. Com fracos suficientes para um por time e
nada além, o sorteio segue como sempre foi.
"""

from collections import Counter

import pytest

from apps.draws.domain.entities import Player
from apps.draws.domain.scoring import ScoringWeights, weakest_surplus_cost, weakest_tiers
from apps.draws.domain.strategies.simulated_annealing import SimulatedAnnealingStrategy

GOL, ZAG, ME, AT = 1, 2, 3, 4


def elenco(niveis: list[int]) -> list[Player]:
    posicoes = [ZAG, ME, AT]
    return [
        Player(
            id=i + 1,
            skill_level=nivel,
            primary_position_id=posicoes[i % len(posicoes)],
            secondary_position_id=None,
            is_guest=False,
        )
        for i, nivel in enumerate(niveis)
    ]


def test_sem_sobra_o_criterio_nao_opina():
    """4 fracos para 4 times: um em cada, e nada a decidir.

    Devolver um custo aqui seria somar uma constante ao score de toda solução
    viável — não mudaria o resultado e sujaria a leitura da auditoria.
    """
    players = elenco([1, 1, 1, 1, 3, 3, 3, 3])
    tiers = weakest_tiers(players, 4)

    assert weakest_surplus_cost([0, 1, 2, 3, 0, 1, 2, 3], 4, tiers) == 0
    assert weakest_surplus_cost([3, 2, 1, 0, 0, 1, 2, 3], 4, tiers) == 0


def test_com_sobra_o_ultimo_time_custa_menos():
    """5 fracos para 4 times: o 5º no último time é a distribuição barata."""
    players = elenco([1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3])
    tiers = weakest_tiers(players, 4)

    sobra_no_ultimo = [0, 1, 2, 3, 3, 0, 1, 2, 3, 0, 1, 2]
    sobra_no_primeiro = [0, 1, 2, 3, 0, 0, 1, 2, 3, 0, 1, 2]

    assert weakest_surplus_cost(sobra_no_ultimo, 4, tiers) < weakest_surplus_cost(
        sobra_no_primeiro, 4, tiers
    )


@pytest.mark.parametrize("seed", range(12))
def test_sorteio_completo_deixa_a_sobra_no_ultimo_time(seed):
    """O teste que vale: o sorteio inteiro, não o custo isolado.

    5 jogadores de nível 1-2 para 4 times — a mesma proporção do elenco real
    que motivou a regra.
    """
    players = elenco([1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 3])
    solucao = SimulatedAnnealingStrategy(seed=seed).solve(players, 4, {}, ScoringWeights())

    fracos = weakest_tiers(players, 4)[-1]
    contagem = Counter(solucao.team_of[i] for i in fracos)

    assert len(fracos) > 4, "o cenário precisa ter sobra, senão o teste não prova nada"
    # A restrição dura continua valendo: ninguém fica sem fraco...
    assert all(contagem[time] >= 1 for time in range(4))
    # ...e o excedente é do último time.
    assert contagem[3] == len(fracos) - 3
