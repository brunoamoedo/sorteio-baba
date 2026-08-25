"""Gestão de pessoas **dentro de uma organização** — para o Gerente.

Isto não duplica `/api/admin/memberships/`: aquela rota é do Super
Administrador e enxerga todas as organizações; esta é escopada por
`request.organization` e nunca sai dela. A matriz de permissões prevê
"gerenciar usuários e perfis: Gerente — só da org", e sem esta rota o Gerente
dependia do Super Admin para cada pessoa que entrava na pelada.
"""

from django.db import transaction
from rest_framework import viewsets
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import log_action
from common.exceptions import DomainError
from common.permissions import MANAGER_ROLES, IsOrganizationOrganizerOrAdmin

from .models import Membership, User
from .serializers import OrganizationMemberSerializer, OrganizationMemberWriteSerializer


class OrganizationMemberViewSet(viewsets.ModelViewSet):
    """Membros da organização corrente: quem entra, com qual perfil, e quem sai."""

    permission_classes = [IsOrganizationOrganizerOrAdmin]
    filterset_fields = ["role", "is_active"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Membership.objects.none()
        return (
            Membership.objects.filter(organization=self.request.organization)
            .select_related("user")
            .order_by("user__username")
        )

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return OrganizationMemberWriteSerializer
        return OrganizationMemberSerializer

    def _assert_not_last_manager(self, membership, *, new_role=None, new_active=None):
        """Impede a organização de ficar sem ninguém que possa administrá-la.

        Sem esta trava, um gerente conseguia rebaixar a si mesmo (ou desativar o
        último colega) e **trancar todo mundo para fora** da gestão da própria
        pelada — só um Super Admin conseguiria destravar depois."""
        continua_gerente = (
            new_role in MANAGER_ROLES if new_role is not None else membership.role in MANAGER_ROLES
        ) and (new_active if new_active is not None else membership.is_active)
        if continua_gerente:
            return

        outros = (
            Membership.objects.filter(
                organization=membership.organization, role__in=MANAGER_ROLES, is_active=True
            )
            .exclude(pk=membership.pk)
            .exists()
        )
        if not outros:
            raise DomainError(
                "Esta é a última pessoa com perfil de Gerente na organização. "
                "Promova outro membro antes de alterar este."
            )

    @transaction.atomic
    def perform_create(self, serializer):
        """Adiciona alguém à organização.

        O usuário pode já existir (identificado pelo e-mail) ou ser criado
        agora. O e-mail é a chave porque é o que o organizador tem em mãos — o
        `username` é detalhe interno."""
        data = serializer.validated_data
        email = data["email"].strip().lower()
        organization = self.request.organization

        user = User.objects.filter(email__iexact=email).first()
        criado = False
        if user is None:
            if not data.get("password"):
                raise DomainError(
                    f"Não existe usuário com o e-mail {email}. "
                    "Informe uma senha inicial para criar o acesso."
                )
            user = User.objects.create_user(
                username=data.get("username") or email.split("@")[0],
                email=email,
                password=data["password"],
            )
            criado = True

        if Membership.objects.filter(organization=organization, user=user).exists():
            raise DomainError(f"{user.username} já faz parte desta organização.")

        membership = Membership.objects.create(
            organization=organization, user=user, role=data["role"]
        )
        serializer.instance = membership
        log_action(
            organization=organization,
            action=AuditLog.Action.MEMBERSHIP_CHANGED,
            after={
                "user": user.username,
                "email": user.email,
                "role": membership.role,
                "user_created": criado,
            },
        )

    def perform_update(self, serializer):
        membership = serializer.instance
        before = {"role": membership.role, "is_active": membership.is_active}
        self._assert_not_last_manager(
            membership,
            new_role=serializer.validated_data.get("role"),
            new_active=serializer.validated_data.get("is_active"),
        )
        super().perform_update(serializer)
        log_action(
            organization=self.request.organization,
            action=AuditLog.Action.MEMBERSHIP_CHANGED,
            before=before,
            after={"role": membership.role, "is_active": membership.is_active},
        )

    def perform_destroy(self, instance):
        """Remover alguém da organização é **desativar o vínculo**, não apagar.

        A pessoa pode ter confirmações, sorteios e mensalidades no histórico —
        e o login dela continua valendo nas outras organizações."""
        self._assert_not_last_manager(instance, new_active=False)
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        log_action(
            organization=self.request.organization,
            action=AuditLog.Action.MEMBERSHIP_CHANGED,
            before={"is_active": True},
            after={"is_active": False, "user": instance.user.username},
        )

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.perform_destroy(instance)
        return Response(OrganizationMemberSerializer(instance).data)
