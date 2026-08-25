"""Capacidades financeiras (ACL) sobre o RBAC que já existe.

O sistema autoriza por **papel** (`Membership.role`): admin, organizador
(exibido como "Gerente"), visualizador e jogador. Este módulo **não** troca esse
modelo por um segundo sistema de permissões — ele apenas dá nome às operações
financeiras e diz quais papéis as possuem.

Por que nomear, se o papel já decide? Porque "financeiro" não é uma coisa só. A
diferença entre *ver* o financeiro, *dar baixa* e *cancelar uma baixa já
lançada* é real, e escrevê-la como `IsOrganizationOrganizerOrAdmin` em três
lugares esconde a regra dentro da view. Com as capacidades declaradas, a
resposta a "quem pode cancelar uma baixa?" está em uma tabela, não espalhada.

Guardar permissões por usuário no banco seria a evolução natural (a tabela
`ROLE_CAPABILITIES` viraria o padrão de cada papel), mas hoje isso seria uma
entidade a mais sem nenhum caso de uso pedindo — a organização quer decidir por
papel, não por pessoa.
"""

from common.permissions import (
    ROLE_ADMIN,
    ROLE_JOGADOR,
    ROLE_ORGANIZADOR,
    ROLE_VISUALIZADOR,
    HasOrganizationContext,
)

#: Ver o financeiro da organização (lista de mensalidades, painel, mensalistas).
FINANCIAL_VIEW = "financial.view"
#: Operar o financeiro: lançar mensalidade, gerar competência, cancelar cobrança.
FINANCIAL_MANAGE = "financial.manage"
#: Alterar o valor da mensalidade — individual ou em massa.
FINANCIAL_EDIT_FEE = "financial.edit_fee"
#: Dar baixa em uma competência.
FINANCIAL_REGISTER_PAYMENT = "financial.register_payment"
#: Cancelar uma baixa já lançada (exige motivo).
FINANCIAL_CANCEL_PAYMENT = "financial.cancel_payment"
#: Ler a trilha de auditoria financeira / linha do tempo de uma competência.
FINANCIAL_VIEW_AUDIT = "financial.view_audit"

_MANAGER_CAPABILITIES = frozenset(
    {
        FINANCIAL_VIEW,
        FINANCIAL_MANAGE,
        FINANCIAL_EDIT_FEE,
        FINANCIAL_REGISTER_PAYMENT,
        FINANCIAL_CANCEL_PAYMENT,
        FINANCIAL_VIEW_AUDIT,
    }
)

#: Quem tem o quê. O Visualizador **não** enxerga o financeiro: a regra atual do
#: produto é que ele vê a operação da pelada (jogadores, partidas, sorteios), não
#: o dinheiro. O Jogador só tem auto-serviço (`/charges/mine/`), que não passa
#: por capacidade nenhuma daqui — é filtrado pelo próprio login.
ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    ROLE_ADMIN: _MANAGER_CAPABILITIES,
    ROLE_ORGANIZADOR: _MANAGER_CAPABILITIES,
    ROLE_VISUALIZADOR: frozenset(),
    ROLE_JOGADOR: frozenset(),
}


def capabilities_for(role: str) -> frozenset[str]:
    return ROLE_CAPABILITIES.get(role, frozenset())


def has_capability(membership, capability: str) -> bool:
    """O Super Administrador entra com um vínculo sintético de papel `admin`
    (ver `accounts.organization_context`), então cai na mesma tabela — não
    existe um caminho paralelo de autorização para ele."""
    role = getattr(membership, "role", None)
    return capability in capabilities_for(role)


class HasFinancialCapability(HasOrganizationContext):
    """Base das permissões financeiras: exige contexto de organização **e** a
    capacidade declarada em `capability`.

    O contexto vem antes de propósito: sem organização resolvida não há o que
    autorizar, e é ele que garante o isolamento multi-tenant (a query da view
    filtra por `request.organization`, sempre)."""

    capability: str = FINANCIAL_VIEW
    message = "Seu perfil não tem permissão para esta operação financeira."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return has_capability(request.membership, self.capability)


class CanViewFinancial(HasFinancialCapability):
    capability = FINANCIAL_VIEW


class CanManageFinancial(HasFinancialCapability):
    capability = FINANCIAL_MANAGE


class CanEditFee(HasFinancialCapability):
    capability = FINANCIAL_EDIT_FEE


class CanRegisterPayment(HasFinancialCapability):
    capability = FINANCIAL_REGISTER_PAYMENT


class CanCancelPayment(HasFinancialCapability):
    capability = FINANCIAL_CANCEL_PAYMENT


class CanViewFinancialAudit(HasFinancialCapability):
    capability = FINANCIAL_VIEW_AUDIT
