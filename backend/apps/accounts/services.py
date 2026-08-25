from django.db import transaction

from apps.players.services import seed_default_positions
from common.permissions import ROLE_ADMIN

from .models import Membership, Organization, User


@transaction.atomic
def register_organization(*, organization_name: str, username: str, email: str, password: str) -> Membership:
    """Cria o primeiro usuário administrador e a organização em uma única
    transação, já semeando as posições padrão (GOL/ZAG/ME/AT)."""
    user = User.objects.create_user(username=username, email=email, password=password)
    organization = Organization.objects.create(name=organization_name)
    membership = Membership.objects.create(user=user, organization=organization, role=ROLE_ADMIN)
    seed_default_positions(organization)
    return membership
