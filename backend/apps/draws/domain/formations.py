"""
Formações táticas — módulo **puro**, sem Django.

Fica em `domain/` pelo mesmo motivo do motor de sorteio: é regra de negócio
testável sem banco, sem request e sem ORM. O serviço traduz para o mundo do
Django; aqui só existem inteiros e dataclasses.

## O que é uma formação, neste sistema

Uma lista ordenada de **tamanhos de linha**, da defesa para o ataque, contando
apenas jogadores de linha:

    "2-2-2"    → [2, 2, 2]  → 6 jogadores de linha
    "3-2-1-1"  → [3, 2, 1, 1] → 7 jogadores de linha

O **goleiro não entra na notação** — é a convenção do futebol brasileiro e é
coerente com `goalkeepers_per_team`, que já é configuração separada da partida.
Quando a partida reserva goleiro, o campo desenha a linha dele abaixo da
primeira linha da formação.

## A formação não é um novo critério do sorteio

Ela é aplicada **depois** que o algoritmo distribuiu os jogadores entre os
times. O Simulated Annealing continua decidindo *quem joga com quem* pelos
critérios de sempre (equilíbrio, posição, histórico de duplas, separação dos
piores, convidados); a formação decide *onde cada um é desenhado* e *qual
posição fica registrada*.

Fazer diferente — transformar a formação em restrição da têmpera — mudaria o
resultado do sorteio para todo mundo e entraria em conflito com a restrição dos
piores, que é dura. Ver `docs/PLANO_MOBILE_UX_SORTEIO.md` §13.2.
"""

from dataclasses import dataclass

#: Máximo de jogadores em uma mesma linha. Acima disso o campo em SVG fica
#: ilegível (os nomes se sobrepõem) e a formação deixa de descrever futebol.
MAX_PER_LINE = 4

#: Máximo de linhas. Com até 6 jogadores de linha, 4 faixas deixariam linhas de
#: um jogador só espalhadas pelo campo; a partir de 7 elas fazem sentido
#: (é o caso de "3-2-1-1" do futebol de 7).
MAX_LINES_SMALL = 3
MAX_LINES_LARGE = 4
SMALL_SQUAD_THRESHOLD = 6


@dataclass(frozen=True)
class Formation:
    """Uma formação válida para uma quantidade de jogadores de linha."""

    lines: tuple[int, ...]

    @property
    def key(self) -> str:
        """Identidade textual, no formato que o usuário conhece: `"2-2-2"`."""
        return "-".join(str(size) for size in self.lines)

    @property
    def line_players(self) -> int:
        return sum(self.lines)

    @property
    def line_count(self) -> int:
        return len(self.lines)

    @property
    def balance_score(self) -> float:
        """Quão distribuída é a formação. Menor = mais equilibrada.

        É a variância dos tamanhos de linha: `2-2-2` pontua 0 e vem primeiro;
        `1-1-4` pontua alto e vai para o fim da lista. Só ordena a oferta na
        tela — nenhuma formação válida é escondida por causa disso."""
        mean = self.line_players / self.line_count
        return sum((size - mean) ** 2 for size in self.lines) / self.line_count

    def __str__(self) -> str:
        return self.key


def parse_formation(value: str) -> Formation:
    """Lê `"2-2-2"` e devolve a formação. Levanta `ValueError` no que não for
    uma notação válida — o serializer converte isso em erro 400."""
    if not value or not isinstance(value, str):
        raise ValueError("Formação vazia.")

    parts = value.strip().split("-")
    try:
        lines = tuple(int(part) for part in parts)
    except ValueError as error:
        raise ValueError(f"Formação inválida: {value!r}. Use o formato 2-2-2.") from error

    if len(lines) < 2:
        raise ValueError("Uma formação precisa de pelo menos 2 linhas.")
    if any(size < 1 for size in lines):
        raise ValueError("Toda linha da formação precisa ter pelo menos 1 jogador.")

    return Formation(lines=lines)


def format_formation(lines) -> str:
    return "-".join(str(size) for size in lines)


def _compositions(total: int, parts: int, max_per_part: int) -> list[tuple[int, ...]]:
    """Todas as maneiras de escrever `total` como soma ordenada de `parts`
    inteiros positivos, cada um até `max_per_part`.

    Ordenada importa: `3-2-1` e `1-2-3` são formações **diferentes** (uma é
    defensiva, a outra ofensiva)."""
    if parts == 1:
        return [(total,)] if 1 <= total <= max_per_part else []

    result: list[tuple[int, ...]] = []
    for first in range(1, min(max_per_part, total - parts + 1) + 1):
        for rest in _compositions(total - first, parts - 1, max_per_part):
            result.append((first, *rest))
    return result


def generate_formations(line_players: int) -> list[Formation]:
    """Todas as formações válidas para N jogadores de linha, da mais
    equilibrada para a menos.

    As regras foram calibradas para reproduzir exatamente os exemplos que o
    produto pede (5, 6 e 7 jogadores) sem enumerar combinações que ninguém
    escalaria:

    - 2 a 3 linhas (4, quando há 7 jogadores de linha ou mais);
    - no mínimo 1 jogador por linha;
    - no máximo `min(4, ceil(N/2))` por linha.

    Com 6 jogadores de linha isto devolve, entre outras, `2-2-2`, `3-1-2`,
    `2-3-1`, `3-2-1` e `1-3-2` — a lista do requisito, e mais algumas.
    """
    if line_players < 2:
        return []

    max_lines = MAX_LINES_SMALL if line_players <= SMALL_SQUAD_THRESHOLD else MAX_LINES_LARGE
    max_per_line = min(MAX_PER_LINE, -(-line_players // 2))  # ceil(n/2)

    formations: list[Formation] = []
    for parts in range(2, min(max_lines, line_players) + 1):
        for lines in _compositions(line_players, parts, max_per_line):
            formations.append(Formation(lines=lines))

    # Mais equilibradas primeiro. Entre igualmente equilibradas, **mais linhas
    # primeiro**: com 6 jogadores, `2-2-2` e `3-3` têm a mesma variância (zero),
    # mas `3-3` é um time sem meio-campo — matematicamente empatado, e péssima
    # sugestão de futebol. Por fim, ordem estável pela notação, para a lista
    # nunca mudar entre chamadas (a tela guarda a escolha pela chave).
    formations.sort(key=lambda f: (f.balance_score, -f.line_count, f.key))
    return formations


def default_formation(line_players: int) -> Formation | None:
    """A formação sugerida: a mais equilibrada possível para o elenco."""
    options = generate_formations(line_players)
    return options[0] if options else None


def is_valid_formation(formation: Formation, line_players: int) -> bool:
    """A formação cabe neste time?

    Só a soma importa. Uma formação vinda de fora do catálogo (organizador
    digitou, versão antiga do cliente) é aceita desde que distribua exatamente
    os jogadores de linha disponíveis — não cabe ao sistema recusar um arranjo
    que o organizador quis e que é fisicamente possível.
    """
    return formation.line_players == line_players


def map_lines_to_positions(line_count: int, line_position_ids: list[int]) -> list[int]:
    """Para cada linha da formação, qual posição cadastrada ela representa.

    O problema real: a organização tem N posições de linha (por padrão ZAG, ME,
    AT — mas ela pode cadastrar mais), e a formação pode ter **mais linhas do
    que posições existentes**. `3-1-2-1` são 4 linhas para 3 posições.

    A regra distribui as linhas ao longo das posições disponíveis:

        posIndex(i) = round( i * (P - 1) / (k - 1) )

    Com P=3 (ZAG, ME, AT) e k=4 linhas:

        linha 0 → ZAG    linha 1 → ME    linha 2 → ME    linha 3 → AT

    Duas linhas podem compartilhar a mesma posição — é o comportamento
    desejado, e é exatamente por isso que a linha é guardada separadamente da
    posição: o campo desenha 4 faixas, mesmo existindo 3 posições.
    """
    if not line_position_ids:
        return []
    if line_count <= 0:
        return []

    positions_count = len(line_position_ids)
    if line_count == 1:
        return [line_position_ids[0]]

    return [
        line_position_ids[round(index * (positions_count - 1) / (line_count - 1))]
        for index in range(line_count)
    ]


@dataclass(frozen=True)
class Slot:
    """Uma vaga do desenho: linha e posição dentro dela."""

    line_index: int
    slot_index: int
    position_id: int


def build_slots(formation: Formation, line_position_ids: list[int]) -> list[Slot]:
    """As vagas da formação, na ordem de leitura do campo (da defesa para o
    ataque, da esquerda para a direita)."""
    positions = map_lines_to_positions(formation.line_count, line_position_ids)
    slots: list[Slot] = []
    for line_index, size in enumerate(formation.lines):
        position_id = positions[line_index] if line_index < len(positions) else positions[-1]
        for slot_index in range(size):
            slots.append(Slot(line_index=line_index, slot_index=slot_index, position_id=position_id))
    return slots


@dataclass(frozen=True)
class AssignablePlayer:
    """O que a atribuição precisa saber de um jogador. Deliberadamente menos do
    que o model tem — o módulo não conhece Django."""

    id: int
    primary_position_id: int
    secondary_position_id: int | None
    #: Ordem da posição principal no campo (o `sort_order` de `Position`),
    #: usado para medir "quão fora da posição" um jogador ficaria.
    primary_sort_order: int


def assignment_cost(
    player: AssignablePlayer, slot: Slot, sort_order_by_position: dict[int, int]
) -> int:
    """Quanto custa colocar este jogador nesta vaga.

    0 = posição principal, 1 = secundária, 2+ = fora de posição, crescendo com a
    distância entre as faixas do campo. Um zagueiro escalado no ataque custa
    mais que um zagueiro escalado no meio — que é a intuição de quem escala.
    """
    if slot.position_id == player.primary_position_id:
        return 0
    if player.secondary_position_id and slot.position_id == player.secondary_position_id:
        return 1

    slot_order = sort_order_by_position.get(slot.position_id, player.primary_sort_order)
    return 2 + abs(slot_order - player.primary_sort_order)


def assign_players_to_slots(
    players: list[AssignablePlayer],
    slots: list[Slot],
    sort_order_by_position: dict[int, int],
) -> dict[int, Slot]:
    """Encaixa os jogadores do time nas vagas da formação, minimizando o total
    de "fora de posição".

    Estratégia: guloso pelo jogador mais restrito primeiro (o que tem menos
    vagas boas disponíveis), com uma passada de melhoria por troca de pares.
    Não é um algoritmo húngaro completo, e não precisa ser: um time de pelada
    tem no máximo ~12 jogadores, e a passada de troca já elimina os casos ruins
    do guloso.

    Devolve `{player_id: Slot}`. Jogadores além das vagas — o caso de times de
    tamanhos diferentes, permitido pela regra §6.3 — ficam **de fora do
    dicionário**: eles entram no time normalmente, só não têm vaga fixa no
    desenho. Ninguém é descartado.
    """
    if not slots or not players:
        return {}

    assignable = players[: len(slots)]
    remaining_slots = list(slots)
    result: dict[int, Slot] = {}

    # Quem tem menos opções boas escolhe primeiro — senão os generalistas
    # ocupam as vagas naturais dos especialistas.
    def flexibility(player: AssignablePlayer) -> int:
        return sum(
            1 for slot in remaining_slots if assignment_cost(player, slot, sort_order_by_position) <= 1
        )

    for player in sorted(assignable, key=flexibility):
        best = min(remaining_slots, key=lambda s: assignment_cost(player, s, sort_order_by_position))
        result[player.id] = best
        remaining_slots.remove(best)

    _improve_by_swaps(assignable, result, sort_order_by_position)
    return result


def _improve_by_swaps(
    players: list[AssignablePlayer],
    assignment: dict[int, Slot],
    sort_order_by_position: dict[int, int],
) -> None:
    """Troca pares enquanto isso reduzir o custo total.

    Conserta o erro típico do guloso: dois jogadores que ficariam melhor com as
    vagas invertidas. Converge rápido — o custo é inteiro e só diminui.
    """
    by_id = {player.id: player for player in players}
    improved = True
    while improved:
        improved = False
        ids = list(assignment.keys())
        for i, a_id in enumerate(ids):
            for b_id in ids[i + 1 :]:
                a, b = by_id[a_id], by_id[b_id]
                slot_a, slot_b = assignment[a_id], assignment[b_id]

                current = assignment_cost(a, slot_a, sort_order_by_position) + assignment_cost(
                    b, slot_b, sort_order_by_position
                )
                swapped = assignment_cost(a, slot_b, sort_order_by_position) + assignment_cost(
                    b, slot_a, sort_order_by_position
                )
                if swapped < current:
                    assignment[a_id], assignment[b_id] = slot_b, slot_a
                    improved = True
