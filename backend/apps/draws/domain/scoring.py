from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

from .entities import Player


@dataclass
class ScoringWeights:
    balance: float = 1.0
    position: float = 1.0
    repetition: float = 0.5
    secondary_usage: float = 0.3
    # A separação dos piores é uma **restrição**, não mais um critério entre
    # iguais: o peso é uma ordem de grandeza acima dos demais para que nenhuma
    # melhora de média compense juntar dois dos piores no mesmo time. A garantia
    # dura (a estratégia nunca aceita uma solução pior que o mínimo possível
    # neste critério) vive em `SimulatedAnnealingStrategy`.
    weakest_split: float = 10.0
    # Onde fica a **sobra** dos mais fracos, quando ela existe. O valor foi
    # medido, não escolhido: com 2.0 o excedente caía no último time em 83% dos
    # sorteios; com 4.0, em 100%. Subir mais não melhora nada e começa a puxar
    # os melhores de volta para o último time (28% em 4.0, 31% em 6.0) — o
    # oposto do que a regra proporcional de `_balance_cost` foi corrigir.
    weakest_surplus: float = 4.0
    guest_balance: float = 0.3


@dataclass
class ScoreBreakdown:
    balance: float
    position: float
    repetition: float
    secondary_usage: float
    weakest_split: float
    weakest_surplus: float
    guest_balance: float
    total: float


def _effective_position_id(player: Player, used_secondary: bool) -> int:
    if used_secondary and player.secondary_position_id:
        return player.secondary_position_id
    return player.primary_position_id


def _spread_cost(counts: list[int], population: int, teams_count: int) -> float:
    """Custo de concentração de um grupo de jogadores entre os times.

    Quando o grupo tem gente suficiente para todos os times, o alvo é a divisão
    exata (`população / times`). Quando é menor que o número de times, exigir um
    por time seria impossível — o alvo passa a ser "no máximo um por time", o
    que penaliza a concentração sem penalizar a ausência.
    """
    if population >= teams_count:
        target = population / teams_count
        return sum((count - target) ** 2 for count in counts)
    return sum(max(0, count - 1) ** 2 for count in counts)


def weakest_tiers(players: list[Player], teams_count: int) -> list[frozenset[int]]:
    """Camadas cumulativas do "grupo dos piores", por índice de jogador.

    A regra de negócio é: com N times, os N jogadores de menor nível vão para
    times diferentes. O empate de nível impede tratar isso como "os N primeiros
    de uma lista ordenada" — quem são "os 3 piores" quando existem 4 jogadores
    de 1 estrela? Ordenar por cadastro escolheria três deles arbitrariamente.

    Por isso o grupo é montado por **camadas cumulativas de nível**: a primeira
    camada são todos os jogadores do nível mais baixo, a segunda acrescenta o
    nível seguinte, e assim por diante — parando na primeira camada que já tem
    jogadores suficientes para ocupar todos os times. Cada camada é avaliada
    separadamente por `_spread_cost`, então:

    - 3 times e três jogadores ⭐ → uma camada de 3, alvo de 1 por time;
    - 3 times e quatro jogadores ⭐ → uma camada de 4, alvo 4/3 (2-1-1 é o
      melhor possível e é o que o algoritmo procura);
    - 3 times, dois jogadores ⭐ e três ⭐⭐ → duas camadas: a de ⭐ (separa os
      dois piores) e a de ⭐+⭐⭐ (espalha os cinco). Sem a primeira camada, os
      dois piores poderiam cair juntos sem custo nenhum.
    """
    if teams_count <= 0 or not players:
        return []

    tiers: list[frozenset[int]] = []
    for level in sorted({player.skill_level for player in players}):
        tier = frozenset(i for i, player in enumerate(players) if player.skill_level <= level)
        tiers.append(tier)
        if len(tier) >= teams_count:
            break
    return tiers


def weakest_split_cost(
    team_of: list[int], teams_count: int, tiers: list[frozenset[int]]
) -> float:
    cost = 0.0
    for tier in tiers:
        counts = [0] * teams_count
        for index in tier:
            counts[team_of[index]] += 1
        cost += _spread_cost(counts, len(tier), teams_count)
    return cost


def weakest_surplus_cost(
    team_of: list[int], teams_count: int, tiers: list[frozenset[int]]
) -> float:
    """Onde fica a **sobra** do grupo dos mais fracos — e só quando ela existe.

    A separação dos piores (restrição dura) garante que eles fiquem o mais
    espalhados possível, mas quando há mais fracos que times alguém precisa
    levar dois. Qual time leva era indiferente para o custo, logo caía no
    aleatório: um sorteio deixava o excedente no time A, o seguinte no C.

    Decisão de produto: o excedente vai para o **último** time. Ele é o que
    absorve a sobra, e os demais ficam parelhos entre si.

    O custo é a distância de cada fraco até o último time, então o mínimo é
    tê-los o mais ao fim possível. Ele **não** consegue amontoar todo mundo lá:
    a restrição dura rejeita qualquer solução acima do piso de separação antes
    de olhar para o score, então a única liberdade que sobra é escolher o dono
    do excedente — que é exatamente o que se quer decidir aqui.

    Sem sobra (fracos ≤ times), devolve zero: o custo seria o mesmo para toda
    distribuição viável, e somar uma constante ao score só confundiria a
    leitura da auditoria.
    """
    if not tiers or teams_count <= 0:
        return 0.0
    # A última camada é a que já tem gente suficiente para todos os times — é
    # nela que a sobra aparece.
    tier = tiers[-1]
    if len(tier) <= teams_count:
        return 0.0
    return float(sum(teams_count - 1 - team_of[index] for index in tier))


def minimum_weakest_split_cost(
    players: list[Player], teams_count: int, tiers: list[frozenset[int]]
) -> float:
    """Menor custo de separação **atingível** com este elenco e este número de
    times — o piso contra o qual a estratégia mede se a restrição foi cumprida.

    O piso é construtivo: distribuir os jogadores em ordem crescente de nível,
    um por time em rodízio, deixa **todo prefixo** dessa ordem espalhado o mais
    uniformemente possível. Como cada camada de `weakest_tiers` é exatamente um
    prefixo dessa ordem, essa distribuição atinge simultaneamente o mínimo de
    todas as camadas — logo o mínimo da soma. Não depende de qual jogador vai
    para qual time (o custo só olha contagens), então empates não afetam o piso.
    """
    if teams_count <= 0 or not players:
        return 0.0

    ascending = sorted(range(len(players)), key=lambda i: players[i].skill_level)
    ideal = [0] * len(players)
    for rank, index in enumerate(ascending):
        ideal[index] = rank % teams_count
    return weakest_split_cost(ideal, teams_count, tiers)


def _balance_cost(players: list[Player], team_of: list[int], teams_count: int) -> float:
    """Distância de cada time para a **sua parte** do total de estrelas.

    A parte de um time é proporcional ao tamanho dele, não a divisão do total
    pelo número de times. A diferença só aparece quando os times têm tamanhos
    diferentes (número de confirmados que não divide igual) — e aparece forte:
    com 27 jogadores em 4 times (7-7-7-6), perseguir a mesma **soma** para
    todos obrigava o time de 6 a fazer as mesmas estrelas com um jogador a
    menos, ou seja, **a levar os melhores**. Numa medição de 200 sorteios, os 4
    melhores caíam no último time em 40% das vezes contra ~19% em cada um dos
    outros. Mirando a parte proporcional, o alvo do time de 6 passa a ser
    proporcionalmente menor e a pressão some.

    Com times do mesmo tamanho a parte de cada um é exatamente a média das
    somas, então isto é idêntico ao critério anterior — que era a única
    situação em que ele estava certo.
    """
    team_skill = [0.0] * teams_count
    team_size = [0] * teams_count
    for player, team in zip(players, team_of, strict=True):
        team_skill[team] += player.skill_level
        team_size[team] += 1

    per_player = sum(team_skill) / len(players)
    return sum(
        (skill - per_player * size) ** 2
        for skill, size in zip(team_skill, team_size, strict=True)
    )


def _position_cost(
    players: list[Player], team_of: list[int], use_secondary: list[bool], teams_count: int
) -> float:
    """
    Distribuição por posição. Quando há posições escassas (ex.: só 2
    goleiros para 4 times), não é realista exigir 1 por time — o alvo passa
    a ser "no máximo 1 por time" (penaliza concentração, não a ausência).
    """
    teams_by_position: dict[int, list[int]] = defaultdict(list)
    for player, team, used_secondary_flag in zip(players, team_of, use_secondary, strict=True):
        position_id = _effective_position_id(player, used_secondary_flag)
        teams_by_position[position_id].append(team)

    cost = 0.0
    for team_list in teams_by_position.values():
        counts = [0] * teams_count
        for team in team_list:
            counts[team] += 1
        cost += _spread_cost(counts, len(team_list), teams_count)

    return cost


def _repetition_cost(
    players: list[Player], team_of: list[int], pair_history: dict[tuple[int, int], float]
) -> float:
    players_by_team: dict[int, list[int]] = defaultdict(list)
    for player, team in zip(players, team_of, strict=True):
        players_by_team[team].append(player.id)

    cost = 0.0
    for player_ids in players_by_team.values():
        for a, b in combinations(sorted(player_ids), 2):
            cost += pair_history.get((a, b), 0.0)
    return cost


def _secondary_usage_cost(use_secondary: list[bool]) -> float:
    return float(sum(use_secondary))


def _guest_balance_cost(players: list[Player], team_of: list[int], teams_count: int) -> float:
    """Convidados espalhados entre os times. Concentrar os convidados em um time
    só é indesejável na prática (é o time que ninguém conhece), mesmo quando as
    estrelas fecham."""
    counts = [0] * teams_count
    guests = 0
    for player, team in zip(players, team_of, strict=True):
        if player.is_guest:
            counts[team] += 1
            guests += 1
    if guests == 0:
        return 0.0
    return _spread_cost(counts, guests, teams_count)


def compute_score(
    players: list[Player],
    team_of: list[int],
    use_secondary: list[bool],
    teams_count: int,
    pair_history: dict[tuple[int, int], float],
    weights: ScoringWeights,
    tiers: list[frozenset[int]] | None = None,
) -> ScoreBreakdown:
    """`tiers` é opcional só por conveniência de quem chama pontualmente (testes,
    inspeção): a estratégia calcula as camadas uma única vez e as repassa, porque
    recalculá-las a cada uma das dezenas de milhares de iterações seria puro
    desperdício."""
    if tiers is None:
        tiers = weakest_tiers(players, teams_count)

    balance = _balance_cost(players, team_of, teams_count)
    position = _position_cost(players, team_of, use_secondary, teams_count)
    repetition = _repetition_cost(players, team_of, pair_history)
    secondary_usage = _secondary_usage_cost(use_secondary)
    weakest = weakest_split_cost(team_of, teams_count, tiers)
    surplus = weakest_surplus_cost(team_of, teams_count, tiers)
    guest = _guest_balance_cost(players, team_of, teams_count)

    total = (
        weights.balance * balance
        + weights.position * position
        + weights.repetition * repetition
        + weights.secondary_usage * secondary_usage
        + weights.weakest_split * weakest
        + weights.weakest_surplus * surplus
        + weights.guest_balance * guest
    )
    return ScoreBreakdown(
        balance=balance,
        position=position,
        repetition=repetition,
        secondary_usage=secondary_usage,
        weakest_split=weakest,
        weakest_surplus=surplus,
        guest_balance=guest,
        total=total,
    )
