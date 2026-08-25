import math
import random

from ..entities import Player
from ..scoring import (
    ScoringWeights,
    compute_score,
    minimum_weakest_split_cost,
    weakest_tiers,
)
from .base import DrawSolution, DrawStrategy

#: Folga para comparar custos em ponto flutuante — o piso da separação dos
#: piores é calculado por outro caminho que a avaliação da solução corrente, e
#: uma diferença de 1e-16 não pode ser lida como "restrição violada".
FEASIBILITY_EPSILON = 1e-9


def _team_sizes(total: int, teams_count: int) -> list[int]:
    """Quantos jogadores cada time recebe. O resto vai para os primeiros."""
    base, sobra = divmod(total, teams_count)
    return [base + (1 if t < sobra else 0) for t in range(teams_count)]


def mensalista_quota(players: list[Player], teams_count: int) -> list[int]:
    """Quantos **mensalistas** cada time recebe, preenchendo na ordem.

    Regra do produto: mensalista tem prioridade nos primeiros times, e o
    convidado só entra depois que eles acabam. Com 12 mensalistas e 12
    convidados em 4 times de 6, os times A e B ficam só com mensalistas.

    Faltando mensalistas, os primeiros times enchem e o resto se completa com
    convidados — nunca falha por falta. Com 9 mensalistas em 4 times de 6: A
    leva 6, B leva 3 (+3 convidados), C e D só convidados.
    """
    mensalistas = sum(1 for player in players if not player.is_guest)
    quota = []
    for tamanho in _team_sizes(len(players), teams_count):
        cabe = min(tamanho, mensalistas)
        quota.append(cabe)
        mensalistas -= cabe
    return quota


def _snake_into(indices: list[int], vagas: list[int]) -> list[tuple[int, int]]:
    """Distribui `indices` (já ordenados do pior para o melhor) entre os times,
    em serpentina, respeitando as vagas de cada um.

    A serpentina é o que equilibra: inverter o sentido a cada rodada compensa a
    vantagem de escolher primeiro. Times sem vaga saem do rodízio, o que
    mantém o equilíbrio **dentro** do grupo mesmo quando os grupos têm
    tamanhos diferentes."""
    restantes = list(vagas)
    resultado: list[tuple[int, int]] = []
    rodada = 0
    posicao = 0
    for indice in indices:
        elegiveis = [t for t in range(len(restantes)) if restantes[t] > 0]
        if not elegiveis:
            break
        if rodada % 2:
            elegiveis.reverse()
        time = elegiveis[posicao % len(elegiveis)]
        resultado.append((indice, time))
        restantes[time] -= 1
        posicao += 1
        if posicao >= len(elegiveis):
            posicao = 0
            rodada += 1
    return resultado


def _snake_draft_seed(
    players: list[Player], teams_count: int, rng: random.Random
) -> list[int]:
    """Solução inicial: mensalistas nos primeiros times, equilibrados por
    serpentina **dentro** de cada grupo.

    A serpentina (do pior para o melhor, invertendo a cada rodada) continua
    sendo o que equilibra e o que já nasce separando os mais fracos — ver
    `weakest_tiers`. O que mudou é o **espaço** em que ela roda: antes era
    todos os jogadores em todos os times; agora são os mensalistas nas vagas
    de mensalista e os convidados nas que sobram.

    Empates de nível são desempatados por sorteio, nunca pela ordem de
    cadastro: dois jogadores de mesmo nível têm a mesma chance de abrir o
    rodízio.
    """
    quota = mensalista_quota(players, teams_count)
    tamanhos = _team_sizes(len(players), teams_count)
    vagas_de_convidado = [tamanhos[t] - quota[t] for t in range(teams_count)]

    def ordenados(is_guest: bool) -> list[int]:
        indices = [i for i, player in enumerate(players) if player.is_guest is is_guest]
        rng.shuffle(indices)
        indices.sort(key=lambda i: players[i].skill_level)
        return indices

    team_of = [-1] * len(players)
    for indice, time in _snake_into(ordenados(False), quota):
        team_of[indice] = time
    for indice, time in _snake_into(ordenados(True), vagas_de_convidado):
        team_of[indice] = time

    # Rede de segurança: ninguém fica de fora nem que as contas escorreguem.
    for i, time in enumerate(team_of):
        if time == -1:
            team_of[i] = min(range(teams_count), key=lambda t: team_of.count(t))
    return team_of


class SimulatedAnnealingStrategy(DrawStrategy):
    def __init__(
        self,
        initial_temperature: float = 10.0,
        cooling_rate: float = 0.995,
        max_iterations: int = 20000,
        max_iterations_without_improvement: int = 3000,
        seed: int | None = None,
    ):
        self.initial_temperature = initial_temperature
        self.cooling_rate = cooling_rate
        self.max_iterations = max_iterations
        self.max_iterations_without_improvement = max_iterations_without_improvement
        self._random = random.Random(seed)

    def solve(
        self,
        players: list[Player],
        teams_count: int,
        pair_history: dict[tuple[int, int], float],
        weights: ScoringWeights,
    ) -> DrawSolution:
        n = len(players)

        # A separação dos piores é tratada como **restrição**, não como mais uma
        # parcela do custo. O peso alto em `ScoringWeights` já desencoraja
        # violá-la, mas peso não é garantia: uma melhora grande de equilíbrio
        # poderia comprar a violação. Aqui a busca simplesmente **nunca aceita**
        # uma solução acima do piso atingível — e o seed já parte dele, de modo
        # que a região viável é a única que a têmpera visita.
        #
        # Isso não empobrece a busca: o piso é atingível por construção (ver
        # `minimum_weakest_split_cost`) e o espaço viável continua conectado por
        # trocas de pares — inclusive trocas envolvendo os piores, desde que a
        # contagem por time não piore.
        tiers = weakest_tiers(players, teams_count)
        feasible_cost = minimum_weakest_split_cost(players, teams_count, tiers)
        feasibility_limit = feasible_cost + FEASIBILITY_EPSILON

        team_of = _snake_draft_seed(players, teams_count, self._random)
        use_secondary = [False] * n

        def score_of(candidate_team_of: list[int], candidate_use_secondary: list[bool]):
            return compute_score(
                players,
                candidate_team_of,
                candidate_use_secondary,
                teams_count,
                pair_history,
                weights,
                tiers=tiers,
            )

        current_score = score_of(team_of, use_secondary)
        best_team_of, best_use_secondary, best_score = list(team_of), list(use_secondary), current_score

        secondary_eligible = [i for i, p in enumerate(players) if p.secondary_position_id]

        temperature = self.initial_temperature
        stale_iterations = 0
        iterations_run = 0

        for iterations_run in range(1, self.max_iterations + 1):  # noqa: B007 (valor final usado após o loop)
            candidate_team_of = list(team_of)
            candidate_use_secondary = list(use_secondary)

            if secondary_eligible and self._random.random() < 0.3:
                i = self._random.choice(secondary_eligible)
                candidate_use_secondary[i] = not candidate_use_secondary[i]
            else:
                i, j = self._random.sample(range(n), 2)
                # Trocar um mensalista por um convidado mudaria a composição
                # dos times e quebraria a prioridade. Restringindo a troca ao
                # mesmo tipo, a cota é preservada **por construção** — não por
                # uma penalidade que o algoritmo poderia decidir pagar.
                if players[i].is_guest != players[j].is_guest:
                    stale_iterations += 1
                    if stale_iterations > self.max_iterations_without_improvement:
                        break
                    continue
                if team_of[i] == team_of[j]:
                    stale_iterations += 1
                    if stale_iterations > self.max_iterations_without_improvement:
                        break
                    continue
                candidate_team_of[i], candidate_team_of[j] = candidate_team_of[j], candidate_team_of[i]

            candidate_score = score_of(candidate_team_of, candidate_use_secondary)

            if candidate_score.weakest_split > feasibility_limit:
                # Juntaria dois dos piores podendo separá-los: a troca é
                # descartada sem sequer olhar para o resto do score.
                stale_iterations += 1
                if stale_iterations > self.max_iterations_without_improvement:
                    break
                continue

            delta = candidate_score.total - current_score.total

            accept = delta < 0 or self._random.random() < math.exp(-delta / max(temperature, 1e-6))
            if accept:
                team_of, use_secondary, current_score = (
                    candidate_team_of,
                    candidate_use_secondary,
                    candidate_score,
                )
                if current_score.total < best_score.total:
                    best_team_of = list(team_of)
                    best_use_secondary = list(use_secondary)
                    best_score = current_score
                    stale_iterations = 0
                else:
                    stale_iterations += 1
            else:
                stale_iterations += 1

            temperature *= self.cooling_rate

            if stale_iterations > self.max_iterations_without_improvement:
                break

        return DrawSolution(
            team_of=best_team_of,
            use_secondary=best_use_secondary,
            score=best_score,
            iterations_run=iterations_run,
        )
