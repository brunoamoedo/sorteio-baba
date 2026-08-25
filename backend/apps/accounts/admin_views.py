"""Administração do sistema — fora do escopo de qualquer organização.

Estas rotas vivem separadas (`/api/admin/*`) de propósito. As rotas normais
continuam exigindo `X-Organization-Id` e filtrando por `request.organization`;
o isolamento multi-tenant não é afrouxado em lugar nenhum para acomodar o
super admin. Quem precisa enxergar tudo entra por aqui, e só ele entra.
"""

from django.db.models import Count
from rest_framework import viewsets
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.audit.serializers import AuditLogSerializer
from apps.audit.services import log_action
from common.pagination import DefaultPagination
from common.permissions import IsSuperAdmin

from .models import Membership, Organization, User
from .serializers import (
    AdminMembershipSerializer,
    AdminOrganizationSerializer,
    AdminUserSerializer,
)


class AdminOrganizationViewSet(viewsets.ModelViewSet):
    """CRUD de organizações. Remoção é soft-delete: apagar de verdade levaria
    junto partidas, sorteios e o histórico financeiro."""

    serializer_class = AdminOrganizationSerializer
    permission_classes = [IsSuperAdmin]
    # `order_by` explícito: `Organization` não define `Meta.ordering`, e sem
    # ordem estável a paginação pode repetir ou pular registros entre páginas.
    queryset = (
        Organization.objects.annotate(
            members_count=Count("memberships", distinct=True),
            players_count=Count("players", distinct=True),
        )
        .order_by("name")
        .all()
    )
    filterset_fields = ["is_active"]
    search_fields = ["name", "slug"]

    def perform_create(self, serializer):
        """Toda organização nasce utilizável: com as posições padrão semeadas,
        igual ao que `register_organization` faz na carga inicial."""
        from apps.players.services import seed_default_positions

        super().perform_create(serializer)
        seed_default_positions(serializer.instance)
        log_action(
            organization=serializer.instance,
            action=AuditLog.Action.ORGANIZATION_CREATED,
            after={"name": serializer.instance.name, "slug": serializer.instance.slug},
        )

    def perform_update(self, serializer):
        before = {
            "name": serializer.instance.name,
            "is_active": serializer.instance.is_active,
        }
        super().perform_update(serializer)
        log_action(
            organization=serializer.instance,
            action=AuditLog.Action.ORGANIZATION_UPDATED,
            before=before,
            after={"name": serializer.instance.name, "is_active": serializer.instance.is_active},
        )


class AdminUserViewSet(viewsets.ModelViewSet):
    serializer_class = AdminUserSerializer
    permission_classes = [IsSuperAdmin]
    queryset = User.objects.prefetch_related("memberships__organization").all()
    search_fields = ["username", "email"]
    filterset_fields = ["is_superadmin", "is_active"]


class AdminMembershipViewSet(viewsets.ModelViewSet):
    """Vínculo usuário × organização × papel.

    É esta tabela que permite o mesmo login ser Gerente numa pelada e Jogador
    em outra — o papel mora no vínculo, não no usuário."""

    serializer_class = AdminMembershipSerializer
    permission_classes = [IsSuperAdmin]
    queryset = Membership.objects.select_related("user", "organization").all()
    filterset_fields = ["organization", "user", "role", "is_active"]

    def perform_create(self, serializer):
        super().perform_create(serializer)
        self._log(serializer.instance, before=None)

    def perform_update(self, serializer):
        before = {"role": serializer.instance.role, "is_active": serializer.instance.is_active}
        super().perform_update(serializer)
        self._log(serializer.instance, before=before)

    def _log(self, membership, *, before):
        log_action(
            organization=membership.organization,
            action=AuditLog.Action.MEMBERSHIP_CHANGED,
            before=before or {},
            after={
                "user": membership.user.username,
                "role": membership.role,
                "is_active": membership.is_active,
            },
        )


class GlobalAuditLogView(APIView):
    """Auditoria de **todas** as organizações, só para o super admin.

    A rota por organização (`/api/audit-logs/`) continua existindo e continua
    escopada — esta aqui não a substitui."""

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        logs = AuditLog.objects.select_related("organization", "user", "player").all()
        if organization_id := request.query_params.get("organization"):
            logs = logs.filter(organization_id=organization_id)
        if action := request.query_params.get("action"):
            logs = logs.filter(action=action)

        paginator = DefaultPagination()
        page = paginator.paginate_queryset(logs, request, view=self)
        return paginator.get_paginated_response(AuditLogSerializer(page, many=True).data)
