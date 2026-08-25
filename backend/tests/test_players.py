import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.players.models import Player
from common.permissions import ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import MembershipFactory, OrganizationFactory, PlayerFactory, PositionFactory


def authenticated_client(user, organization=None):
    client = APIClient()
    access = str(RefreshToken.for_user(user).access_token)
    headers = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
    if organization is not None:
        headers["HTTP_X_ORGANIZATION_ID"] = str(organization.id)
    client.credentials(**headers)
    return client


@pytest.mark.django_db
def test_missing_organization_header_is_rejected():
    membership = MembershipFactory()
    client = authenticated_client(membership.user)  # sem X-Organization-Id

    response = client.get("/api/players/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_player_list_is_isolated_per_organization():
    org_a = OrganizationFactory()
    org_b = OrganizationFactory()
    membership_a = MembershipFactory(organization=org_a)

    PlayerFactory(organization=org_a, name="Jogador da Org A")
    PlayerFactory(organization=org_b, name="Jogador da Org B")

    client = authenticated_client(membership_a.user, organization=org_a)
    response = client.get("/api/players/")

    assert response.status_code == 200
    names = [p["name"] for p in response.json()["results"]]
    assert names == ["Jogador da Org A"]


@pytest.mark.django_db
def test_user_cannot_access_organization_without_membership():
    org_a = OrganizationFactory()
    org_b = OrganizationFactory()
    membership_a = MembershipFactory(organization=org_a)

    client = authenticated_client(membership_a.user, organization=org_b)
    response = client.get("/api/players/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_visualizador_cannot_create_player_but_can_list():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    position = PositionFactory(organization=org)

    client = authenticated_client(membership.user, organization=org)

    list_response = client.get("/api/players/")
    assert list_response.status_code == 200

    create_response = client.post(
        "/api/players/",
        {"name": "Novo Jogador", "primary_position": position.id, "skill_level": 3},
        format="json",
    )
    assert create_response.status_code == 403


@pytest.mark.django_db
def test_organizador_can_create_player():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    position = PositionFactory(organization=org)

    client = authenticated_client(membership.user, organization=org)
    response = client.post(
        "/api/players/",
        {"name": "Novo Jogador", "primary_position": position.id, "skill_level": 4},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Novo Jogador"


@pytest.mark.django_db
def test_cannot_set_primary_position_from_another_organization():
    org_a = OrganizationFactory()
    org_b = OrganizationFactory()
    membership = MembershipFactory(organization=org_a, role=ROLE_ORGANIZADOR)
    foreign_position = PositionFactory(organization=org_b)

    client = authenticated_client(membership.user, organization=org_a)
    response = client.post(
        "/api/players/",
        {"name": "Jogador Suspeito", "primary_position": foreign_position.id, "skill_level": 3},
        format="json",
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_deleting_player_soft_deletes_instead_of_removing_row():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    player = PlayerFactory(organization=org)

    client = authenticated_client(membership.user, organization=org)
    response = client.delete(f"/api/players/{player.id}/")

    assert response.status_code == 204
    assert not Player.objects.filter(id=player.id).exists()
    stored = Player.all_objects.get(id=player.id)
    assert stored.is_deleted is True
    assert stored.deleted_at is not None


# --- Ações em lote na tela de Jogadores --------------------------------------


@pytest.mark.django_db
def test_bulk_action_changes_status_of_selected_players():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    a, b, c = [PlayerFactory(organization=org) for _ in range(3)]

    response = client.post("/api/players/bulk/", {"ids": [a.id, b.id], "action": "inativo"}, format="json")

    assert response.status_code == 200
    assert response.json()["updated"] == 2
    for player in (a, b, c):
        player.refresh_from_db()
    assert a.status == Player.Status.INATIVO
    assert b.status == Player.Status.INATIVO
    assert c.status == Player.Status.ATIVO  # não selecionado, intocado


@pytest.mark.django_db
def test_bulk_delete_is_soft_and_preserves_history():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    player = PlayerFactory(organization=org)

    response = client.post("/api/players/bulk/", {"ids": [player.id], "action": "delete"}, format="json")

    assert response.status_code == 200
    assert not Player.objects.filter(id=player.id).exists()
    assert Player.all_objects.get(id=player.id).is_deleted is True


@pytest.mark.django_db
def test_bulk_action_cannot_reach_another_organization():
    org = OrganizationFactory()
    outra = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    alheio = PlayerFactory(organization=outra)

    response = client.post("/api/players/bulk/", {"ids": [alheio.id], "action": "inativo"}, format="json")

    assert response.status_code == 200
    assert response.json()["updated"] == 0
    alheio.refresh_from_db()
    assert alheio.status == Player.Status.ATIVO


@pytest.mark.django_db
def test_bulk_action_requires_organizer_role():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    client = authenticated_client(membership.user, organization=org)
    player = PlayerFactory(organization=org)

    response = client.post("/api/players/bulk/", {"ids": [player.id], "action": "inativo"}, format="json")

    assert response.status_code == 403


@pytest.mark.django_db
def test_bulk_action_rejects_unknown_action_and_empty_selection():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    player = PlayerFactory(organization=org)

    assert client.post(
        "/api/players/bulk/", {"ids": [player.id], "action": "explodir"}, format="json"
    ).status_code == 400
    assert client.post("/api/players/bulk/", {"ids": [], "action": "inativo"}, format="json").status_code == 400


@pytest.mark.django_db
def test_telefone_precisa_ser_celular_com_o_9():
    """A regra vale na API, não só na máscara da tela.

    O telefone vira o **usuário do login** da pessoa; um fixo de 10 dígitos
    gerava um acesso que ela digitava errado na primeira tentativa.
    """
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    position = PositionFactory(organization=org)
    client = authenticated_client(membership.user, organization=org)

    def criar(phone):
        return client.post(
            "/api/players/",
            {
                "name": "Fulano",
                "phone": phone,
                "player_type": "mensalista",
                "status": "ativo",
                "skill_level": 3,
                "primary_position": position.id,
            },
            format="json",
        )

    assert criar("7781024129").status_code == 400  # fixo, 10 dígitos
    assert criar("(11) 8143-44257").status_code == 400  # 11 dígitos, sem o 9
    assert criar("(11) 9143").status_code == 400  # incompleto

    # Vazio continua valendo: nem toda ficha tem telefone.
    assert criar("").status_code == 201
    assert criar("(11) 91434-4257").status_code == 201
