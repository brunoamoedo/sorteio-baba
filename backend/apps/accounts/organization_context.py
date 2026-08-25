from common.permissions import ROLE_ADMIN

from .models import Membership, Organization

ORGANIZATION_HEADER = "X-Organization-Id"


class SuperAdminMembership:
    """Vínculo **sintético** de um Super Administrador com uma organização.

    Ele não tem (nem deve ter) `Membership` no banco: o acesso dele é do
    sistema, não de uma pelada. Mas todo o resto do código pergunta
    `request.membership.role` para decidir permissão, e as queries filtram por
    `request.organization`. Devolver este objeto mantém esse contrato — o
    isolamento multi-tenant continua valendo, o super admin apenas consegue
    escolher qualquer organização no cabeçalho.

    Não é um `Membership` de verdade de propósito: se algum código tentar
    salvá-lo, quebra alto em vez de criar um vínculo fantasma no banco."""

    def __init__(self, user, organization):
        self.user = user
        self.organization = organization
        self.role = ROLE_ADMIN
        self.is_active = True
        self.is_synthetic = True

    def __str__(self):
        return f"{self.user} @ {self.organization} (super admin)"


def resolve_organization(request):
    """
    Resolve e cacheia no `request` a organização/membership corrente a partir
    do header `X-Organization-Id`.

    Precisa ser chamado depois que a autenticação DRF já rodou (isto é, de
    dentro de uma permission class, nunca em middleware Django puro) — a
    autenticação JWT só popula `request.user` durante o ciclo de vida da
    DRF Request, não no middleware do Django, que roda antes disso.
    """
    if hasattr(request, "_organization_resolved"):
        return

    request._organization_resolved = True
    request.organization = None
    request.membership = None

    organization_id = request.headers.get(ORGANIZATION_HEADER)
    user = getattr(request, "user", None)

    if not organization_id or user is None or not user.is_authenticated:
        return

    # O cabeçalho é entrada do cliente: um valor não numérico fazia o filtro
    # estourar `ValueError` e virar HTTP 500. Cabeçalho inválido é 403, não
    # erro do servidor.
    try:
        organization_id = int(organization_id)
    except (TypeError, ValueError):
        return

    membership = (
        Membership.objects.select_related("organization")
        .filter(
            organization_id=organization_id,
            user=user,
            is_active=True,
            organization__is_active=True,
        )
        .first()
    )
    if membership is not None:
        request.organization = membership.organization
        request.membership = membership
        return

    # Super admin sem vínculo: entra em qualquer organização ativa. Só depois
    # de tentar o vínculo real, para que um super admin que também é membro
    # continue usando o papel dele lá.
    if user.is_superadmin:
        organization = Organization.objects.filter(id=organization_id, is_active=True).first()
        if organization is not None:
            request.organization = organization
            request.membership = SuperAdminMembership(user, organization)
