from dataclasses import asdict

import structlog
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.audit.services import log_action
from apps.matches.models import Match
from apps.matches.services import (
    cleanup_temporary_guests,
    enforce_match_capacity,
    get_confirmed_players,
    get_match_capacity,
)
from apps.players.models import Player as PlayerModel
from common.exceptions import DomainError, InsufficientPlayersError

from .domain.entities import Player as PlayerEntity
from .domain.formations import (
    AssignablePlayer,
    Formation,
    assign_players_to_slots,
    build_slots,
    default_formation,
    is_valid_formation,
    parse_formation,
)
from .domain.scoring import ScoringWeights
from .domain.strategies.simulated_annealing import SimulatedAnnealingStrategy
from .models import Draw, Team, TeamPlayer, TeamResult
from .repositories import PairHistoryRepository

logger = structlog.get_logger(__name__)


def _team_name(index: int) -> str:
    return f"Time {chr(ord('A') + index)}"


def line_positions_for(organization) -> list:
    """Posições de linha da organização, da defesa para o ataque.

    "De linha" = tudo que não é goleiro. O goleiro é identificado pelo `code`
    `GOL` — que é o que `seed_default_positions` cria e o que a interface
    oferece. Uma organização que renomeie a posição continua funcionando: o que
    importa para a formação é a **ordem**, e o goleiro apenas não entra na
    notação."""
    from apps.players.models import Position

    return list(
        Position.objects.filter(organization=organization, is_active=True)
        .exclude(code__iexact="GOL")
        .order_by("sort_order", "name")
    )


def goalkeeper_position_for(organization):
    from apps.players.models import Position

    return Position.objects.filter(
        organization=organization, is_active=True, code__iexact="GOL"
    ).first()


def _line_players_per_team(
    *, confirmed_players, team_of, use_secondary, teams_count: int, organization
) -> list[int]:
    """Quantos jogadores **de linha** cada time recebeu de fato.

    O goleiro não entra na formação — ele tem faixa própria no desenho —, então
    a contagem precisa descontá-lo. E precisa ser por time, não uma média: com
    22 confirmados em 4 times, dois times ficam com 6 e dois com 5, e uma
    formação de 6 é válida num e inválida no outro.

    Quem é goleiro se decide pela posição **usada** no sorteio, não pela
    primária — é o mesmo critério de `apply_formation_to_team`. Alguém escalado
    na secundária conta na linha em que vai jogar; contar pela primária faria a
    validação divergir da aplicação, e o erro apareceria só quando o algoritmo
    resolvesse usar a secundária de alguém.
    """
    goalkeeper = goalkeeper_position_for(organization)
    contagem = [0] * teams_count
    for index, player in enumerate(confirmed_players):
        posicao = player.secondary_position_id if use_secondary[index] else player.primary_position_id
        if goalkeeper and posicao == goalkeeper.id:
            continue
        contagem[team_of[index]] += 1
    return contagem


def resolve_formation(value: str | None, line_players: int) -> Formation | None:
    """Traduz o que veio da API em uma formação utilizável.

    `None`/vazio significa "sem formação" — e é o comportamento **padrão**, que
    preserva exatamente o sorteio de antes desta funcionalidade.
    """
    if not value:
        return None

    formation = parse_formation(value)
    if not is_valid_formation(formation, line_players):
        raise DomainError(
            f"A formação {formation.key} distribui {formation.line_players} jogadores de linha, "
            f"mas este time tem {line_players}."
        )
    return formation


def apply_formation_to_team(*, team: Team, formation: Formation | None) -> None:
    """Encaixa os jogadores já atribuídos ao time nas vagas da formação.

    **Não move ninguém entre times** — quem joga com quem é decisão do
    algoritmo de sorteio, e ela não é revista aqui. O que muda é a vaga de cada
    um no desenho e a posição registrada no snapshot.

    Sem formação, limpa as vagas: o campo volta a agrupar pelo `sort_order` da
    posição, que é o comportamento histórico.
    """
    team_players = list(
        team.team_players.select_related("player", "position_snapshot").order_by("id")
    )
    if not team_players:
        return

    if formation is None:
        TeamPlayer.objects.filter(team=team).update(line_index=None, slot_index=None)
        return

    organization = team.draw.organization
    line_positions = line_positions_for(organization)
    if not line_positions:
        return

    sort_order_by_position = {position.id: position.sort_order for position in line_positions}
    goalkeeper = goalkeeper_position_for(organization)
    if goalkeeper:
        sort_order_by_position[goalkeeper.id] = goalkeeper.sort_order

    # O goleiro não entra na formação: ele tem a própria faixa no desenho e não
    # disputa vaga com os jogadores de linha.
    goalkeepers = (
        [tp for tp in team_players if goalkeeper and tp.position_snapshot_id == goalkeeper.id]
        if goalkeeper
        else []
    )
    line_players = [tp for tp in team_players if tp not in goalkeepers]

    slots = build_slots(formation, [position.id for position in line_positions])

    assignable = [
        AssignablePlayer(
            id=tp.id,
            primary_position_id=tp.player.primary_position_id,
            secondary_position_id=tp.player.secondary_position_id,
            primary_sort_order=sort_order_by_position.get(tp.player.primary_position_id, 0),
        )
        for tp in line_players
    ]
    assignment = assign_players_to_slots(assignable, slots, sort_order_by_position)

    position_by_id = {position.id: position for position in line_positions}
    updates: list[TeamPlayer] = []

    for team_player in line_players:
        slot = assignment.get(team_player.id)
        if slot is None:
            # Jogador excedente (time com um a mais que a formação comporta —
            # caso legítimo da regra §6.3). Fica sem vaga fixa e o campo o
            # desenha na linha mais numerosa. Ninguém é descartado.
            team_player.line_index = None
            team_player.slot_index = None
        else:
            team_player.line_index = slot.line_index
            team_player.slot_index = slot.slot_index
            position = position_by_id.get(slot.position_id)
            if position is not None:
                team_player.position_snapshot = position
                team_player.used_secondary_position = (
                    position.id == team_player.player.secondary_position_id
                )
        updates.append(team_player)

    # O goleiro fica numa linha própria, antes da primeira da formação.
    for index, team_player in enumerate(goalkeepers):
        team_player.line_index = None
        team_player.slot_index = index
        updates.append(team_player)

    TeamPlayer.objects.bulk_update(
        updates, ["line_index", "slot_index", "position_snapshot", "used_secondary_position"]
    )


def execute_draw(
    *,
    match: Match,
    executed_by=None,
    trigger: str = Draw.Trigger.MANUAL,
    formation: str | None = None,
    formations_by_team: dict[int, str] | None = None,
) -> Draw:
    """
    Ponto de entrada único do sorteio — chamado tanto pela view de sorteio
    manual quanto por `execute_automatic_draw` (task Celery).

    A configuração da partida manda em tudo: o número de times, o mínimo e o
    **máximo** de jogadores saem de `get_match_capacity`. Confirmados acima da
    capacidade não são descartados — vão para a lista de espera antes do
    sorteio (`enforce_match_capacity`).

    `trigger` só descreve a origem (manual/automático); as regras do sorteio são
    exatamente as mesmas nos dois caminhos — equilíbrio, posições, histórico de
    duplas, teto de capacidade, snapshot e auditoria.

    ## Formação

    `formation` (e `formations_by_team`, indexado pela **ordem** do time: 0, 1,
    2…) é aplicada **depois** que o algoritmo distribuiu os jogadores. O motor
    de sorteio não sabe que formação existe: quem joga com quem continua sendo
    decidido só pelos critérios de equilíbrio, posição, histórico de duplas,
    separação dos piores e distribuição de convidados.

    Sem formação informada, nada muda em relação ao comportamento anterior —
    `line_index`/`slot_index` ficam nulos e o campo desenha pelo `sort_order`
    da posição de cada jogador, como sempre fez.
    """
    capacity = get_match_capacity(match)

    bumped = enforce_match_capacity(match=match)
    if bumped:
        logger.info(
            "draw_capacity_enforced",
            match_id=match.id,
            organization_id=match.organization_id,
            moved_to_waitlist=[player.id for player in bumped],
        )

    confirmed_players = get_confirmed_players(match)

    if len(confirmed_players) < capacity.min_players:
        raise InsufficientPlayersError(
            f"Apenas {len(confirmed_players)} jogador(es) confirmado(s); "
            f"o mínimo para esta partida é {capacity.min_players}."
        )

    player_entities = [
        PlayerEntity(
            id=player.id,
            skill_level=player.skill_level,
            primary_position_id=player.primary_position_id,
            secondary_position_id=player.secondary_position_id,
            is_guest=player.player_type == PlayerModel.PlayerType.CONVIDADO,
        )
        for player in confirmed_players
    ]

    pair_history = PairHistoryRepository.compute(
        organization=match.organization,
        window=settings.DRAW_DEFAULT_PAIRING_HISTORY_WINDOW,
        exclude_match=match,
    )

    weights = ScoringWeights()
    strategy = SimulatedAnnealingStrategy()
    solution = strategy.solve(
        players=player_entities,
        teams_count=capacity.teams_count,
        pair_history=pair_history,
        weights=weights,
    )

    # A formação é validada **antes** de gravar qualquer coisa: uma notação
    # inválida precisa recusar o pedido inteiro, não deixar um sorteio pela
    # metade.
    #
    # A validação usa a contagem **real** de cada time, não a capacidade
    # configurada. Validar contra a capacidade parecia mais estável ("o time
    # sempre tem N"), mas só funciona quando a partida enche: numa configurada
    # para 4×8 com 24 confirmados, cada time fica com 6 e a formação `3-3` —
    # que é exatamente a certa — era recusada com "distribui 6, mas este time
    # tem 8". O organizador via um erro sobre um time que não existia.
    line_counts = _line_players_per_team(
        confirmed_players=confirmed_players,
        team_of=solution.team_of,
        use_secondary=solution.use_secondary,
        teams_count=capacity.teams_count,
        organization=match.organization,
    )
    resolved_by_team: dict[int, Formation | None] = {}
    for index in range(capacity.teams_count):
        raw = (formations_by_team or {}).get(index) or formation
        resolved_by_team[index] = (
            resolve_formation(raw, line_counts[index]) if raw else None
        )
    # A formação do sorteio é a do primeiro time: com times de tamanhos
    # diferentes, cada um tem a sua, e este campo é o resumo.
    resolved_default = resolved_by_team.get(0)

    with transaction.atomic():
        Draw.objects.filter(match=match, is_current=True).update(is_current=False)

        draw = Draw.objects.create(
            organization=match.organization,
            match=match,
            algorithm="simulated_annealing",
            trigger=trigger,
            formation=resolved_default.key if resolved_default else "",
            weights=asdict(weights),
            score_balance=solution.score.balance,
            score_position=solution.score.position,
            score_repetition=solution.score.repetition,
            total_score=solution.score.total,
            iterations_run=solution.iterations_run,
            is_current=True,
            executed_by=executed_by,
        )

        teams = [
            Team.objects.create(
                draw=draw,
                name=_team_name(i),
                order_index=i,
                formation=resolved_by_team[i].key if resolved_by_team[i] else "",
            )
            for i in range(capacity.teams_count)
        ]

        team_players = []
        for index, player in enumerate(confirmed_players):
            team = teams[solution.team_of[index]]
            used_secondary = solution.use_secondary[index]
            position = player.secondary_position if used_secondary else player.primary_position
            team_players.append(
                TeamPlayer(
                    team=team,
                    player=player,
                    position_snapshot=position,
                    skill_snapshot=player.skill_level,
                    used_secondary_position=used_secondary,
                )
            )
        TeamPlayer.objects.bulk_create(team_players)

        # A formação entra aqui — depois da distribuição, nunca durante. Ela
        # só reposiciona no desenho quem o algoritmo já colocou em cada time.
        for index, team in enumerate(teams):
            apply_formation_to_team(team=team, formation=resolved_by_team[index])

        match.status = Match.Status.DRAWN
        match.draw_executed_at = timezone.now()
        match.save(update_fields=["status", "draw_executed_at"])

    log_action(
        organization=match.organization,
        action=AuditLog.Action.DRAW_CREATED,
        match=match,
        draw=draw,
        user=executed_by,
        after={
            "algorithm": draw.algorithm,
            "trigger": draw.trigger,
            "formation": draw.formation,
            "formations_by_team": {
                str(index): (value.key if value else "") for index, value in resolved_by_team.items()
            },
            "teams_count": capacity.teams_count,
            "total_score": draw.total_score,
            "players_count": len(confirmed_players),
            "max_players": capacity.max_players,
            "moved_to_waitlist": len(bumped),
            # `Draw` só tem colunas para os três critérios originais; os dois
            # novos (separação dos piores e distribuição de convidados) ficam
            # registrados aqui — a trilha prova que a restrição foi avaliada e
            # com que custo, sem precisar de colunas novas.
            "score_weakest_split": solution.score.weakest_split,
            "score_guest_balance": solution.score.guest_balance,
        },
    )

    return draw


def execute_automatic_draw(*, match: Match) -> Draw | None:
    """Sorteio automático de uma partida agendada — o único caminho que a task
    periódica usa.

    Concentra aqui **toda** a proteção contra duplicidade, porque é o único
    caminho em que ninguém está olhando a tela para perceber um sorteio repetido:

    1. `SELECT ... FOR UPDATE` na partida: dois workers (ou dois ticks do beat
       que se sobrepõem) serializam nesta linha, então o segundo só entra depois
       que o primeiro gravou o sorteio — e aí já encontra a partida sorteada.
    2. A elegibilidade é reavaliada **com a linha travada e recarregada do
       banco**, não com o objeto que a task carregou antes: `automatic_draw`
       (partida avulsa sem horário nunca passa daqui) e `has_draw` (partida já
       sorteada nunca é sorteada de novo — inclusive depois de reiniciar a
       aplicação, já que a evidência está no banco e não em memória).

    Devolve `None` quando a partida não é elegível — não é erro, é o caso
    normal de uma partida que outro processo acabou de sortear.
    """
    with transaction.atomic():
        # `of=("self",)` trava só a linha da partida. Sem isso o Postgres recusa
        # o `FOR UPDATE` ("cannot be applied to the nullable side of an outer
        # join"), porque `recurring_game` é opcional e vira LEFT JOIN — e travar
        # o jogo recorrente também seria errado: ele é compartilhado por todas
        # as ocorrências.
        locked = (
            Match.objects.select_for_update(of=("self",))
            .select_related("recurring_game", "organization")
            .get(pk=match.pk)
        )

        if not locked.is_automatic_draw_pending:
            logger.info(
                "auto_draw_not_eligible",
                match_id=locked.id,
                organization_id=locked.organization_id,
                automatic_draw=locked.automatic_draw,
                has_draw=locked.has_draw,
                status=locked.status,
            )
            return None

        return execute_draw(match=locked, executed_by=None, trigger=Draw.Trigger.AUTOMATIC)


def run_due_automatic_draw(*, match: Match) -> Draw | None:
    """Recuperação do sorteio automático **vencido** — o gatilho que não depende
    do relógio do Celery.

    A task periódica é o disparo pontual, mas sozinha ela tem dois buracos:

    1. Se o beat/worker não estiver de pé (ambiente local sem Celery, worker
       caído em produção), o horário passa e nada acontece — sem registro.
    2. Mesmo com o beat rodando, a janela de tolerância fecha 60 min depois do
       horário. Uma partida avulsa **editada depois disso** para ganhar horário
       de sorteio nunca era sorteada: a configuração nascia já fora da janela.

    Por isso este serviço é chamado nos pontos de contato naturais — ao salvar
    a partida (criação/edição) e ao abrir a tela dela. O critério é só a
    configuração atual (`is_automatic_draw_due`); a origem da partida não
    importa. Configurar um horário que já passou, no dia da partida, significa
    "sortear agora".

    Toda a proteção contra duplicidade continua concentrada em
    `execute_automatic_draw` (trava de linha + reavaliação) — chamar isto de
    vários gatilhos ao mesmo tempo não gera dois sorteios.

    `DomainError` (ex.: mínimo de confirmados não atingido) não propaga: quem
    está salvando ou abrindo a partida não pode levar erro por causa de um
    sorteio que é responsabilidade do sistema. Fica no log, e a tentativa se
    repete no próximo gatilho — inclusive na releitura da tela logo depois de
    uma confirmação de presença completar o mínimo.
    """
    if not match.is_automatic_draw_due:
        return None

    try:
        return execute_automatic_draw(match=match)
    except DomainError as error:
        logger.info(
            "due_auto_draw_skipped",
            match_id=match.id,
            organization_id=match.organization_id,
            detail=str(error),
        )
        return None


def _require_current(draw: Draw) -> None:
    """Só o sorteio **vigente** aceita edição.

    A documentação promete histórico imutável, e antes essa trava existia
    apenas na interface — pela API dava para reescrever um sorteio antigo."""
    if not draw.is_current:
        raise DomainError(
            "Este sorteio faz parte do histórico e não pode ser alterado. "
            "Só o sorteio vigente aceita alterações."
        )


def _player_state(team_player: TeamPlayer) -> dict:
    """Retrato do jogador no resultado, para o antes/depois da auditoria.

    Antes a trilha guardava só o time. Numa movimentação manual, a posição é
    metade do que mudou — e era exatamente a metade que não ficava registrada.
    """
    return {
        "team_id": team_player.team_id,
        "team_name": team_player.team.name,
        "position_id": team_player.position_snapshot_id,
        "position_code": team_player.position_snapshot.code if team_player.position_snapshot else None,
        "line_index": team_player.line_index,
        "slot_index": team_player.slot_index,
    }


def _free_slot_in(team: Team, exclude_team_player_id: int | None = None):
    """Uma vaga livre na formação do time, se houver.

    Usada quando um jogador chega de outro time: ele precisa aterrissar numa
    vaga do desenho, não em cima de alguém."""
    if not team.formation:
        return None

    formation = parse_formation(team.formation)
    line_positions = line_positions_for(team.draw.organization)
    if not line_positions:
        return None

    slots = build_slots(formation, [position.id for position in line_positions])
    taken = {
        (tp.line_index, tp.slot_index)
        for tp in team.team_players.all()
        if tp.id != exclude_team_player_id and tp.line_index is not None
    }
    for slot in slots:
        if (slot.line_index, slot.slot_index) not in taken:
            return slot
    return None


def move_player_to_team(
    *, draw: Draw, team_player_id: int, target_team_id: int, reason: str = ""
) -> TeamPlayer:
    """
    Move um jogador para outro time do mesmo sorteio.

    Movimentação manual **não roda o algoritmo de novo**: nenhum `Draw` novo é
    criado e os scores gravados continuam sendo os da execução original (eles
    descrevem *aquele* sorteio). Quem quiser recalcular usa "Sortear novamente".

    Quando o time de destino tem formação, o jogador ocupa a primeira vaga
    livre dela — e assume a posição daquela vaga. Sem vaga livre (time já
    completo), ele entra sem posição fixa no desenho e a interface avisa que a
    formação foi quebrada; recusar o movimento seria pior, porque o organizador
    tem motivos que o sistema não conhece.
    """
    _require_current(draw)

    team_player = TeamPlayer.objects.select_related("team", "player", "position_snapshot").get(
        id=team_player_id, team__draw=draw
    )
    source_team = team_player.team
    target_team = Team.objects.select_related("draw__organization").get(id=target_team_id, draw=draw)

    before = _player_state(team_player)

    team_player.team = target_team
    slot = _free_slot_in(target_team, exclude_team_player_id=team_player.id)
    fields = ["team", "line_index", "slot_index"]
    if slot is not None:
        team_player.line_index = slot.line_index
        team_player.slot_index = slot.slot_index
        position = _position_by_id(target_team.draw.organization, slot.position_id)
        if position is not None:
            team_player.position_snapshot = position
            team_player.used_secondary_position = (
                position.id == team_player.player.secondary_position_id
            )
            fields += ["position_snapshot", "used_secondary_position"]
    else:
        team_player.line_index = None
        team_player.slot_index = None

    team_player.save(update_fields=fields)
    team_player.refresh_from_db()

    log_action(
        organization=draw.organization,
        action=AuditLog.Action.PLAYER_MOVED,
        match=draw.match,
        draw=draw,
        player=team_player.player,
        team_from=source_team,
        team_to=target_team,
        before=before,
        after=_player_state(team_player),
        reason=reason,
    )

    return team_player


def _position_by_id(organization, position_id: int):
    from apps.players.models import Position

    return Position.objects.filter(organization=organization, id=position_id).first()


def change_player_position(
    *,
    draw: Draw,
    team_player_id: int,
    position_id: int | None = None,
    line_index: int | None = None,
    slot_index: int | None = None,
    reason: str = "",
) -> TeamPlayer:
    """Altera a **posição** de um jogador dentro do time dele.

    Operação que simplesmente não existia: a única edição pós-sorteio era trocar
    de time. O organizador que quisesse tirar alguém da defesa e botar no ataque
    não tinha caminho nenhum — nem pela interface, nem pela API.

    Não move ninguém de time e não roda o algoritmo. Se a vaga pedida já estiver
    ocupada, quem estava lá fica **sem vaga fixa** (e não é expulso do time):
    trocar dois jogadores de lugar é a operação `swap_players`, explícita.
    """
    _require_current(draw)

    team_player = TeamPlayer.objects.select_related("team", "player", "position_snapshot").get(
        id=team_player_id, team__draw=draw
    )
    before = _player_state(team_player)

    fields: list[str] = []

    if position_id is not None:
        position = _position_by_id(draw.organization, position_id)
        if position is None:
            raise DomainError("Esta posição não pertence à organização desta partida.")
        team_player.position_snapshot = position
        team_player.used_secondary_position = (
            position.id == team_player.player.secondary_position_id
        )
        fields += ["position_snapshot", "used_secondary_position"]

    if line_index is not None:
        # Libera a vaga de quem já estava nela — sem tirá-lo do time.
        TeamPlayer.objects.filter(
            team=team_player.team, line_index=line_index, slot_index=slot_index
        ).exclude(id=team_player.id).update(line_index=None, slot_index=None)

        team_player.line_index = line_index
        team_player.slot_index = slot_index
        fields += ["line_index", "slot_index"]

    if not fields:
        raise DomainError("Informe a posição ou a vaga de destino.")

    team_player.save(update_fields=fields)
    team_player.refresh_from_db()

    log_action(
        organization=draw.organization,
        action=AuditLog.Action.PLAYER_POSITION_CHANGED,
        match=draw.match,
        draw=draw,
        player=team_player.player,
        team_from=team_player.team,
        team_to=team_player.team,
        before=before,
        after=_player_state(team_player),
        reason=reason,
    )

    return team_player


def swap_players(
    *, draw: Draw, team_player_a_id: int, team_player_b_id: int, reason: str = ""
) -> tuple[TeamPlayer, TeamPlayer]:
    """Troca dois jogadores de lugar — time, posição e vaga.

    É **uma** operação, numa transação só, e não duas chamadas de "mover".
    A diferença importa: com duas chamadas, uma falha no meio deixaria os times
    inconsistentes (um jogador movido, o outro não) e a auditoria registraria
    meia troca. Aqui, ou os dois trocam, ou nada acontece.

    Serve tanto para trocar jogadores **entre times** (mantendo o tamanho de
    cada um, ao contrário de mover) quanto para trocar posições **dentro do
    mesmo time**.
    """
    _require_current(draw)

    if team_player_a_id == team_player_b_id:
        raise DomainError("Selecione dois jogadores diferentes para trocar.")

    with transaction.atomic():
        a = TeamPlayer.objects.select_related("team", "player", "position_snapshot").get(
            id=team_player_a_id, team__draw=draw
        )
        b = TeamPlayer.objects.select_related("team", "player", "position_snapshot").get(
            id=team_player_b_id, team__draw=draw
        )

        before_a, before_b = _player_state(a), _player_state(b)

        # Troca completa: cada um assume exatamente o lugar do outro no desenho.
        (
            a.team_id,
            b.team_id,
            a.line_index,
            b.line_index,
            a.slot_index,
            b.slot_index,
            a.position_snapshot_id,
            b.position_snapshot_id,
        ) = (
            b.team_id,
            a.team_id,
            b.line_index,
            a.line_index,
            b.slot_index,
            a.slot_index,
            b.position_snapshot_id,
            a.position_snapshot_id,
        )

        a.used_secondary_position = a.position_snapshot_id == a.player.secondary_position_id
        b.used_secondary_position = b.position_snapshot_id == b.player.secondary_position_id

        update_fields = [
            "team",
            "line_index",
            "slot_index",
            "position_snapshot",
            "used_secondary_position",
        ]
        a.save(update_fields=update_fields)
        b.save(update_fields=update_fields)

        a.refresh_from_db()
        b.refresh_from_db()

        # Um registro só para a troca: dois registros de "movido" contariam uma
        # história que não aconteceu (duas movimentações independentes).
        log_action(
            organization=draw.organization,
            action=AuditLog.Action.PLAYERS_SWAPPED,
            match=draw.match,
            draw=draw,
            player=a.player,
            team_from=Team.objects.get(id=before_a["team_id"]),
            team_to=Team.objects.get(id=before_b["team_id"]),
            before={
                "a": {"player": a.player.name, **before_a},
                "b": {"player": b.player.name, **before_b},
            },
            after={
                "a": {"player": a.player.name, **_player_state(a)},
                "b": {"player": b.player.name, **_player_state(b)},
            },
            reason=reason,
        )

    return a, b


def set_team_formation(*, draw: Draw, team_id: int, formation: str, reason: str = "") -> Team:
    """Troca a formação de um time **depois** do sorteio, reencaixando quem já
    está nele.

    Não sorteia de novo e não move ninguém entre times: os mesmos jogadores,
    outro desenho.
    """
    _require_current(draw)

    team = Team.objects.select_related("draw__organization").get(id=team_id, draw=draw)
    line_count = team.team_players.count()

    goalkeeper = goalkeeper_position_for(draw.organization)
    if goalkeeper:
        line_count -= team.team_players.filter(position_snapshot_id=goalkeeper.id).count()

    resolved = resolve_formation(formation, line_count) if formation else None

    before = {"team_id": team.id, "team_name": team.name, "formation": team.formation}

    team.formation = resolved.key if resolved else ""
    team.save(update_fields=["formation"])
    apply_formation_to_team(team=team, formation=resolved)

    log_action(
        organization=draw.organization,
        action=AuditLog.Action.FORMATION_CHANGED,
        match=draw.match,
        draw=draw,
        team_from=team,
        team_to=team,
        before=before,
        after={"team_id": team.id, "team_name": team.name, "formation": team.formation},
        reason=reason,
    )

    return team


def suggest_formations(*, line_players: int) -> list[dict]:
    """Catálogo de formações válidas para N jogadores de linha — o que a tela
    oferece na configuração do sorteio."""
    from .domain.formations import generate_formations

    options = generate_formations(line_players)
    suggested = default_formation(line_players)

    return [
        {
            "key": option.key,
            "lines": list(option.lines),
            "line_players": option.line_players,
            "line_count": option.line_count,
            "balanced": suggested is not None and option.key == suggested.key,
        }
        for option in options
    ]


def derive_team_outcomes(goals_by_team: dict[int, int]) -> dict[int, dict]:
    """Deriva vitória/empate/derrota a partir dos gols.

    Esta regra é de negócio e por isso mora **no servidor**: antes era calculada
    no `ResultsDialog` do frontend e o backend aceitava `result` pronto do
    cliente, permitindo gravar "vitória com 0 gol" e corromper as estatísticas.

    Quem fez mais gols vence; havendo empate no topo, todos os líderes ficam
    como empate e os demais como derrota. `goals_conceded` é o maior placar
    entre os adversários — com 2 times (o caso normal) é exatamente o gol do
    outro time.
    """
    if not goals_by_team:
        return {}

    best = max(goals_by_team.values())
    leaders = sum(1 for goals in goals_by_team.values() if goals == best)

    outcomes: dict[int, dict] = {}
    for team_id, goals in goals_by_team.items():
        others = [value for other_id, value in goals_by_team.items() if other_id != team_id]
        if goals == best:
            result = TeamResult.Result.DRAW if leaders > 1 else TeamResult.Result.WIN
        else:
            result = TeamResult.Result.LOSS
        outcomes[team_id] = {
            "result": result,
            "goals_scored": goals,
            "goals_conceded": max(others) if others else 0,
        }
    return outcomes


def set_match_results(*, match: Match, results: list[dict]) -> list[TeamResult]:
    """
    Registra o placar do sorteio vigente da partida. `results` é uma lista de
    `{team_id, goals_scored}` — vitória/empate/derrota e `goals_conceded` são
    **derivados aqui**, não recebidos do cliente.

    Exige o placar de **todos** os times do sorteio e rejeita times que não
    pertencem a ele; antes, ids desconhecidos eram ignorados em silêncio e a
    partida era marcada como concluída mesmo sem resultado válido.
    """
    draw = Draw.objects.filter(match=match, is_current=True).first()
    if draw is None:
        raise DomainError("Esta partida ainda não foi sorteada.")

    teams = list(draw.teams.all())
    team_ids = {team.id for team in teams}
    informed = {entry["team_id"]: max(0, int(entry["goals_scored"])) for entry in results}

    unknown = set(informed) - team_ids
    if unknown:
        raise DomainError(
            f"Time(s) {sorted(unknown)} não pertence(m) ao sorteio vigente desta partida."
        )

    missing = team_ids - set(informed)
    if missing:
        raise DomainError(
            "Informe o placar de todos os times do sorteio antes de concluir a partida."
        )

    outcomes = derive_team_outcomes(informed)

    with transaction.atomic():
        team_results = []
        for team in teams:
            team_result, _created = TeamResult.objects.update_or_create(
                team_id=team.id, defaults=outcomes[team.id]
            )
            team_results.append(team_result)

        match.status = Match.Status.COMPLETED
        match.save(update_fields=["status"])

    # A partida acabou: os convidados que existiam só para ela saem do banco.
    # Fora da transação de propósito — se a limpeza falhar, o placar (que é o
    # que importa) já está gravado.
    removidos = cleanup_temporary_guests(match=match)
    if removidos:
        logger.info(
            "temporary_guests_cleaned_up",
            match_id=match.id,
            organization_id=match.organization_id,
            players=[player.id for player in removidos],
        )

    return team_results
