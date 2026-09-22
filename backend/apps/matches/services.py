from dataclasses import dataclass, field
from datetime import date, time, timedelta

from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.audit.services import log_action
from apps.players.models import Player, Position
from common.exceptions import DomainError

from .models import (
    Confirmation,
    Match,
    MatchCapacity,
    RecurringGame,
    WaitlistEntry,
)
from .name_matching import REPEAT_THRESHOLD, best_match, parse_roster_line

# ---------------------------------------------------------------------------
# Geração de partidas a partir de jogos recorrentes
# ---------------------------------------------------------------------------


def _next_occurrence(weekday: int, after: date) -> date:
    """Primeira data estritamente depois de `after` cujo dia da semana é `weekday`."""
    days_ahead = (weekday - after.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return after + timedelta(days=days_ahead)


def _kickoff_passed(*, on_date: date, at_time: time) -> bool:
    """A bola já rolou nesse dia/horário?

    "Próxima partida" quer dizer uma partida que ainda **vai** acontecer. Uma
    ocorrência de hoje cujo horário de jogo já passou não é a próxima de
    ninguém: não dá tempo de confirmar presença nem de sortear. Gerar (ou
    devolver) essa ocorrência entrega ao organizador uma partida nascida
    vencida — o certo é ir para a semana seguinte."""
    now = timezone.localtime()
    if on_date < now.date():
        return True
    return on_date == now.date() and at_time <= now.time()


# Campos que uma partida **copia** do jogo recorrente no momento em que é
# gerada. É a lista que define o que "estar alinhado com a recorrência"
# significa, e a mesma que a sincronização reaplica — assim não existe um lugar
# que copia na criação e outro que esquece de copiar na atualização.
#
# `scheduled_date` está fora de propósito: mudar o dia da semana **não** arrasta
# uma partida já gerada, porque as pessoas confirmaram presença para aquela
# data. A divergência de dia da semana continua sendo sinalizada em vermelho
# (`recurring_game_divergences`) para o organizador decidir.
_MATCH_CONFIG_FROM_RECURRING_GAME = {
    "scheduled_time": "match_time",
    "teams_count": "teams_count",
    "goalkeepers_per_team": "goalkeepers_per_team",
    "min_players": "min_players",
    "max_players": "max_players",
}


def match_config_from(recurring_game: RecurringGame) -> dict:
    """Configuração que uma partida herda do jogo recorrente, lida do objeto
    **atual** (que por sua vez recalcula min/max no `save()`)."""
    return {
        match_attribute: getattr(recurring_game, game_attribute)
        for match_attribute, game_attribute in _MATCH_CONFIG_FROM_RECURRING_GAME.items()
    }


# Uma ocorrência nestes estados já "aconteceu" do ponto de vista da agenda:
# ela não aceita mais ser realinhada (o sorteio foi feito com a configuração
# dela) nem representa a próxima partida a organizar.
_SPENT_STATUSES = (
    Match.Status.DRAWN,
    Match.Status.IN_PROGRESS,
    Match.Status.COMPLETED,
    Match.Status.CANCELED,
)


def _can_sync(match: Match) -> bool:
    """Uma partida só acompanha a nova configuração enquanto ainda dá para
    mudar de ideia sem destruir nada: no futuro (ou hoje), sem sorteio e sem
    estar cancelada/concluída.

    Partida **já sorteada** é intocável — os times foram montados com aquela
    configuração, e mexer no número de times por baixo do resultado seria
    destrutivo e silencioso. Para ela vale a regra antiga: o aviso de
    divergência aparece e o organizador decide."""
    return (
        match.scheduled_date >= timezone.localdate()
        and match.status in (Match.Status.SCHEDULED, Match.Status.CONFIRMING)
        and not match.has_draw
    )


@transaction.atomic
def sync_match_with_recurring_game(*, match: Match) -> bool:
    """Realinha uma partida com a configuração **atual** do jogo recorrente que
    a gerou. Devolve `True` se algo mudou.

    Depois de mexer na capacidade, a lotação é reconciliada na hora: o excedente
    vai para a fila (`enforce_match_capacity`) e, se a capacidade cresceu, quem
    estava esperando é promovido (`fill_open_slots`). Sem isso, uma partida
    podia ficar com mais confirmados que o teto até o momento do sorteio."""
    recurring_game = match.recurring_game
    if recurring_game is None or not _can_sync(match):
        return False

    config = match_config_from(recurring_game)
    changed = [name for name, value in config.items() if getattr(match, name) != value]
    if not changed:
        return False

    for name, value in config.items():
        setattr(match, name, value)
    match.save(update_fields=changed)

    enforce_match_capacity(match=match)
    fill_open_slots(match=match, reason="Capacidade ampliada na configuração do jogo recorrente.")
    return True


def sync_future_matches(recurring_game: RecurringGame) -> int:
    """Propaga a configuração atual para **todas** as partidas futuras ainda
    sincronizáveis, não só para a próxima — um jogo recorrente pode ter mais de
    uma ocorrência gerada à frente. Devolve quantas mudaram."""
    upcoming = Match.objects.filter(
        recurring_game=recurring_game,
        scheduled_date__gte=timezone.localdate(),
        status__in=[Match.Status.SCHEDULED, Match.Status.CONFIRMING],
    ).select_related("recurring_game")
    return sum(1 for match in upcoming if sync_match_with_recurring_game(match=match))


def ensure_next_match(recurring_game: RecurringGame, *, force: bool = False) -> Match | None:
    """Garante que a próxima ocorrência de um jogo recorrente já tenha uma
    Match criada, para que as confirmações possam começar com antecedência.
    Idempotente: se a última partida gerada ainda está por vir, não faz nada.

    Dois modos:

    - **Automático** (`force=False`, usado pela task periódica e ao criar o jogo
      recorrente): respeita a janela de antecedência (`days_before_to_generate`)
      e **não recria** uma ocorrência que o organizador removeu — antes ela
      "ressuscitava" sozinha, porque o manager padrão esconde os soft-deletados.

    - **Explícito** (`force=True`, botão "Gerar partida agora"): o organizador
      está pedindo a partida, então ignora a janela de antecedência e reabre uma
      ocorrência removida. A reabertura **revive o mesmo registro**, preservando
      id, confirmações e histórico de sorteios — em vez de criar uma duplicata.

    **Toda partida devolvida sai alinhada com a configuração atual**, por um de
    dois caminhos — e era exatamente aqui que estava o bug relatado, em duas
    camadas:

    1. Quando a próxima ocorrência já existia (o caso normal, já que a partida
       nasce junto com o jogo recorrente), a função devolvia o registro antigo e
       voltava. Nenhuma partida era criada e a existente, montada com a
       configuração anterior, voltava intacta. → agora ela é **realinhada**.
    2. Quando essa ocorrência já estava **sorteada**, realinhar é proibido (os
       times foram montados com aquela configuração) — e o botão continuava
       devolvendo a partida velha, sem saída. → agora, no modo explícito, uma
       ocorrência gasta não bloqueia: a partida **seguinte** é criada, já com a
       configuração nova.
    """
    if not recurring_game.is_active:
        return None

    # Releitura obrigatória: o serviço pode receber uma instância carregada
    # antes da edição (task periódica, chamada encadeada). O que vale é a linha
    # do banco, não o objeto em memória de quem chamou.
    recurring_game = RecurringGame.objects.get(pk=recurring_game.pk)

    today = timezone.localdate()
    # No modo explícito, uma ocorrência removida não conta como "já existe":
    # é justamente ela que o organizador quer de volta.
    scope = Match.objects if force else Match.all_objects
    latest = scope.filter(recurring_game=recurring_game).order_by("-scheduled_date").first()
    if latest is not None and latest.scheduled_date >= today:
        if latest.is_deleted:
            return None
        # Ocorrência ainda **aberta**: ela É a próxima partida. Realinha com a
        # configuração atual e devolve — gerar outra criaria uma duplicata.
        #
        # Já uma ocorrência **gasta** (sorteada, em andamento, concluída ou
        # cancelada) não pode ser realinhada nem representa mais "a próxima":
        # no modo explícito o organizador está pedindo a partida **seguinte**,
        # então ela não bloqueia a geração. Era o buraco que sobrava depois de
        # corrigir o realinhamento: com a partida da semana já sorteada, editar
        # a recorrência e clicar no botão devolvia justamente a partida velha,
        # que é a única que o realinhamento não pode tocar.
        # ...e o mesmo vale para uma ocorrência de hoje cuja **hora de jogo já
        # passou**: ela pode estar "aberta" no status, mas a bola já rolou, e
        # devolvê-la ao organizador que pediu a próxima partida entrega algo
        # nascido vencido.
        spent = latest.status in _SPENT_STATUSES or _kickoff_passed(
            on_date=latest.scheduled_date, at_time=latest.scheduled_time
        )
        if not (force and spent):
            sync_match_with_recurring_game(match=latest)
            return latest

    base_date = max(latest.scheduled_date, today - timedelta(days=1)) if latest else today - timedelta(days=1)
    next_date = _next_occurrence(recurring_game.weekday, base_date)

    # A ocorrência calculada pode cair em **hoje** com o horário do jogo já
    # vencido (é o caso de gerar às 16:12 uma pelada de sexta às 16:00). Nesse
    # caso a partida nasceria impossível de organizar — pula para a semana
    # seguinte. Vale para os dois modos: nem o botão nem a task periódica têm
    # motivo para criar uma partida cuja bola já rolou.
    if _kickoff_passed(on_date=next_date, at_time=recurring_game.match_time):
        next_date = _next_occurrence(recurring_game.weekday, next_date)

    if not force and (next_date - today).days > recurring_game.days_before_to_generate:
        return None

    existing = Match.all_objects.filter(
        recurring_game=recurring_game, scheduled_date=next_date
    ).first()
    if existing is not None:
        if not existing.is_deleted:
            sync_match_with_recurring_game(match=existing)
            return existing
        if not force:
            return None
        existing.is_deleted = False
        existing.deleted_at = None
        if existing.status == Match.Status.CANCELED:
            # Mesma regra de `reactivate_match`: uma ocorrência que já tinha
            # sorteio volta como `Sorteada`, não como `Agendada` — senão ela
            # reapareceria na fila do sorteio automático já tendo times.
            existing.status = (
                Match.Status.DRAWN if existing.has_draw else Match.Status.SCHEDULED
            )
        existing.save(update_fields=["is_deleted", "deleted_at", "status"])
        # Uma ocorrência reaberta pode ter sido criada muitas edições atrás.
        sync_match_with_recurring_game(match=existing)
        return existing

    return Match.objects.create(
        recurring_game=recurring_game,
        scheduled_date=next_date,
        organization=recurring_game.organization,
        status=Match.Status.SCHEDULED,
        # Mesma fonte que a sincronização usa — criar e realinhar não podem
        # divergir sobre o que a partida herda da recorrência.
        **match_config_from(recurring_game),
    )


def generate_upcoming_matches() -> int:
    count = 0
    for recurring_game in RecurringGame.objects.filter(is_active=True):
        if ensure_next_match(recurring_game) is not None:
            count += 1
    return count


# ---------------------------------------------------------------------------
# Confirmados — fonte única
# ---------------------------------------------------------------------------


def confirmed_confirmations(match: Match) -> QuerySet[Confirmation]:
    """Confirmações que **de fato** entram no sorteio, em ordem de inscrição.

    Fonte única do sistema: usada pelo motor de sorteio, pelo contador exibido
    na listagem/tela da partida e pelo controle de capacidade. O filtro por
    jogador ativo e não removido é essencial — `select_related("player")` é um
    JOIN e não passa pelo manager de soft-delete do `Player`, então sem estes
    dois filtros um jogador inativo (ou apagado) continuava sendo sorteado,
    contrariando a regra de negócio e divergindo do contador da tela."""
    return (
        Confirmation.objects.filter(
            match=match,
            status=Confirmation.Status.CONFIRMED,
            player__is_deleted=False,
            player__status=Player.Status.ATIVO,
        )
        .select_related("player")
        .order_by("confirmed_at", "id")
    )


def get_confirmed_players(match: Match) -> list[Player]:
    return [confirmation.player for confirmation in confirmed_confirmations(match)]


def count_confirmed(match: Match) -> int:
    return confirmed_confirmations(match).count()


def get_match_capacity(match: Match) -> MatchCapacity:
    """Configuração efetiva da partida. Nenhuma camada recalcula capacidade
    por conta própria — todas passam por aqui."""
    return match.capacity


# ---------------------------------------------------------------------------
# Fila de espera
# ---------------------------------------------------------------------------


def _is_mensalista(player: Player) -> bool:
    return player.player_type == Player.PlayerType.MENSALISTA


def waitlist_entries(match: Match) -> QuerySet[WaitlistEntry]:
    return (
        WaitlistEntry.objects.filter(match=match)
        .select_related("player")
        .order_by("position", "joined_at")
    )


def _renumber_waitlist(entries: list[WaitlistEntry]) -> None:
    for position, entry in enumerate(entries, start=1):
        if entry.position != position:
            entry.position = position
            entry.save(update_fields=["position"])


def add_to_waitlist(*, match: Match, player: Player) -> WaitlistEntry:
    """Coloca o jogador na fila respeitando a regra de ordem acordada:
    **mensalistas na frente de convidados**, e dentro do mesmo tipo a ordem de
    inscrição (quem chega depois fica atrás). Reordenações manuais feitas pelo
    organizador dentro de um mesmo tipo são preservadas."""
    entries = list(waitlist_entries(match))

    existing = next((entry for entry in entries if entry.player_id == player.id), None)
    if existing is not None:
        return existing

    entry = WaitlistEntry.objects.create(
        organization=match.organization,
        match=match,
        player=player,
        position=len(entries) + 1,
    )

    if _is_mensalista(player):
        # Um mensalista entra antes do primeiro convidado da fila; entre
        # mensalistas, vale a ordem de chegada (fim do bloco de mensalistas).
        index = next(
            (i for i, existing_entry in enumerate(entries) if not _is_mensalista(existing_entry.player)),
            len(entries),
        )
    else:
        index = len(entries)

    ordered = entries[:index] + [entry] + entries[index:]
    _renumber_waitlist(ordered)
    entry.refresh_from_db(fields=["position"])
    return entry


def remove_from_waitlist(*, match: Match, player: Player) -> bool:
    entries = list(waitlist_entries(match))
    target = next((entry for entry in entries if entry.player_id == player.id), None)
    if target is None:
        return False

    target.delete()
    _renumber_waitlist([entry for entry in entries if entry.pk != target.pk])
    return True


def move_waitlist_entry(*, match: Match, player: Player, position: int) -> WaitlistEntry:
    """Reordenação manual: move o jogador para a posição informada (1-based)."""
    entries = list(waitlist_entries(match))
    target = next((entry for entry in entries if entry.player_id == player.id), None)
    if target is None:
        raise DomainError("Este jogador não está na lista de espera desta partida.")

    remaining = [entry for entry in entries if entry.pk != target.pk]
    index = max(0, min(position - 1, len(remaining)))
    _renumber_waitlist(remaining[:index] + [target] + remaining[index:])
    target.refresh_from_db(fields=["position"])
    return target


def _confirm_player(*, match: Match, player: Player, log: bool = True) -> Confirmation:
    """Grava a confirmação sem passar pelo controle de capacidade — usado pelas
    promoções da fila, onde a vaga já foi verificada."""
    confirmation = _get_or_revive_confirmation(match=match, player=player)
    previous_status = confirmation.status
    confirmation.status = Confirmation.Status.CONFIRMED
    confirmation.confirmed_at = timezone.now()
    confirmation.save()

    if log and previous_status != Confirmation.Status.CONFIRMED:
        log_action(
            organization=match.organization,
            action=AuditLog.Action.CONFIRMATION_CHANGED,
            match=match,
            player=player,
            before={"status": previous_status},
            after={"status": Confirmation.Status.CONFIRMED},
        )
    return confirmation


def fill_open_slots(*, match: Match, reason: str = "") -> list[Player]:
    """Promove jogadores da fila enquanto houver vaga na partida.

    Chamado sempre que uma vaga é liberada (alguém recusa presença, é removido
    ou fica inativo). **Não refaz o sorteio** — decisão de produto: os times já
    divulgados no grupo não são reescritos sozinhos; o organizador aciona
    "Sortear novamente" quando quiser."""
    capacity = get_match_capacity(match)
    promoted: list[Player] = []

    while count_confirmed(match) < capacity.max_players:
        entry = waitlist_entries(match).first()
        if entry is None:
            break

        player = entry.player
        entry.delete()
        _confirm_player(match=match, player=player, log=False)
        promoted.append(player)

        log_action(
            organization=match.organization,
            action=AuditLog.Action.WAITLIST_PROMOTED,
            match=match,
            player=player,
            before={"waitlist_position": entry.position},
            after={"status": Confirmation.Status.CONFIRMED},
            reason=reason,
        )

    if promoted:
        _renumber_waitlist(list(waitlist_entries(match)))
    return promoted


def promote_from_waitlist(*, match: Match, player: Player) -> Confirmation:
    """Promoção manual de um jogador específico pelo organizador.

    Diferente de `fill_open_slots`, é explícita: se a partida estiver cheia, o
    organizador precisa liberar uma vaga antes (a alternativa — empurrar outro
    para fora automaticamente — seria destrutiva e silenciosa)."""
    entries = list(waitlist_entries(match))
    target = next((entry for entry in entries if entry.player_id == player.id), None)
    if target is None:
        raise DomainError("Este jogador não está na lista de espera desta partida.")

    capacity = get_match_capacity(match)
    if count_confirmed(match) >= capacity.max_players:
        raise DomainError(
            f"A partida já está com a capacidade máxima ({capacity.max_players} jogadores). "
            "Libere uma vaga antes de promover alguém da lista de espera."
        )

    position = target.position
    target.delete()
    confirmation = _confirm_player(match=match, player=player, log=False)
    _renumber_waitlist([entry for entry in entries if entry.pk != target.pk])

    log_action(
        organization=match.organization,
        action=AuditLog.Action.WAITLIST_PROMOTED,
        match=match,
        player=player,
        before={"waitlist_position": position},
        after={"status": Confirmation.Status.CONFIRMED},
    )
    return confirmation


@transaction.atomic
def enforce_match_capacity(*, match: Match) -> list[Player]:
    """Garante que a quantidade de confirmados nunca ultrapasse a configuração
    da partida, movendo o excedente para a fila **sem descartar ninguém**.

    Roda antes de todo sorteio e depois de operações em lote. Quem sai são os
    últimos pela mesma regra da fila (convidados antes de mensalistas, e dentro
    do tipo os que confirmaram por último), e eles entram no topo da fila —
    já estavam confirmados, então têm precedência sobre quem já esperava."""
    capacity = get_match_capacity(match)
    confirmations = list(confirmed_confirmations(match))
    if len(confirmations) <= capacity.max_players:
        return []

    ranked = sorted(
        confirmations,
        key=lambda c: (
            0 if _is_mensalista(c.player) else 1,
            c.confirmed_at or timezone.now(),
            c.id,
        ),
    )
    overflow = ranked[capacity.max_players :]

    bumped: list[Player] = []
    for confirmation in overflow:
        player = confirmation.player
        confirmation.status = Confirmation.Status.PENDING
        confirmation.confirmed_at = None
        confirmation.save(update_fields=["status", "confirmed_at"])
        add_to_waitlist(match=match, player=player)
        bumped.append(player)

        log_action(
            organization=match.organization,
            action=AuditLog.Action.WAITLIST_ADDED,
            match=match,
            player=player,
            before={"status": Confirmation.Status.CONFIRMED},
            after={"status": "waitlisted"},
            reason="Capacidade da partida atingida.",
        )

    # Os que saíram voltam para o topo da fila, preservando a ordem entre eles.
    entries = list(waitlist_entries(match))
    bumped_ids = {player.id for player in bumped}
    front = [entry for entry in entries if entry.player_id in bumped_ids]
    back = [entry for entry in entries if entry.player_id not in bumped_ids]
    _renumber_waitlist(front + back)

    return bumped


# ---------------------------------------------------------------------------
# Confirmação de presença
# ---------------------------------------------------------------------------


@dataclass
class ConfirmationOutcome:
    """Resultado de uma tentativa de confirmação. `waitlisted=True` significa
    que a partida estava cheia e o jogador entrou na fila em vez de ser
    confirmado — a API deixa isso explícito para a interface poder avisar."""

    player: Player
    status: str
    confirmation: Confirmation | None = None
    waitlisted: bool = False
    waitlist_position: int | None = None
    promoted: list[Player] = field(default_factory=list)


def _get_or_revive_confirmation(*, match: Match, player: Player) -> Confirmation:
    """Busca em `all_objects` de propósito: uma confirmação soft-deletada
    continua ocupando o par (match, player) no banco. Com o manager padrão o
    `get_or_create` não a enxergava, tentava um INSERT e estourava
    IntegrityError. Aqui a linha antiga é reaproveitada (revivida)."""
    confirmation = Confirmation.all_objects.filter(match=match, player=player).first()
    if confirmation is None:
        return Confirmation(match=match, player=player, status=Confirmation.Status.PENDING)
    if confirmation.is_deleted:
        confirmation.is_deleted = False
        confirmation.deleted_at = None
    return confirmation


@transaction.atomic
def set_confirmation(*, match: Match, player: Player, status: str, allow_waitlist: bool = True) -> ConfirmationOutcome:
    """Aplica o status de presença respeitando a capacidade da partida.

    - Confirmar com a partida cheia coloca o jogador na **fila de espera**
      (`waitlisted=True`), nunca estoura o teto configurado.
    - Recusar/pendenciar libera a vaga e **promove automaticamente** o primeiro
      da fila.
    """
    if player.is_deleted or player.status != Player.Status.ATIVO:
        raise DomainError(
            f"{player.name} está inativo ou removido e não pode ter presença confirmada. "
            "Reative o jogador antes de confirmar."
        )

    capacity = get_match_capacity(match)
    confirmation = _get_or_revive_confirmation(match=match, player=player)
    previous_status = confirmation.status

    if status == Confirmation.Status.CONFIRMED:
        already_confirmed = previous_status == Confirmation.Status.CONFIRMED and not confirmation.is_deleted
        if not already_confirmed and allow_waitlist and count_confirmed(match) >= capacity.max_players:
            entry = add_to_waitlist(match=match, player=player)
            log_action(
                organization=match.organization,
                action=AuditLog.Action.WAITLIST_ADDED,
                match=match,
                player=player,
                before={"status": previous_status},
                after={"status": "waitlisted", "waitlist_position": entry.position},
                reason="Capacidade da partida atingida.",
            )
            return ConfirmationOutcome(
                player=player,
                status="waitlisted",
                waitlisted=True,
                waitlist_position=entry.position,
            )
        remove_from_waitlist(match=match, player=player)

    confirmation.status = status
    confirmation.confirmed_at = timezone.now() if status == Confirmation.Status.CONFIRMED else None
    confirmation.save()

    if previous_status != status:
        log_action(
            organization=match.organization,
            action=AuditLog.Action.CONFIRMATION_CHANGED,
            match=match,
            player=player,
            before={"status": previous_status},
            after={"status": status},
        )

    promoted: list[Player] = []
    if status != Confirmation.Status.CONFIRMED:
        remove_from_waitlist(match=match, player=player)
        promoted = fill_open_slots(match=match)

    return ConfirmationOutcome(
        player=player,
        status=status,
        confirmation=confirmation,
        promoted=promoted,
    )


@dataclass
class BulkConfirmationResult:
    confirmed: int = 0
    waitlisted: int = 0
    declined: int = 0


@transaction.atomic
def set_all_confirmations(*, match: Match, status: str) -> BulkConfirmationResult:
    """Aplica o mesmo status de presença a todos os jogadores ativos da
    organização de uma vez (botões "Confirmar todos"/"Desmarcar todos").

    Passa pelo `set_confirmation` jogador a jogador de propósito: a auditoria de
    cada mudança continua sendo registrada e a **capacidade é respeitada** —
    confirmar todos numa partida de 14 vagas confirma 14 e enfileira o resto,
    em vez de estourar o teto."""
    # Mensalistas primeiro: quando a organização tem mais jogadores do que a
    # partida comporta, quem ocupa as vagas segue a mesma regra de prioridade da
    # fila. `order_by("player_type", ...)` ordenaria alfabeticamente e colocaria
    # "convidado" na frente de "mensalista" — exatamente o oposto.
    # Mesmo escopo do roster: o cadastro da organização **mais** os convidados
    # temporários desta partida. Sem o filtro, "Confirmar todos" arrastaria para
    # dentro os convidados temporários de *outras* partidas, que nem cadastro
    # são.
    players = sorted(
        Player.objects.filter(organization=match.organization, status=Player.Status.ATIVO)
        .filter(Q(is_temporary=False) | Q(confirmations__match=match))
        .distinct(),
        key=lambda player: (0 if _is_mensalista(player) else 1, player.name),
    )

    result = BulkConfirmationResult()
    for player in players:
        outcome = set_confirmation(match=match, player=player, status=status)
        if outcome.waitlisted:
            result.waitlisted += 1
        elif outcome.status == Confirmation.Status.CONFIRMED:
            result.confirmed += 1
        else:
            result.declined += 1
    return result


def _default_guest_position(organization) -> Position:
    """Posição atribuída a um convidado criado pelo reconhecimento de nomes.

    Antes usava a **última** posição por `sort_order`, o que com o seed padrão
    (GOL, ZAG, ME, AT) transformava todo convidado em Atacante — colar 16 nomes
    criava 16 atacantes e destruía o critério de distribuição por posição do
    sorteio. Agora escolhe a primeira posição de linha (a de menor `sort_order`
    que não seja goleiro), caindo para a primeira disponível se não houver."""
    positions = list(Position.objects.filter(organization=organization).order_by("sort_order"))
    if not positions:
        raise DomainError(
            "Esta organização não tem nenhuma posição cadastrada — "
            "cadastre as posições antes de adicionar jogadores."
        )
    return next((position for position in positions if position.code.upper() != "GOL"), positions[0])


@transaction.atomic
def quick_confirm_names(*, match: Match, raw_names: list[str]) -> list[dict]:
    """Confirma presença a partir de uma lista de nomes colados manualmente.

    Cada linha é primeiro **decomposta** (`parse_roster_line`): a numeração da
    lista, os emojis e as anotações do organizador ("(Sacra)", "PAGO") saem, e
    sobra só o nome. Sem isso, a lista real do WhatsApp — numerada — não
    reconhecia mensalista nenhum e criava um convidado duplicado por linha.

    O nome limpo é comparado com os mensalistas ativos da organização que
    **ainda não estão confirmados nesta partida** (ver abaixo); quando não há um
    mensalista parecido o suficiente, um jogador convidado é criado (ou
    reaproveitado, se já existir um convidado com esse nome exato) e confirmado
    no lugar — permitindo corrigir depois via `reassign_confirmation`.

    Uma linha que **repete** alguém já confirmado é relatada como
    `ja_confirmado` e não mexe em nada: não reconfirma (seria um no-op
    invisível) nem cria convidado homônimo. "Repete" é exigente de propósito
    dentro da lista colada — ver `REPEAT_THRESHOLD`: parecer um pouco com quem
    já entrou não é ser a mesma pessoa, e tratar como repetição deixava alguém
    de verdade fora da partida em silêncio.

    Nenhuma linha some: uma linha de onde não sobra nome nenhum ("2-" sozinho,
    um emoji solto) volta como `linha_invalida` para o organizador ver, em vez
    de ser descartada sem aviso.

    Linhas marcadas com 👋/❌ (quem saiu da lista) são **relatadas e não
    confirmadas**: entrar em campo quem desistiu é um erro silencioso; aparecer
    na conferência como "fora da lista" é visível e o organizador confirma na
    mão se for engano.

    Nomes que chegam com a partida já cheia entram na **fila de espera**, e a
    resposta informa isso linha a linha."""
    organization = match.organization
    mensalistas = list(
        Player.objects.filter(
            organization=organization,
            player_type=Player.PlayerType.MENSALISTA,
            status=Player.Status.ATIVO,
        )
    )

    # Só concorre ao reconhecimento quem **ainda não está confirmado** nesta
    # partida — e cada mensalista reconhecido sai da disputa na hora.
    #
    # Sem isso, duas linhas parecidas ("João" e "João Macena") casavam com o
    # mesmo mensalista: a segunda reconfirmava quem já estava dentro (no-op
    # silencioso) e a pessoa de verdade daquela linha simplesmente não entrava
    # na partida. O mesmo acontecia ao colar a lista duas vezes, ou ao colar
    # depois de já ter confirmado alguém na mão.
    confirmed_ids = {confirmation.player_id for confirmation in confirmed_confirmations(match)}
    available = [player for player in mensalistas if player.id not in confirmed_ids]
    # Quem já estava confirmado **antes** desta chamada e quem foi reconhecido
    # **por uma linha desta lista** são coisas diferentes, e a pergunta "esta
    # linha é repetição?" se responde diferente nos dois casos:
    #
    # - Já estava dentro: recolar a lista é rotina (o grupo atualiza e o
    #   organizador cola de novo). Aqui vale a tolerância normal, senão a
    #   segunda colagem criaria um convidado fantasma homônimo de cada
    #   mensalista reconhecido por semelhança.
    # - Entrou por uma linha desta mesma lista: aí duas linhas são duas pessoas.
    #   Só um nome praticamente igual é repetição (`REPEAT_THRESHOLD`); parecido
    #   é outra pessoa e precisa entrar.
    confirmed_before = [player for player in mensalistas if player.id in confirmed_ids]
    claimed_now: list[Player] = []
    # Resolvida sob demanda: uma lista em que todos os nomes são reconhecidos
    # não precisa de posição padrão nenhuma, e a organização não deve ser
    # obrigada a ter posições cadastradas para usar o reconhecimento.
    default_position: Position | None = None

    results = []
    for raw in raw_names:
        line = parse_roster_line(raw)
        if line is None:
            if not raw.strip():
                # Linha em branco não é linha: não há o que mostrar ao
                # organizador nem o que ele possa corrigir.
                continue
            # Tinha texto, mas não sobrou nome nenhum ("2-" sozinho, um emoji
            # solto). A linha é **relatada**, não descartada: sumir em silêncio
            # é como a lista colada entrava na partida com menos gente do que o
            # organizador contou, sem nada na tela apontando qual linha se
            # perdeu.
            results.append(
                {
                    "input_name": raw.strip(),
                    "parsed_name": "",
                    "resolution": "linha_invalida",
                    "confidence": 0.0,
                    "player_id": None,
                    "player_name": None,
                    "player_type": None,
                    "waitlisted": False,
                    "waitlist_position": None,
                }
            )
            continue

        if line.is_out:
            results.append(
                {
                    "input_name": line.raw,
                    "parsed_name": line.name,
                    "resolution": "fora_da_lista",
                    "confidence": 0.0,
                    "player_id": None,
                    "player_name": None,
                    "player_type": None,
                    "waitlisted": False,
                    "waitlist_position": None,
                }
            )
            continue

        name = line.name
        player, score = best_match(name, available)
        resolution = "mensalista"

        if player is None:
            # Não sobrou mensalista disponível parecido com este nome. Antes de
            # criar um convidado, confere os que **já estão confirmados**: se a
            # linha repete alguém que já está na partida, criar um convidado
            # homônimo seria exatamente o duplicado que o reconhecimento existe
            # para evitar. Os dois grupos são consultados com exigências
            # diferentes — ver o comentário de `confirmed_before`/`claimed_now`.
            repeated, repeated_score = best_match(name, confirmed_before)
            if repeated is None:
                repeated, repeated_score = best_match(
                    name, claimed_now, threshold=REPEAT_THRESHOLD
                )
            if repeated is not None:
                results.append(
                    {
                        "input_name": line.raw,
                        "parsed_name": name,
                        "resolution": "ja_confirmado",
                        "confidence": round(repeated_score, 2),
                        "player_id": repeated.id,
                        "player_name": repeated.name,
                        "player_type": repeated.player_type,
                        "waitlisted": False,
                        "waitlist_position": None,
                    }
                )
                continue

            player = Player.objects.filter(
                organization=organization,
                player_type=Player.PlayerType.CONVIDADO,
                name__iexact=name,
            ).first()
            if player is None:
                if default_position is None:
                    default_position = _default_guest_position(organization)
                player = Player.objects.create(
                    organization=organization,
                    name=name,
                    player_type=Player.PlayerType.CONVIDADO,
                    primary_position=default_position,
                    # Convidado da lista colada existe só para esta partida: ele
                    # precisa de um registro para entrar no sorteio, mas não é
                    # cadastro — não aparece na tela de Jogadores e some quando
                    # a partida termina (`cleanup_temporary_guests`).
                    is_temporary=True,
                )
            resolution = "convidado_criado"
        else:
            # Reconhecido: sai da disputa e passa a contar como já confirmado,
            # para que uma linha repetida caia no caminho "ja_confirmado".
            available.remove(player)
            claimed_now.append(player)

        outcome = set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
        results.append(
            {
                # A linha original volta para a tela (o organizador reconhece o
                # que colou); `parsed_name` mostra o que de fato foi procurado,
                # que é o que explica um reconhecimento inesperado.
                "input_name": line.raw,
                "parsed_name": name,
                "resolution": resolution,
                "confidence": round(score, 2),
                "player_id": player.id,
                "player_name": player.name,
                "player_type": player.player_type,
                "waitlisted": outcome.waitlisted,
                "waitlist_position": outcome.waitlist_position,
            }
        )
    return results


@transaction.atomic
def reassign_confirmation(*, match: Match, wrong_player: Player, correct_player: Player) -> Confirmation:
    """Corrige um nome que o reconhecimento automático confundiu: recusa a
    confirmação do jogador errado (geralmente um convidado criado por engano)
    e confirma o mensalista correto no lugar. Se o jogador errado era um
    convidado sem nenhuma outra confirmação, ele é removido (era só um "fantasma"
    criado por não termos reconhecido o nome).

    A ordem importa: o errado sai **antes** de o correto entrar, senão a vaga
    liberada seria ocupada por quem está na fila e o correto cairia na espera.

    O mensalista escolhido precisa estar **fora** da partida. Apontar a correção
    para alguém que já está confirmado não corrige nada: o convidado errado sai,
    o mensalista continua onde estava e a partida perde uma vaga sem ninguém
    perceber. A tela já só oferece quem não está confirmado; aqui a regra é
    garantida também para quem chama a API direto."""
    if correct_player.id in {
        confirmation.player_id for confirmation in confirmed_confirmations(match)
    }:
        raise DomainError(
            f"{correct_player.name} já está confirmado nesta partida — "
            "escolha um jogador que ainda não esteja na lista."
        )

    set_confirmation(match=match, player=wrong_player, status=Confirmation.Status.DECLINED, allow_waitlist=False)
    outcome = set_confirmation(match=match, player=correct_player, status=Confirmation.Status.CONFIRMED)

    remaining = Confirmation.objects.filter(player=wrong_player).exclude(
        status=Confirmation.Status.DECLINED
    )
    if wrong_player.player_type == Player.PlayerType.CONVIDADO and not remaining.exists():
        remove_from_waitlist(match=match, player=wrong_player)
        wrong_player.delete()

    return outcome.confirmation


# ---------------------------------------------------------------------------
# Ciclo de vida da partida
# ---------------------------------------------------------------------------


def cleanup_temporary_guests(*, match: Match) -> list[Player]:
    """Remove os convidados temporários criados para esta partida.

    Chamado quando a partida termina. O convidado da lista colada nunca foi
    cadastro — ele existiu só para poder entrar no sorteio. A remoção é
    soft-delete, então o **resultado já divulgado continua intacto**: `TeamPlayer`
    guarda posição e estrelas da época, e `Player.Meta.base_manager_name` garante
    que o nome continue legível mesmo removido.

    Um temporário que ainda esteja confirmado em **outra** partida em aberto é
    preservado — a mesma pessoa pode ter sido colada na lista da semana
    seguinte antes de esta partida ser concluída."""
    encerradas = [Match.Status.COMPLETED, Match.Status.CANCELED]
    candidatos = Player.objects.filter(
        organization=match.organization,
        is_temporary=True,
        confirmations__match=match,
    ).distinct()

    removidos: list[Player] = []
    for player in candidatos:
        ainda_em_uso = (
            Confirmation.objects.filter(player=player, status=Confirmation.Status.CONFIRMED)
            .exclude(match=match)
            .exclude(match__status__in=encerradas)
            .exists()
        )
        if ainda_em_uso:
            continue
        player.delete()
        removidos.append(player)
    return removidos


def cancel_match(*, match: Match) -> Match:
    """Cancela a partida sem apagá-la. Reversível por `reactivate_match` — foi a
    forma escolhida (em vez de soft-delete) para cancelar uma ocorrência de jogo
    recorrente sem que a task de geração a recriasse."""
    match.status = Match.Status.CANCELED
    match.save(update_fields=["status"])
    return match


def reactivate_match(*, match: Match) -> Match:
    match.status = Match.Status.DRAWN if match.has_draw else Match.Status.SCHEDULED
    match.save(update_fields=["status"])
    return match
