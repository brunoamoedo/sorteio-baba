from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.audit.services import log_action
from common.permissions import ROLE_ADMIN

from .login_provisioning import change_own_password
from .models import Membership, Organization
from .organization_context import resolve_organization
from .serializers import (
    ChangePasswordSerializer,
    MyMembershipSerializer,
    OrganizationSerializer,
    UserSerializer,
)


class MeView(RetrieveAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class MyOrganizationsView(ListAPIView):
    serializer_class = MyMembershipSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Membership.objects.none()
        return Membership.objects.select_related("organization").filter(
            user=self.request.user, is_active=True, organization__is_active=True
        )

    def list(self, request, *args, **kwargs):
        """O seletor de organização da tela.

        Um Super Administrador normalmente não tem vínculo nenhum — sem este
        caminho ele logava e não tinha organização para escolher, ficando preso
        na tela de seleção. Ele recebe todas as ativas, marcadas como acesso de
        sistema (`is_superadmin_access`).

        O resultado sai **paginado como qualquer outra listagem**: o cliente usa
        o mesmo `fetchAllPages` para as duas rotas, e devolver uma lista crua
        aqui quebrava o seletor justamente para quem mais precisa dele."""
        if not request.user.is_superadmin:
            return super().list(request, *args, **kwargs)

        vinculos = {m.organization_id: m for m in self.get_queryset()}
        payload = [
            {
                "organization": OrganizationSerializer(organization).data,
                "role": vinculos[organization.id].role
                if organization.id in vinculos
                else ROLE_ADMIN,
                "is_active": True,
                "is_superadmin_access": organization.id not in vinculos,
            }
            for organization in Organization.objects.filter(is_active=True).order_by("name")
        ]
        page = self.paginate_queryset(payload)
        return self.get_paginated_response(page if page is not None else payload)


class ChangePasswordView(APIView):
    """Troca da própria senha — e o caminho para sair do primeiro acesso.

    Qualquer pessoa autenticada pode; ninguém troca a senha de outra por aqui.
    Fica **fora** do bloqueio do middleware de propósito: é a única saída de
    quem está com a senha temporária."""

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        primeiro_acesso = change_own_password(
            user=request.user,
            current_password=serializer.validated_data["current_password"],
            new_password=serializer.validated_data["new_password"],
        )

        # A senha é da identidade global, mas a trilha é por organização. Sem
        # contexto (a tela de troca não manda o cabeçalho), não há onde
        # registrar — o log estruturado do serviço já guardou o evento.
        resolve_organization(request)
        if request.organization is not None:
            log_action(
                organization=request.organization,
                action=AuditLog.Action.PASSWORD_CHANGED,
                user=request.user,
                entity="user",
                entity_id=request.user.id,
                after={"first_access": primeiro_acesso},
            )

        return Response({"detail": "Senha alterada.", "first_access": primeiro_acesso})
