from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.players.models import Player

from .models import Confirmation, Match, RecurringGame, WaitlistEntry, compute_player_bounds
from .validators import validate_match_config, validate_recurring_game_config


class RecurringGameSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringGame
        fields = [
            "id",
            "name",
            "weekday",
            "match_time",
            "draw_time",
            "teams_count",
            "min_players_per_team_line",
            "max_players_per_team_line",
            "goalkeepers_per_team",
            "min_players",
            "max_players",
            "days_before_to_generate",
            "is_active",
        ]
        read_only_fields = ["min_players", "max_players"]

    def validate(self, attrs):
        # Estes três campos têm default no model, portanto o DRF os marca como
        # `required=False`. Ler de um dicionário (`merged["teams_count"]`) fazia
        # um POST que os omitisse estourar KeyError → HTTP 500. Agora a cascata é
        # explícita: valor enviado → valor da instância → default do model.
        def current(field: str):
            if field in attrs:
                return attrs[field]
            if self.instance is not None:
                return getattr(self.instance, field)
            return RecurringGame._meta.get_field(field).default

        validate_recurring_game_config(
            teams_count=current("teams_count"),
            min_players_per_team_line=current("min_players_per_team_line"),
            max_players_per_team_line=current("max_players_per_team_line"),
            goalkeepers_per_team=current("goalkeepers_per_team"),
        )
        return attrs


class MatchCapacitySerializer(serializers.Serializer):
    """Configuração efetiva da partida, no formato em que o organizador pensa:
    times × (jogadores de linha + goleiros). A interface lê daqui em vez de
    recalcular — o cálculo mora só no backend."""

    teams_count = serializers.IntegerField()
    min_players = serializers.IntegerField()
    max_players = serializers.IntegerField()
    goalkeepers_per_team = serializers.IntegerField()
    line_players_per_team = serializers.IntegerField()
    total_goalkeepers = serializers.IntegerField()
    total_line_players = serializers.IntegerField()


class MatchDivergenceSerializer(serializers.Serializer):
    """Uma diferença entre a partida e a configuração atual do jogo recorrente."""

    field = serializers.CharField()
    label = serializers.CharField()
    match_value = serializers.CharField()
    recurring_game_value = serializers.CharField()


class MatchSerializer(serializers.ModelSerializer):
    confirmed_count = serializers.SerializerMethodField()
    waitlist_count = serializers.SerializerMethodField()
    capacity = serializers.SerializerMethodField()
    recurring_game_divergences = serializers.SerializerMethodField()
    recurring_game_name = serializers.CharField(source="recurring_game.name", read_only=True, default=None)
    # Sorteio automático: a interface **lê** o critério do backend em vez de
    # inferir de `draw_time`/`recurring_game`. É a mesma propriedade que a task
    # periódica consulta, então tela e execução nunca discordam.
    automatic_draw = serializers.BooleanField(read_only=True)
    automatic_draw_source = serializers.CharField(read_only=True, allow_null=True)
    automatic_draw_at = serializers.DateTimeField(read_only=True, allow_null=True)
    effective_draw_time = serializers.TimeField(read_only=True, allow_null=True)
    automatic_draw_blocked_reason = serializers.SerializerMethodField()
    # Entrada opcional no mesmo modelo mental dos jogos recorrentes ("jogadores
    # de linha por time"). Quando informados, o total da partida é calculado
    # pela mesma função usada por RecurringGame.save(); quando ausentes,
    # min_players/max_players são aceitos diretamente (contrato antigo da API).
    min_players_per_team_line = serializers.IntegerField(write_only=True, required=False, min_value=1)
    max_players_per_team_line = serializers.IntegerField(write_only=True, required=False, min_value=1)

    class Meta:
        model = Match
        fields = [
            "id",
            "recurring_game",
            "recurring_game_name",
            "name",
            "location",
            "notes",
            "scheduled_date",
            "scheduled_time",
            "draw_time",
            "automatic_draw",
            "automatic_draw_source",
            "automatic_draw_at",
            "effective_draw_time",
            "automatic_draw_blocked_reason",
            "teams_count",
            "goalkeepers_per_team",
            "min_players",
            "max_players",
            "min_players_per_team_line",
            "max_players_per_team_line",
            "capacity",
            "recurring_game_divergences",
            "status",
            "draw_executed_at",
            "confirmed_count",
            "waitlist_count",
            "created_at",
        ]
        read_only_fields = ["status", "draw_executed_at", "created_at"]
        extra_kwargs = {
            "min_players": {"required": False},
            "max_players": {"required": False},
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Isolamento multi-tenant: sem isso, um organizador poderia vincular a
        # partida a um jogo recorrente de outra organização informando o id.
        request = self.context.get("request")
        organization = getattr(request, "organization", None)
        if organization is not None:
            self.fields["recurring_game"].queryset = RecurringGame.objects.filter(
                organization=organization
            )

    def get_confirmed_count(self, match) -> int:
        # Mesma consulta usada pelo motor de sorteio (jogador ativo e não
        # removido) — antes o contador da tela divergia de quem realmente era
        # sorteado.
        from .services import count_confirmed

        return count_confirmed(match)

    def get_waitlist_count(self, match) -> int:
        return WaitlistEntry.objects.filter(match=match).count()

    def get_automatic_draw_blocked_reason(self, match) -> str | None:
        """Por que o sorteio automático **já vencido** ainda não rodou.

        Sem isto o organizador só via a partida parada: o horário passou, o
        sorteio não saiu e nada na tela dizia o motivo. O caso real é sempre o
        mesmo — o mínimo de confirmados não foi atingido, e a regra proíbe
        sortear abaixo dele. Como o sistema segue tentando a cada novo contato
        com a partida, a mensagem também diz o que falta para destravar.

        `None` quando não há nada a explicar: sorteio desabilitado, horário
        ainda por vir, ou partida já sorteada."""
        if not match.is_automatic_draw_due:
            return None

        from .services import count_confirmed

        confirmed = count_confirmed(match)
        if confirmed < match.min_players:
            missing = match.min_players - confirmed
            return (
                f"O horário do sorteio automático já passou, mas faltam {missing} "
                f"confirmado(s) para o mínimo de {match.min_players}. "
                "Assim que o mínimo for atingido, o sorteio acontece sozinho."
            )
        return None

    @staticmethod
    def _capacity_payload(match) -> dict:
        capacity = match.capacity
        return {
            "teams_count": capacity.teams_count,
            "min_players": capacity.min_players,
            "max_players": capacity.max_players,
            "goalkeepers_per_team": capacity.goalkeepers_per_team,
            "line_players_per_team": capacity.line_players_per_team,
            "total_goalkeepers": capacity.total_goalkeepers,
            "total_line_players": capacity.total_line_players,
        }

    def get_capacity(self, match) -> dict:
        return self._capacity_payload(match)

    @extend_schema_field(MatchDivergenceSerializer(many=True))
    def get_recurring_game_divergences(self, match) -> list[dict]:
        return match.recurring_game_divergences

    def validate(self, attrs):
        min_line = attrs.pop("min_players_per_team_line", None)
        max_line = attrs.pop("max_players_per_team_line", None)

        def current(field):
            return attrs.get(field, getattr(self.instance, field, None))

        teams_count = current("teams_count")
        # Sem valor informado nem instância (partida nova), cai no default do
        # model — a mesma cascata usada pelo serializer de jogo recorrente.
        goalkeepers_per_team = attrs.get(
            "goalkeepers_per_team",
            getattr(
                self.instance,
                "goalkeepers_per_team",
                Match._meta.get_field("goalkeepers_per_team").default,
            ),
        )

        if min_line is not None or max_line is not None:
            if min_line is None or max_line is None:
                raise serializers.ValidationError(
                    {
                        "min_players_per_team_line": (
                            "Informe o mínimo e o máximo de jogadores de linha por time juntos."
                        )
                    }
                )
            validate_recurring_game_config(
                teams_count=teams_count,
                min_players_per_team_line=min_line,
                max_players_per_team_line=max_line,
                goalkeepers_per_team=goalkeepers_per_team,
            )
            attrs["min_players"], attrs["max_players"] = compute_player_bounds(
                teams_count=teams_count,
                min_players_per_team_line=min_line,
                max_players_per_team_line=max_line,
                goalkeepers_per_team=goalkeepers_per_team,
            )

        min_players = current("min_players")
        max_players = current("max_players")
        if min_players is None or max_players is None:
            raise serializers.ValidationError(
                {
                    "min_players": (
                        "Informe o total de jogadores (min_players/max_players) ou a faixa por time "
                        "(min_players_per_team_line/max_players_per_team_line)."
                    )
                }
            )

        validate_match_config(
            teams_count=teams_count,
            min_players=min_players,
            max_players=max_players,
        )
        return attrs


class DashboardPlayerCountsSerializer(serializers.Serializer):
    ativos = serializers.IntegerField()
    mensalistas = serializers.IntegerField()
    convidados = serializers.IntegerField()


class DashboardPendingItemSerializer(serializers.Serializer):
    """Uma pendência do dashboard — algo que espera ação do organizador.

    `kind` existe para a interface escolher o ícone e o destino do toque sem
    interpretar o texto da mensagem."""

    kind = serializers.ChoiceField(
        choices=["draw_blocked", "waitlist", "below_minimum", "divergence"]
    )
    message = serializers.CharField()
    match = serializers.IntegerField(allow_null=True)
    severity = serializers.ChoiceField(choices=["info", "warning"])


class DashboardFinanceSerializer(serializers.Serializer):
    """Resumo financeiro da competência corrente.

    Só vem para quem tem `financial.view` — o Visualizador e o Jogador não
    enxergam o dinheiro da organização (regra §14.8)."""

    reference = serializers.CharField()
    total_received = serializers.CharField()
    total_outstanding = serializers.CharField()
    balance = serializers.CharField()


class DashboardSummarySerializer(serializers.Serializer):
    next_match = MatchSerializer(allow_null=True)
    #: A próxima partida é **hoje** — muda o que a tela destaca.
    is_today = serializers.BooleanField()
    players = DashboardPlayerCountsSerializer()
    pending = DashboardPendingItemSerializer(many=True)
    finance = DashboardFinanceSerializer(allow_null=True)


class ConfirmationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Confirmation
        fields = ["id", "match", "player", "status", "confirmed_at", "source"]
        read_only_fields = ["confirmed_at"]


class WaitlistEntrySerializer(serializers.ModelSerializer):
    player_id = serializers.IntegerField(source="player.id", read_only=True)
    player_name = serializers.CharField(source="player.name", read_only=True)
    player_nickname = serializers.CharField(source="player.nickname", read_only=True)
    player_type = serializers.CharField(source="player.player_type", read_only=True)
    player_photo = serializers.ImageField(source="player.photo", read_only=True)

    class Meta:
        model = WaitlistEntry
        fields = [
            "id",
            "position",
            "player_id",
            "player_name",
            "player_nickname",
            "player_type",
            "player_photo",
            "joined_at",
        ]
        read_only_fields = fields


class _OrganizationScopedPlayerSerializer(serializers.Serializer):
    """Base dos serializers que recebem um jogador: o queryset é sempre
    restrito à organização da requisição (isolamento multi-tenant)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        organization = getattr(request, "organization", None)
        for field in self.fields.values():
            if isinstance(field, serializers.PrimaryKeyRelatedField):
                field.queryset = Player.objects.filter(organization=organization)


class SetConfirmationSerializer(_OrganizationScopedPlayerSerializer):
    player = serializers.PrimaryKeyRelatedField(queryset=Player.objects.none())
    status = serializers.ChoiceField(choices=Confirmation.Status.choices)


class SetAllConfirmationsSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Confirmation.Status.choices)


class QuickConfirmNamesSerializer(serializers.Serializer):
    names = serializers.ListField(
        child=serializers.CharField(allow_blank=True, trim_whitespace=True), allow_empty=False
    )
    # Uma lista colada do grupo, ou um nome digitado de propósito? Muda quanta
    # semelhança com quem já está confirmado conta como repetição — o padrão
    # `True` mantém o contrato de quem já chamava esta rota.
    pasted_list = serializers.BooleanField(default=True)


class ReassignConfirmationSerializer(_OrganizationScopedPlayerSerializer):
    wrong_player = serializers.PrimaryKeyRelatedField(queryset=Player.objects.none())
    correct_player = serializers.PrimaryKeyRelatedField(queryset=Player.objects.none())


class WaitlistPlayerSerializer(_OrganizationScopedPlayerSerializer):
    player = serializers.PrimaryKeyRelatedField(queryset=Player.objects.none())


class WaitlistMoveSerializer(_OrganizationScopedPlayerSerializer):
    player = serializers.PrimaryKeyRelatedField(queryset=Player.objects.none())
    position = serializers.IntegerField(min_value=1)


class SelfConfirmationSerializer(serializers.Serializer):
    """Auto-serviço: o jogador só diz **se vai ou não**.

    Não existe campo `player` de propósito — quem confirma é sempre o dono do
    token. `pending` fica de fora: a rota é para uma decisão, e "pendente" é a
    ausência dela."""

    status = serializers.ChoiceField(
        choices=[Confirmation.Status.CONFIRMED, Confirmation.Status.DECLINED]
    )


class ConfirmedPlayerSerializer(serializers.Serializer):
    """Um confirmado, do ponto de vista de **quem só joga**.

    Enxuto de propósito. O `roster` do organizador devolve `PlayerSerializer`
    inteiro — telefone, nível técnico, observações — e liberá-lo para o jogador
    seria expor o cadastro da pelada para conseguir mostrar uma lista de nomes.
    Aqui vai o que a pergunta "quem vai jogar?" precisa, e nada mais.
    """

    id = serializers.IntegerField()
    name = serializers.CharField()
    nickname = serializers.CharField()
    confirmed_at = serializers.DateTimeField(allow_null=True)
