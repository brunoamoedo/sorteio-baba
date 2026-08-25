from rest_framework.permissions import BasePermission

# ---------------------------------------------------------------------------
# Papéis dentro de uma organização
# ---------------------------------------------------------------------------
#
# O Super Administrador **não** é um papel daqui: ele é transversal (não
# pertence a organização nenhuma) e mora em `User.is_superadmin`. Misturar os
# dois faria o acesso global depender de uma `Membership`, que é justamente o
# que ele não tem.

ROLE_ADMIN = "admin"
ROLE_ORGANIZADOR = "organizador"
ROLE_JOGADOR = "jogador"
ROLE_VISUALIZADOR = "visualizador"

ROLE_CHOICES = [
    (ROLE_ADMIN, "Administrador"),
    (ROLE_ORGANIZADOR, "Gerente"),
    (ROLE_JOGADOR, "Jogador"),
    (ROLE_VISUALIZADOR, "Visualizador"),
]

#: Quem administra a organização. `admin` e `organizador` (exibido como
#: "Gerente") têm o mesmo poder operacional — a distinção é histórica.
MANAGER_ROLES = (ROLE_ADMIN, ROLE_ORGANIZADOR)

#: Quem enxerga os dados da organização de forma ampla (listas, auditoria,
#: estatísticas). **Jogador não entra aqui**: ele só vê o que é dele.
VIEWER_ROLES = (*MANAGER_ROLES, ROLE_VISUALIZADOR)

#: Todo mundo com vínculo ativo, incluindo o jogador.
ALL_ROLES = (*VIEWER_ROLES, ROLE_JOGADOR)


class HasOrganizationContext(BasePermission):
    """Toda rota tenant-scoped exige o header X-Organization-Id resolvido
    para uma Membership ativa do usuário autenticado.

    Um Super Administrador não tem Membership: `resolve_organization` monta um
    contexto sintético para ele (ver `apps.accounts.organization_context`), o
    que lhe dá acesso a qualquer organização sem furar o isolamento das rotas
    normais — a query continua filtrando por `request.organization`."""

    message = "Cabeçalho X-Organization-Id ausente ou organização inválida para este usuário."

    def has_permission(self, request, view):
        # Import local para evitar ciclo: apps.accounts.models importa
        # ROLE_CHOICES deste módulo, e organization_context importa models.
        from apps.accounts.organization_context import resolve_organization

        resolve_organization(request)
        return request.organization is not None


class _RoleRequiredPermission(HasOrganizationContext):
    allowed_roles: tuple[str, ...] = ()

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.membership.role in self.allowed_roles


class IsOrganizationAdmin(_RoleRequiredPermission):
    allowed_roles = (ROLE_ADMIN,)


class IsOrganizationOrganizerOrAdmin(_RoleRequiredPermission):
    """Gestão da organização: jogadores, partidas, sorteio, financeiro."""

    allowed_roles = MANAGER_ROLES


class IsOrganizationMember(_RoleRequiredPermission):
    """Leitura ampla da organização.

    **Não inclui o Jogador** de propósito: o papel dele é de auto-serviço
    (ver as próprias partidas, confirmar a própria presença, ver os próprios
    pagamentos), não de enxergar o cadastro inteiro, a auditoria e as
    estatísticas de todo mundo. Rotas de auto-serviço usam
    `IsOrganizationParticipant` e filtram pelo próprio usuário."""

    allowed_roles = VIEWER_ROLES


class IsOrganizationParticipant(_RoleRequiredPermission):
    """Qualquer vínculo ativo, incluindo Jogador.

    Usar **somente** em rotas que já restringem o resultado ao próprio
    usuário — caso contrário o jogador enxerga dados de terceiros."""

    allowed_roles = ALL_ROLES


class IsSuperAdmin(BasePermission):
    """Administração do sistema, fora do escopo de qualquer organização."""

    message = "Requer perfil de Super Administrador."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and user.is_superadmin)
