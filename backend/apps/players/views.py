from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.login_provisioning import generate_logins, login_status, reset_password
from common.mixins import OrganizationScopedViewSetMixin, ReadForMembersWriteForStaffMixin
from common.permissions import IsOrganizationOrganizerOrAdmin

from .models import Player, Position
from .serializers import (
    BulkPlayerActionSerializer,
    LinkableUserSerializer,
    PlayerSerializer,
    PositionSerializer,
)


class PositionViewSet(ReadForMembersWriteForStaffMixin, OrganizationScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = PositionSerializer
    queryset = Position.objects.all()
    filterset_fields = ["is_active"]
    search_fields = ["name", "code"]
    ordering_fields = ["sort_order", "name"]


class PlayerViewSet(ReadForMembersWriteForStaffMixin, OrganizationScopedViewSetMixin, viewsets.ModelViewSet):
    """Cadastro de jogadores.

    Convidados **temporários** (criados por uma lista de nomes colada, só para
    aquela partida) ficam de fora: eles não são cadastro, existem apenas para
    poder entrar no sorteio e somem quando a partida termina. Eles continuam
    aparecendo no roster da partida deles e no resultado do sorteio."""

    serializer_class = PlayerSerializer
    queryset = (
        Player.objects.filter(is_temporary=False)
        .select_related("primary_position", "secondary_position")
        .all()
    )
    filterset_fields = ["status", "player_type", "primary_position"]
    search_fields = ["name", "nickname"]
    ordering_fields = ["name", "skill_level", "created_at"]

    # -- Geração de acesso ----------------------------------------------------
    #
    # Vive no `PlayerViewSet` porque o alvo é a **ficha**, não o usuário: é o
    # jogador desta organização que ganha acesso. As três exigem Gerente/Admin
    # (a permissão da classe) e operam sempre dentro de `request.organization`.

    @action(detail=False, methods=["get"], url_path="login-status")
    def login_status_action(self, request):
        """Quem já tem acesso, quem pode receber e quem está impedido.

        Devolve só nome, telefone e situação — nível técnico e observações
        ficam de fora: esta é uma tela de acesso, não o cadastro."""
        return Response(login_status(request.organization))

    @action(detail=False, methods=["post"], url_path="generate-logins")
    def generate_logins_action(self, request):
        """Gera acesso para os selecionados, ou para **todos** os mensalistas.

        Cada jogador é tratado por si: quem já tem login, quem não tem telefone
        e quem compartilha número com outra ficha são pulados com motivo."""
        ids = request.data.get("player_ids")
        players = (
            list(Player.objects.filter(organization=request.organization, id__in=ids))
            if ids
            else None
        )
        return Response(
            generate_logins(
                organization=request.organization,
                players=players,
                performed_by=request.user,
            )
        )

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password_action(self, request, pk=None):
        """Devolve o acesso com uma senha temporária.

        Quem reseta **não vê** a senha atual — ela é substituída, não
        revelada. `get_object()` já filtra por organização, então um Gerente
        não alcança ficha de outra pelada."""
        return Response(
            reset_password(
                organization=request.organization,
                player=self.get_object(),
                performed_by=request.user,
            )
        )

    @action(detail=False, methods=["get"], url_path="linkable-users")
    def linkable_users(self, request):
        """Membros desta organização, para vincular a uma ficha de jogador.

        Traz junto a ficha já vinculada (quando houver), para a tela mostrar
        quem está livre sem precisar de uma segunda consulta."""
        from apps.accounts.models import Membership

        fichas = {
            player.user_id: player.name
            for player in Player.objects.filter(
                organization=request.organization, user__isnull=False
            )
        }
        memberships = (
            Membership.objects.filter(organization=request.organization, is_active=True)
            .select_related("user")
            .order_by("user__username")
        )
        payload = []
        for membership in memberships:
            user = membership.user
            user.role = membership.role
            user.linked_player_name = fichas.get(user.id)
            payload.append(user)
        return Response(LinkableUserSerializer(payload, many=True).data)

    @action(detail=False, methods=["post"], url_path="bulk", permission_classes=[IsOrganizationOrganizerOrAdmin])
    def bulk(self, request):
        """Aplica uma ação a vários jogadores de uma vez.

        Os ids passam pelo `get_queryset()` da própria view, então o isolamento
        multi-tenant e a exclusão dos temporários valem aqui também: mandar o id
        de um jogador de outra organização simplesmente não encontra nada."""
        serializer = BulkPlayerActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        action_name = serializer.validated_data["action"]

        players = self.get_queryset().filter(id__in=serializer.validated_data["ids"])
        # Materializa antes de alterar: depois de um `update` os filtros de
        # status já não casariam com as mesmas linhas.
        affected = list(players.values_list("id", flat=True))

        if action_name == "delete":
            for player in players:
                player.delete()  # soft-delete: preserva o histórico de sorteios
        else:
            players.update(status=action_name)

        return Response({"action": action_name, "updated": len(affected), "ids": affected})
