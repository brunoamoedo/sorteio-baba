from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from common.mixins import OrganizationScopedViewSetMixin
from common.permissions import IsOrganizationMember, IsOrganizationOrganizerOrAdmin

from .models import Draw
from .serializers import (
    ChangePlayerPositionSerializer,
    DrawSerializer,
    FormationOptionSerializer,
    MovePlayerSerializer,
    SetTeamFormationSerializer,
    SwapPlayersSerializer,
    TeamPlayerSerializer,
    TeamSerializer,
)
from .services import (
    change_player_position,
    move_player_to_team,
    set_team_formation,
    suggest_formations,
    swap_players,
)

#: Ações que **editam** o resultado do sorteio. Todas exigem, no mínimo,
#: Organizador — o Visualizador enxerga o sorteio mas não o altera.
WRITE_ACTIONS = {"move_player", "set_position", "swap_players", "set_formation"}


class DrawViewSet(OrganizationScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = DrawSerializer
    queryset = Draw.objects.prefetch_related(
        "teams__team_players__position_snapshot", "teams__team_players__player", "teams__result"
    ).all()
    filterset_fields = ["match", "is_current"]

    def get_permissions(self):
        if self.action in WRITE_ACTIONS:
            return [IsOrganizationOrganizerOrAdmin()]
        if self.action == "formations":
            # Catálogo de formações: não toca em dado de organização nenhuma —
            # é uma função pura de "quantos jogadores de linha por time".
            return [IsAuthenticated()]
        return [IsOrganizationMember()]

    def _serialized(self, serializer_class, data):
        serializer = serializer_class(data=data, context={"draw": self.get_object()})
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    @extend_schema(responses=FormationOptionSerializer(many=True))
    @action(detail=False, methods=["get"])
    def formations(self, request):
        """Formações válidas para N jogadores de linha por time.

        A interface monta a lista com o espelho TypeScript deste mesmo cálculo
        (para não ir à rede a cada mudança de configuração), mas o servidor
        continua sendo a autoridade — é ele que valida no sorteio."""
        try:
            line_players = int(request.query_params.get("line_players", 0))
        except (TypeError, ValueError):
            line_players = 0

        return Response(FormationOptionSerializer(suggest_formations(line_players=line_players), many=True).data)

    @extend_schema(request=MovePlayerSerializer, responses=TeamPlayerSerializer)
    @action(detail=True, methods=["post"], url_path="move-player")
    def move_player(self, request, pk=None):
        draw = self.get_object()
        data = self._serialized(MovePlayerSerializer, request.data)

        team_player = move_player_to_team(
            draw=draw,
            team_player_id=data["team_player_id"],
            target_team_id=data["target_team_id"],
            reason=data.get("reason", ""),
        )
        return Response(TeamPlayerSerializer(team_player).data)

    @extend_schema(request=ChangePlayerPositionSerializer, responses=TeamPlayerSerializer)
    @action(detail=True, methods=["post"], url_path="set-position")
    def set_position(self, request, pk=None):
        """Altera a posição de um jogador dentro do time — operação que não
        existia: só era possível trocar de time."""
        draw = self.get_object()
        data = self._serialized(ChangePlayerPositionSerializer, request.data)

        team_player = change_player_position(
            draw=draw,
            team_player_id=data["team_player_id"],
            position_id=data.get("position_id"),
            line_index=data.get("line_index"),
            slot_index=data.get("slot_index"),
            reason=data.get("reason", ""),
        )
        return Response(TeamPlayerSerializer(team_player).data)

    @extend_schema(request=SwapPlayersSerializer, responses=TeamPlayerSerializer(many=True))
    @action(detail=True, methods=["post"], url_path="swap-players")
    def swap_players(self, request, pk=None):
        """Troca dois jogadores de lugar em **uma** transação.

        Fazer isso como duas chamadas de "mover" deixaria os times
        inconsistentes se a segunda falhasse — e a auditoria registraria meia
        troca."""
        draw = self.get_object()
        data = self._serialized(SwapPlayersSerializer, request.data)

        a, b = swap_players(
            draw=draw,
            team_player_a_id=data["team_player_a"],
            team_player_b_id=data["team_player_b"],
            reason=data.get("reason", ""),
        )
        return Response(TeamPlayerSerializer([a, b], many=True).data)

    @extend_schema(request=SetTeamFormationSerializer, responses=TeamSerializer)
    @action(detail=True, methods=["post"], url_path="set-formation")
    def set_formation(self, request, pk=None):
        """Troca a formação de um time depois do sorteio, reencaixando quem já
        está nele. Não sorteia de novo e não move ninguém entre times."""
        draw = self.get_object()
        data = self._serialized(SetTeamFormationSerializer, request.data)

        team = set_team_formation(
            draw=draw,
            team_id=data["team_id"],
            formation=data["formation"],
            reason=data.get("reason", ""),
        )
        team.refresh_from_db()
        return Response(TeamSerializer(team).data)
