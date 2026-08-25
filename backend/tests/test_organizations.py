"""Criação de organização e o seletor de organizações.

O cadastro público (`/api/auth/register-organization/`) **não existe mais**:
qualquer pessoa com o endereço do sistema criava uma organização e saía dela
como administradora. Criar organização agora é ato de Super Administrador,
pela rota `/api/admin/organizations/`, já autenticado.
"""

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Membership, Organization, User
from apps.players.models import Position

from .factories import MembershipFactory, OrganizationFactory, UserFactory


def client_for(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


@pytest.mark.django_db
def test_cadastro_publico_de_organizacao_nao_existe():
    """A porta fechada é a razão de ser desta mudança — sem este teste, alguém
    reintroduz a rota e nada acusa."""
    response = APIClient().post(
        "/api/auth/register-organization/",
        {
            "organization_name": "Pelada da Terça",
            "username": "carlos",
            "email": "carlos@example.com",
            "password": "senha-super-forte-1",
        },
        format="json",
    )

    assert response.status_code == 404
    assert not Organization.objects.filter(name="Pelada da Terça").exists()


@pytest.mark.django_db
def test_superadmin_cria_organizacao_com_posicoes_semeadas():
    root = User.objects.create_user(
        username="root", email="root@sistema.com", password="senha-forte-123", is_superadmin=True
    )

    response = client_for(root).post(
        "/api/admin/organizations/", {"name": "Pelada da Terça"}, format="json"
    )

    assert response.status_code == 201
    organization_id = response.json()["id"]
    codes = set(Position.objects.filter(organization_id=organization_id).values_list("code", flat=True))
    assert codes == {"GOL", "ZAG", "ME", "AT"}


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["admin", "organizador"])
def test_quem_nao_e_superadmin_nao_cria_organizacao(role):
    """Nem o Administrador da própria pelada: o papel é dentro da organização,
    não acima dela."""
    membership = MembershipFactory(role=role)
    client = client_for(membership.user)
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(membership.user).access_token}",
        HTTP_X_ORGANIZATION_ID=str(membership.organization_id),
    )

    response = client.post("/api/admin/organizations/", {"name": "Pelada Pirata"}, format="json")

    assert response.status_code == 403
    assert not Organization.objects.filter(name="Pelada Pirata").exists()


@pytest.mark.django_db
def test_my_organizations_lists_only_active_memberships():
    user = UserFactory(username="bruno")
    MembershipFactory(user=user, organization=OrganizationFactory(name="Pelada do Bruno"), role="admin")
    inativa = MembershipFactory(user=user, organization=OrganizationFactory(name="Pelada Antiga"))
    Membership.objects.filter(pk=inativa.pk).update(is_active=False)

    response = client_for(user).get("/api/auth/organizations/mine/")

    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    assert results[0]["organization"]["name"] == "Pelada do Bruno"
    assert results[0]["role"] == "admin"
