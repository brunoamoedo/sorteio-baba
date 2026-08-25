# O motor de sorteio (domain/) é framework-agnostic e não depende destes models.
from django.db import models

from common.models import BaseModel, OrganizationOwnedModel


class Draw(OrganizationOwnedModel):
    class Trigger(models.TextChoices):
        """Quem disparou o sorteio. `executed_by` já dizia isso por omissão (nulo
        = ninguém clicou), mas por omissão não é contrato: a tela precisa afirmar
        "este sorteio foi automático" e a auditoria precisa registrar isso."""

        MANUAL = "manual", "Manual"
        AUTOMATIC = "automatic", "Automático"

    match = models.ForeignKey("matches.Match", on_delete=models.CASCADE, related_name="draws")
    algorithm = models.CharField(max_length=50, default="simulated_annealing")
    trigger = models.CharField(max_length=20, choices=Trigger.choices, default=Trigger.MANUAL)
    formation = models.CharField(
        max_length=20,
        blank=True,
        help_text=(
            "Formação padrão escolhida para este sorteio, no formato '2-2-2' (só jogadores de "
            "linha; o goleiro não entra na notação). Vazio = sorteio sem formação, em que o campo "
            "desenha as linhas pela posição cadastrada de cada jogador."
        ),
    )
    weights = models.JSONField(default=dict, blank=True)
    score_balance = models.FloatField()
    score_position = models.FloatField()
    score_repetition = models.FloatField()
    total_score = models.FloatField()
    iterations_run = models.PositiveIntegerField()
    is_current = models.BooleanField(default=True)
    executed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="draws_executed"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Sorteio #{self.pk} — {self.match}"


class Team(BaseModel):
    draw = models.ForeignKey(Draw, on_delete=models.CASCADE, related_name="teams")
    name = models.CharField(max_length=50)
    color = models.CharField(max_length=20, blank=True)
    order_index = models.PositiveSmallIntegerField(default=0)
    formation = models.CharField(
        max_length=20,
        blank=True,
        help_text=(
            "Formação **deste** time. Começa igual à do sorteio, mas cada time pode ter a sua — "
            "o organizador escolhe por time."
        ),
    )

    class Meta:
        ordering = ["order_index"]

    def __str__(self):
        return f"{self.name} ({self.draw})"


class TeamPlayer(BaseModel):
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="team_players")
    player = models.ForeignKey("players.Player", on_delete=models.CASCADE, related_name="team_players")
    position_snapshot = models.ForeignKey("players.Position", on_delete=models.PROTECT)
    skill_snapshot = models.PositiveSmallIntegerField()
    used_secondary_position = models.BooleanField(default=False)
    # -- Vaga no desenho da formação ---------------------------------------
    #
    # Guardados **separados** da posição de propósito: uma formação pode ter
    # mais linhas do que a organização tem posições cadastradas (4 linhas para
    # ZAG/ME/AT), e nesse caso duas linhas compartilham a mesma posição. É o
    # `line_index` que faz o campo desenhar as quatro faixas.
    #
    # `null` = sorteio anterior à formação (ou sorteio sem formação): o campo
    # cai no comportamento antigo e agrupa pelo `sort_order` da posição.
    line_index = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Linha da formação (0 = mais defensiva)."
    )
    slot_index = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Posição dentro da linha, da esquerda para a direita."
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["team", "player"], name="unique_team_player"),
        ]
        indexes = [
            # O campo lê os jogadores de um time já na ordem do desenho.
            models.Index(fields=["team", "line_index", "slot_index"], name="teamplayer_slot_idx"),
        ]

    def __str__(self):
        return f"{self.player} @ {self.team}"


class TeamResult(BaseModel):
    class Result(models.TextChoices):
        WIN = "win", "Vitória"
        LOSS = "loss", "Derrota"
        DRAW = "draw", "Empate"

    team = models.OneToOneField(Team, on_delete=models.CASCADE, related_name="result")
    goals_scored = models.PositiveIntegerField(null=True, blank=True)
    goals_conceded = models.PositiveIntegerField(null=True, blank=True)
    result = models.CharField(max_length=10, choices=Result.choices)

    def __str__(self):
        return f"{self.team} — {self.get_result_display()}"
