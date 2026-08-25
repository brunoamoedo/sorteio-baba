from dataclasses import dataclass
from datetime import datetime

from django.db import models
from django.utils import timezone

from common.models import BaseModel, OrganizationOwnedModel


class Weekday(models.IntegerChoices):
    MONDAY = 0, "Segunda-feira"
    TUESDAY = 1, "Terça-feira"
    WEDNESDAY = 2, "Quarta-feira"
    THURSDAY = 3, "Quinta-feira"
    FRIDAY = 4, "Sexta-feira"
    SATURDAY = 5, "Sábado"
    SUNDAY = 6, "Domingo"


# Quantos goleiros cada time reserva quando a pelada não diz o contrário.
#
# **Padrão 0**: na prática o goleiro da pelada é fixo — não é sorteado e
# frequentemente nem está cadastrado como jogador. Reservar uma vaga para ele
# inflava a partida inteira: "6 de linha por time" com 3 times pedia 21
# confirmados em vez de 18, o sorteio devolvia 7 de linha por time e o sorteio
# automático ficava travado esperando gente que não existe.
#
# Continua configurável: quem tem goleiro cadastrado e quer a vaga reservada
# põe 1 (ou mais) no jogo recorrente / na partida.
DEFAULT_GOALKEEPERS_PER_TEAM = 0

DEFAULT_DAYS_BEFORE_TO_GENERATE = 7


def compute_player_bounds(
    *,
    teams_count: int,
    min_players_per_team_line: int,
    max_players_per_team_line: int,
    goalkeepers_per_team: int = DEFAULT_GOALKEEPERS_PER_TEAM,
) -> tuple[int, int]:
    """Converte a configuração "por time" (jogadores de linha) no total de
    jogadores da partida, somando os goleiros de cada time.

    Fonte única desse cálculo: usada tanto por `RecurringGame.save()` quanto
    pelo serializer de `Match` na criação de partidas avulsas — a regra nunca
    é escrita duas vezes."""
    return (
        teams_count * (min_players_per_team_line + goalkeepers_per_team),
        teams_count * (max_players_per_team_line + goalkeepers_per_team),
    )


@dataclass(frozen=True)
class MatchCapacity:
    """Leitura da configuração da partida no formato que o organizador raciocina.

    É o **inverso** de `compute_player_bounds`: parte dos totais gravados no
    banco e devolve times / linha por time / goleiros por time. O sorteio e a
    fila de espera consultam exclusivamente esta estrutura — nenhuma camada
    recalcula capacidade por conta própria."""

    teams_count: int
    min_players: int
    max_players: int
    goalkeepers_per_team: int
    line_players_per_team: int

    @property
    def total_goalkeepers(self) -> int:
        return self.teams_count * self.goalkeepers_per_team

    @property
    def total_line_players(self) -> int:
        return self.teams_count * self.line_players_per_team


def compute_match_capacity(
    *,
    teams_count: int,
    min_players: int,
    max_players: int,
    goalkeepers_per_team: int = DEFAULT_GOALKEEPERS_PER_TEAM,
) -> MatchCapacity:
    """Deriva a capacidade efetiva de uma partida a partir da sua configuração.

    `line_players_per_team` usa divisão inteira porque partidas antigas podem
    ter um `max_players` que não é múltiplo do número de times; nesse caso o
    teto continua sendo `max_players` (o valor configurado manda), e a faixa
    por time é apenas informativa para a interface."""
    teams_count = max(1, teams_count)
    players_per_team = max_players // teams_count
    line_players_per_team = max(0, players_per_team - goalkeepers_per_team)
    return MatchCapacity(
        teams_count=teams_count,
        min_players=min_players,
        max_players=max_players,
        goalkeepers_per_team=goalkeepers_per_team,
        line_players_per_team=line_players_per_team,
    )


class AutomaticDrawSource(models.TextChoices):
    """De onde veio o agendamento que habilita o sorteio automático da partida.

    `None` (nenhuma das duas) é o caso da **partida avulsa sem horário de
    sorteio**: ela nunca é sorteada automaticamente."""

    MATCH = "match", "Horário próprio da partida"
    RECURRING_GAME = "recurring_game", "Jogo recorrente"


class RecurringGame(OrganizationOwnedModel):
    name = models.CharField(max_length=150)
    weekday = models.IntegerField(choices=Weekday.choices)
    match_time = models.TimeField()
    draw_time = models.TimeField()
    teams_count = models.PositiveSmallIntegerField(default=2)
    min_players_per_team_line = models.PositiveSmallIntegerField(
        default=4, help_text="Jogadores de linha (sem contar o goleiro) por time, no mínimo."
    )
    max_players_per_team_line = models.PositiveSmallIntegerField(
        default=8, help_text="Jogadores de linha (sem contar o goleiro) por time, no máximo."
    )
    goalkeepers_per_team = models.PositiveSmallIntegerField(
        default=DEFAULT_GOALKEEPERS_PER_TEAM,
        help_text=(
            "Quantos goleiros cada time reserva. Use 0 quando o goleiro é fixo e não "
            "participa do sorteio — aí a partida conta só jogadores de linha."
        ),
    )
    min_players = models.PositiveIntegerField(
        editable=False,
        default=0,
        help_text="Calculado: teams_count * (min_players_per_team_line + goalkeepers_per_team).",
    )
    max_players = models.PositiveIntegerField(
        editable=False,
        default=0,
        help_text="Calculado: teams_count * (max_players_per_team_line + goalkeepers_per_team).",
    )
    days_before_to_generate = models.PositiveSmallIntegerField(
        default=DEFAULT_DAYS_BEFORE_TO_GENERATE,
        help_text=(
            "Com quantos dias de antecedência a próxima partida é criada automaticamente. "
            "O padrão (7) reproduz o comportamento histórico: como a recorrência é semanal, "
            "a partida seguinte era criada assim que a anterior passava."
        ),
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["weekday", "match_time"]

    def save(self, *args, **kwargs):
        self.min_players, self.max_players = compute_player_bounds(
            teams_count=self.teams_count,
            min_players_per_team_line=self.min_players_per_team_line,
            max_players_per_team_line=self.max_players_per_team_line,
            goalkeepers_per_team=self.goalkeepers_per_team,
        )
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Match(OrganizationOwnedModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Agendada"
        CONFIRMING = "confirming", "Confirmando presença"
        DRAWN = "drawn", "Sorteada"
        IN_PROGRESS = "in_progress", "Em andamento"
        COMPLETED = "completed", "Concluída"
        CANCELED = "canceled", "Cancelada"

    recurring_game = models.ForeignKey(
        RecurringGame, on_delete=models.SET_NULL, null=True, blank=True, related_name="matches"
    )
    name = models.CharField(
        max_length=150, blank=True, help_text="Identificação da partida (usado sobretudo em partidas avulsas)."
    )
    location = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    scheduled_date = models.DateField()
    scheduled_time = models.TimeField()
    draw_time = models.TimeField(
        null=True,
        blank=True,
        help_text=(
            "Horário do sorteio automático desta partida. Quando vazio, herda o horário do "
            "jogo recorrente; sem nenhum dos dois, a partida nunca é sorteada automaticamente."
        ),
    )
    teams_count = models.PositiveSmallIntegerField()
    goalkeepers_per_team = models.PositiveSmallIntegerField(
        default=DEFAULT_GOALKEEPERS_PER_TEAM,
        help_text=(
            "Quantos goleiros cada time reserva nesta partida. Copiado do jogo recorrente "
            "quando a partida é gerada por ele. Use 0 quando o goleiro é fixo e não é sorteado."
        ),
    )
    min_players = models.PositiveIntegerField()
    max_players = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    draw_executed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-scheduled_date", "-scheduled_time"]
        constraints = [
            models.UniqueConstraint(
                fields=["recurring_game", "scheduled_date"],
                condition=models.Q(is_deleted=False),
                name="unique_recurring_game_date",
            ),
        ]

    # -- Sorteio automático -------------------------------------------------
    #
    # Critério único do sistema: o sorteio automático só existe quando a partida
    # tem uma **configuração de agendamento válida** — um horário de sorteio
    # próprio ou herdado do jogo recorrente que a gerou. Partida avulsa criada
    # sem horário de sorteio não gera agendamento, não é processada pela task e
    # só é sorteada pelo botão manual. Nenhuma camada (task, API, interface)
    # decide isso por conta própria: todas leem `automatic_draw` daqui.

    @property
    def automatic_draw_source(self) -> str | None:
        """Origem do agendamento do sorteio automático, ou `None` quando não há.

        O horário próprio da partida tem precedência sobre o do jogo recorrente
        — inclusive quando a partida veio de um jogo recorrente."""
        if self.draw_time is not None:
            return AutomaticDrawSource.MATCH
        if self.recurring_game is not None and self.recurring_game.draw_time is not None:
            return AutomaticDrawSource.RECURRING_GAME
        return None

    @property
    def effective_draw_time(self):
        """Horário do sorteio automático que vale para esta partida: o próprio
        da partida tem precedência; sem ele, herda o do jogo recorrente."""
        source = self.automatic_draw_source
        if source == AutomaticDrawSource.MATCH:
            return self.draw_time
        if source == AutomaticDrawSource.RECURRING_GAME:
            return self.recurring_game.draw_time
        return None

    @property
    def automatic_draw(self) -> bool:
        """A partida tem sorteio automático habilitado?

        É a validação clara pedida pela regra: partida recorrente (ou avulsa que
        o organizador agendou de propósito) → `True`; partida avulsa sem horário
        de sorteio → `False`."""
        return self.automatic_draw_source is not None

    @property
    def automatic_draw_at(self) -> datetime | None:
        """Momento exato (data da partida + horário efetivo) em que o sorteio
        automático deve rodar. `None` quando não há sorteio automático."""
        effective_draw_time = self.effective_draw_time
        if effective_draw_time is None:
            return None
        return timezone.make_aware(
            datetime.combine(self.scheduled_date, effective_draw_time),
            timezone.get_current_timezone(),
        )

    @property
    def has_draw(self) -> bool:
        """Esta partida já foi sorteada?

        Trava contra duplicidade: `draw_executed_at` sozinho não basta porque
        uma partida antiga pode ter sorteio sem o carimbo, e o status sozinho
        também não — reabrir uma ocorrência cancelada devolve o status para
        `Agendada` mesmo com sorteio salvo. As duas evidências são consultadas."""
        return self.draw_executed_at is not None or self.draws.filter(is_current=True).exists()

    @property
    def is_automatic_draw_pending(self) -> bool:
        """Sorteio automático habilitado, ainda não executado e a partida ainda
        aceita ser sorteada (não está cancelada nem concluída)."""
        return (
            self.automatic_draw
            and not self.has_draw
            and self.status in (self.Status.SCHEDULED, self.Status.CONFIRMING)
        )

    @property
    def is_automatic_draw_due(self) -> bool:
        """Sorteio automático pendente cujo momento **já chegou**.

        É o critério dos gatilhos de recuperação (salvar a partida, abrir a
        tela dela): o que decide é a configuração **atual** — uma partida
        avulsa que ganhou horário de sorteio numa edição fica vencida do mesmo
        jeito que uma recorrente; a origem não entra na conta.

        Diferente da janela da task periódica (que tem teto de tolerância,
        `DRAW_AUTO_DRAW_GRACE_MINUTES`), aqui não há limite superior: se o
        organizador configurou 19h e são 22h, o sorteio está vencido — inclusive
        quando a configuração foi feita às 22h, depois do horário. Vale apenas
        **no dia da partida**: depois que o dia passa, sortear sozinho deixaria
        de ser automação e viraria surpresa."""
        if not self.is_automatic_draw_pending:
            return False
        now = timezone.localtime()
        if self.scheduled_date != now.date():
            return False
        return self.automatic_draw_at <= now

    @property
    def capacity(self) -> MatchCapacity:
        """Configuração efetiva desta partida (times, linha, goleiros, teto)."""
        return compute_match_capacity(
            teams_count=self.teams_count,
            min_players=self.min_players,
            max_players=self.max_players,
            goalkeepers_per_team=self.goalkeepers_per_team,
        )

    @property
    def recurring_game_divergences(self) -> list[dict]:
        """Diferenças entre esta partida e a configuração **atual** do jogo
        recorrente que a gerou.

        Alterar um jogo recorrente (dia da semana, horário, número de times…)
        de propósito **não** mexe na partida já gerada: ela pode ter
        confirmações e até sorteio, e reescrevê-la seria destrutivo e
        silencioso. Em vez disso, a divergência é exposta aqui para a interface
        avisar o organizador, que decide se edita a partida ou deixa como está.

        Só vale para partidas que ainda vão acontecer: uma partida passada
        naturalmente diverge de uma configuração alterada depois, e alertar
        sobre isso seria só ruído."""
        game = self.recurring_game
        if game is None:
            return []
        if self.status in (self.Status.COMPLETED, self.Status.CANCELED):
            return []
        if self.scheduled_date < timezone.localdate():
            return []

        checks = (
            (
                "weekday",
                "Dia da semana",
                Weekday(self.scheduled_date.weekday()).label,
                Weekday(game.weekday).label,
            ),
            (
                "scheduled_time",
                "Horário do jogo",
                self.scheduled_time.strftime("%H:%M"),
                game.match_time.strftime("%H:%M"),
            ),
            ("teams_count", "Quantidade de times", str(self.teams_count), str(game.teams_count)),
            (
                "goalkeepers_per_team",
                "Goleiros por time",
                str(self.goalkeepers_per_team),
                str(game.goalkeepers_per_team),
            ),
            ("min_players", "Mínimo de jogadores", str(self.min_players), str(game.min_players)),
            ("max_players", "Máximo de jogadores", str(self.max_players), str(game.max_players)),
        )

        return [
            {
                "field": field,
                "label": label,
                "match_value": match_value,
                "recurring_game_value": game_value,
            }
            for field, label, match_value, game_value in checks
            if match_value != game_value
        ]

    def __str__(self):
        label = self.name or (str(self.recurring_game) if self.recurring_game else "Avulsa")
        return f"{label} — {self.scheduled_date}"


class Confirmation(BaseModel):
    class Status(models.TextChoices):
        CONFIRMED = "confirmed", "Confirmado"
        DECLINED = "declined", "Recusado"
        PENDING = "pending", "Pendente"

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        WHATSAPP = "whatsapp", "WhatsApp"

    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name="confirmations")
    player = models.ForeignKey("players.Player", on_delete=models.CASCADE, related_name="confirmations")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)

    class Meta:
        constraints = [
            # `condition` é obrigatório aqui pelo mesmo motivo de `Match`: sem ele,
            # uma confirmação soft-deletada e recriada para o mesmo par colide no
            # banco (o manager padrão esconde a linha antiga, o INSERT estoura).
            models.UniqueConstraint(
                fields=["match", "player"],
                condition=models.Q(is_deleted=False),
                name="unique_confirmation_per_match_player",
            ),
        ]

    def __str__(self):
        return f"{self.player} @ {self.match} ({self.status})"


class WaitlistEntry(OrganizationOwnedModel):
    """Fila de espera de uma partida que atingiu a capacidade configurada.

    Ordem (`position`, 1-based) é a fonte da verdade e pode ser reordenada
    manualmente pelo organizador. Na entrada automática a posição é calculada
    por `joined_at` (ordem de inscrição) com **prioridade para mensalistas**:
    um mensalista que confirma depois entra à frente dos convidados que já
    estavam esperando."""

    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name="waitlist_entries")
    player = models.ForeignKey("players.Player", on_delete=models.CASCADE, related_name="waitlist_entries")
    position = models.PositiveIntegerField(default=1)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "joined_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["match", "player"],
                condition=models.Q(is_deleted=False),
                name="unique_waitlist_per_match_player",
            ),
        ]
        indexes = [models.Index(fields=["match", "position"])]

    def __str__(self):
        return f"#{self.position} {self.player} @ {self.match}"
