from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.players.serializers import PositionSerializer

from .models import Draw, Team, TeamPlayer, TeamResult


class TeamPlayerSerializer(serializers.ModelSerializer):
    player_id = serializers.IntegerField(source="player.id", read_only=True)
    player_name = serializers.CharField(source="player.name", read_only=True)
    player_nickname = serializers.CharField(source="player.nickname", read_only=True)
    player_photo = serializers.ImageField(source="player.photo", read_only=True)
    # Necessário para destacar convidados na tela, no campo em SVG, no PNG
    # exportado e na impressão (pendência da Fase 4 do plano de evolução).
    player_type = serializers.CharField(source="player.player_type", read_only=True)
    position_snapshot = PositionSerializer(read_only=True)

    class Meta:
        model = TeamPlayer
        fields = [
            "id",
            "player_id",
            "player_name",
            "player_nickname",
            "player_photo",
            "player_type",
            "position_snapshot",
            "skill_snapshot",
            "used_secondary_position",
            # Vaga no desenho da formação. Nulos em sorteios sem formação (e nos
            # anteriores a ela) — o campo então agrupa pelo `sort_order` da
            # posição, exatamente como antes.
            "line_index",
            "slot_index",
        ]


class TeamResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeamResult
        fields = ["result", "goals_scored", "goals_conceded"]


class TeamSerializer(serializers.ModelSerializer):
    team_players = TeamPlayerSerializer(many=True, read_only=True)
    total_skill = serializers.SerializerMethodField()
    result = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = [
            "id",
            "name",
            "color",
            "order_index",
            "formation",
            "total_skill",
            "team_players",
            "result",
        ]

    def get_total_skill(self, team) -> int:
        return sum(tp.skill_snapshot for tp in team.team_players.all())

    @extend_schema_field(TeamResultSerializer(allow_null=True))
    def get_result(self, team):
        try:
            return TeamResultSerializer(team.result).data
        except TeamResult.DoesNotExist:
            return None


class SetTeamResultSerializer(serializers.Serializer):
    """Só os gols são informados. Vitória/empate/derrota e `goals_conceded` são
    **derivados no servidor** (`derive_team_outcomes`) — antes vinham prontos do
    cliente, o que permitia gravar um resultado inconsistente com o placar."""

    team_id = serializers.IntegerField()
    goals_scored = serializers.IntegerField(min_value=0)


class SetMatchResultsSerializer(serializers.Serializer):
    results = SetTeamResultSerializer(many=True, allow_empty=False)


class _DrawScopedSerializer(serializers.Serializer):
    """Base das edições pós-sorteio: valida que o alvo pertence a **este**
    sorteio. Sem isso, um id de outra organização passaria pela view — o
    isolamento multi-tenant não pode depender de o cliente mandar o id certo."""

    reason = serializers.CharField(required=False, allow_blank=True, default="")

    def _check_team_player(self, value: int, field: str) -> int:
        draw = self.context["draw"]
        if not TeamPlayer.objects.filter(id=value, team__draw=draw).exists():
            raise serializers.ValidationError({field: "Este jogador não pertence a este sorteio."})
        return value

    def _check_team(self, value: int, field: str) -> int:
        draw = self.context["draw"]
        if not Team.objects.filter(id=value, draw=draw).exists():
            raise serializers.ValidationError({field: "Este time não pertence a este sorteio."})
        return value


class MovePlayerSerializer(_DrawScopedSerializer):
    team_player_id = serializers.IntegerField()
    target_team_id = serializers.IntegerField()

    def validate(self, attrs):
        self._check_team_player(attrs["team_player_id"], "team_player_id")
        self._check_team(attrs["target_team_id"], "target_team_id")
        return attrs


class ChangePlayerPositionSerializer(_DrawScopedSerializer):
    """Alterar a posição de um jogador dentro do time.

    `position_id` e `line_index` são ambos opcionais, mas ao menos um precisa
    vir — o serviço recusa a chamada vazia."""

    team_player_id = serializers.IntegerField()
    position_id = serializers.IntegerField(required=False, allow_null=True)
    line_index = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    slot_index = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    def validate(self, attrs):
        self._check_team_player(attrs["team_player_id"], "team_player_id")
        if attrs.get("position_id") is None and attrs.get("line_index") is None:
            raise serializers.ValidationError(
                "Informe a posição (`position_id`) ou a vaga (`line_index`) de destino."
            )
        return attrs


class SwapPlayersSerializer(_DrawScopedSerializer):
    """Trocar dois jogadores de lugar — uma operação, uma transação."""

    team_player_a = serializers.IntegerField()
    team_player_b = serializers.IntegerField()

    def validate(self, attrs):
        self._check_team_player(attrs["team_player_a"], "team_player_a")
        self._check_team_player(attrs["team_player_b"], "team_player_b")
        if attrs["team_player_a"] == attrs["team_player_b"]:
            raise serializers.ValidationError("Selecione dois jogadores diferentes para trocar.")
        return attrs


class SetTeamFormationSerializer(_DrawScopedSerializer):
    team_id = serializers.IntegerField()
    #: Vazio limpa a formação — o campo volta a agrupar pela posição cadastrada.
    formation = serializers.CharField(allow_blank=True)

    def validate(self, attrs):
        self._check_team(attrs["team_id"], "team_id")
        return attrs


class FormationOptionSerializer(serializers.Serializer):
    """Uma formação oferecida na configuração do sorteio."""

    key = serializers.CharField()
    lines = serializers.ListField(child=serializers.IntegerField())
    line_players = serializers.IntegerField()
    line_count = serializers.IntegerField()
    #: É a sugestão do sistema (a mais equilibrada para este elenco).
    balanced = serializers.BooleanField()


class DrawSerializer(serializers.ModelSerializer):
    teams = TeamSerializer(many=True, read_only=True)
    executed_by_name = serializers.CharField(source="executed_by.username", read_only=True, default=None)
    # Os dois critérios que não têm coluna em `Draw` ficam no payload da
    # auditoria do sorteio. Exibi-los na tela exigia ler a trilha; agora vêm
    # junto do resultado.
    score_weakest_split = serializers.SerializerMethodField()
    score_guest_balance = serializers.SerializerMethodField()

    def _audit_score(self, draw, key: str) -> float | None:
        log = draw.audit_logs.filter(action="draw_created").first()
        if log is None:
            return None
        value = log.after.get(key)
        return float(value) if value is not None else None

    def get_score_weakest_split(self, draw) -> float | None:
        return self._audit_score(draw, "score_weakest_split")

    def get_score_guest_balance(self, draw) -> float | None:
        return self._audit_score(draw, "score_guest_balance")

    class Meta:
        model = Draw
        fields = [
            "id",
            "match",
            "algorithm",
            # Diz à tela se este sorteio saiu do botão ou do agendamento
            # automático — a interface afirma isso em vez de deduzir do
            # `executed_by_name` nulo.
            "trigger",
            "formation",
            "weights",
            "score_balance",
            "score_position",
            "score_repetition",
            "score_weakest_split",
            "score_guest_balance",
            "total_score",
            "iterations_run",
            "is_current",
            "executed_by_name",
            "created_at",
            "teams",
        ]
        read_only_fields = fields
