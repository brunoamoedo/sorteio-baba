"""Perfis de usuário: Super Administrador, Gerente, Jogador e Visualizador.

O risco desta entrega é um papel novo vazar acesso por alguma rota esquecida.
Por isso o `jogador` entra **negando por padrão** (fora de
`IsOrganizationMember`) e existe aqui uma varredura que exige negação explícita
rota a rota — acrescentar uma rota de gestão sem pensar no papel faz o teste
falhar, não passar.
"""

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Membership, Organization, User
from common.permissions import (
    ROLE_ADMIN,
    ROLE_JOGADOR,
    ROLE_ORGANIZADOR,
    ROLE_VISUALIZADOR,
)

from .factories import MatchFactory, MembershipFactory, OrganizationFactory, PlayerFactory


def client_for(user, organization=None):
    client = APIClient()
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}",
        **({"HTTP_X_ORGANIZATION_ID": str(organization.id)} if organization else {}),
    )
    return client


def superadmin(**kwargs):
    return User.objects.create_user(
        username=kwargs.get("username", "root"),
        email=kwargs.get("email", "root@sistema.com"),
        password="senha-forte-123",
        is_superadmin=True,
    )


# ---------------------------------------------------------------------------
# Super Administrador
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_superadmin_reaches_any_organization_without_membership():
    """Ele não tem vínculo — e não deve ter. O contexto é sintético."""
    org = OrganizationFactory()
    PlayerFactory(organization=org)
    root = superadmin()

    assert not Membership.objects.filter(user=root).exists()
    response = client_for(root, org).get("/api/players/")

    assert response.status_code == 200
    assert response.json()["count"] == 1


@pytest.mark.django_db
def test_a_plain_user_without_membership_is_still_blocked():
    """A porta aberta é só para o super admin."""
    org = OrganizationFactory()
    intruso = User.objects.create_user(username="fulano", email="f@x.com", password="senha-forte-123")

    assert client_for(intruso, org).get("/api/players/").status_code == 403


@pytest.mark.django_db
def test_superadmin_membership_wins_over_the_synthetic_one():
    """Se ele **é** membro, vale o papel real dele lá — o contexto sintético é
    só para quem não tem vínculo."""
    org = OrganizationFactory()
    root = superadmin()
    Membership.objects.create(user=root, organization=org, role=ROLE_VISUALIZADOR)

    # Visualizador não cria jogador, nem sendo super admin naquela organização.
    response = client_for(root, org).post("/api/players/", {"name": "X"}, format="json")
    assert response.status_code == 403


@pytest.mark.django_db
def test_superadmin_crud_of_organizations():
    root = superadmin()
    client = client_for(root)

    created = client.post("/api/admin/organizations/", {"name": "Arena Norte"}, format="json")
    assert created.status_code == 201
    org_id = created.json()["id"]
    assert created.json()["slug"] == "arena-norte"

    # Nasce utilizável: as posições padrão já foram semeadas.
    from apps.players.models import Position

    assert Position.objects.filter(organization_id=org_id).count() == 4

    assert client.patch(
        f"/api/admin/organizations/{org_id}/", {"is_active": False}, format="json"
    ).json()["is_active"] is False
    assert client.get("/api/admin/organizations/").json()["count"] >= 1


@pytest.mark.django_db
def test_admin_routes_are_closed_to_everyone_else():
    org = OrganizationFactory()
    for role in (ROLE_ADMIN, ROLE_ORGANIZADOR, ROLE_JOGADOR, ROLE_VISUALIZADOR):
        membership = MembershipFactory(organization=org, role=role)
        client = client_for(membership.user, org)
        for rota in (
            "/api/admin/organizations/",
            "/api/admin/users/",
            "/api/admin/memberships/",
            "/api/admin/audit-logs/",
        ):
            assert client.get(rota).status_code == 403, f"{role} entrou em {rota}"


@pytest.mark.django_db
def test_superadmin_sees_every_organization_in_the_selector():
    """Sem isto ele logava e ficava preso na tela de seleção, por não ter
    vínculo com organização nenhuma."""
    OrganizationFactory()
    OrganizationFactory()
    root = superadmin()

    payload = client_for(root).get("/api/auth/organizations/mine/").json()

    # Mesmo envelope paginado das demais listagens: o cliente usa um
    # `fetchAllPages` só para as duas rotas.
    assert payload["count"] == 2
    assert all(item["is_superadmin_access"] for item in payload["results"])


@pytest.mark.django_db
def test_me_exposes_the_superadmin_flag():
    root = superadmin()
    comum = MembershipFactory().user

    assert client_for(root).get("/api/auth/me/").json()["is_superadmin"] is True
    assert client_for(comum).get("/api/auth/me/").json()["is_superadmin"] is False


# ---------------------------------------------------------------------------
# Papel Jogador — nega por padrão
# ---------------------------------------------------------------------------

#: Rotas de gestão/leitura ampla. O Jogador não pode entrar em nenhuma:
#: acrescentar uma rota aqui sem tratar o papel faz este teste quebrar.
ROTAS_FECHADAS_AO_JOGADOR = [
    "/api/players/",
    "/api/recurring-games/",
    "/api/audit-logs/",
    "/api/statistics/players/",
    "/api/finance/charges/",
    "/api/finance/fee-plans/",
    "/api/finance/summary/",
]


@pytest.mark.django_db
@pytest.mark.parametrize("rota", ROTAS_FECHADAS_AO_JOGADOR)
def test_player_role_is_denied_on_management_routes(rota):
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_JOGADOR)

    assert client_for(membership.user, org).get(rota).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("rota", ROTAS_FECHADAS_AO_JOGADOR)
def test_manager_keeps_access_to_the_same_routes(rota):
    """O contrapeso do teste acima: o papel novo não pode ter fechado a porta
    de quem já entrava."""
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    assert client_for(membership.user, org).get(rota).status_code == 200


@pytest.mark.django_db
def test_viewer_keeps_read_access_and_is_not_downgraded():
    """O Visualizador continua existindo e continua vendo — o Jogador foi
    acrescentado, não substituiu ninguém."""
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    client = client_for(membership.user, org)

    assert client.get("/api/players/").status_code == 200
    assert client.get("/api/audit-logs/").status_code == 200
    # Mas segue sem escrever.
    assert client.post("/api/players/", {"name": "X"}, format="json").status_code == 403


@pytest.mark.django_db
def test_player_role_cannot_write_anywhere():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    match = MatchFactory(organization=org)
    client = client_for(membership.user, org)

    assert client.post("/api/players/", {"name": "X"}, format="json").status_code == 403
    assert client.post(f"/api/matches/{match.id}/draw/").status_code == 403
    assert client.delete(f"/api/matches/{match.id}/").status_code == 403


# ---------------------------------------------------------------------------
# A mesma pessoa em várias organizações, com papéis diferentes
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_one_login_holds_different_roles_per_organization():
    """O caso do enunciado: João é Gerente numa pelada e Jogador em outra,
    com um cadastro só."""
    joao = User.objects.create_user(
        username="joao", email="joao@x.com", password="senha-forte-123"
    )
    arena = Organization.objects.create(name="Arena Norte")
    liga = Organization.objects.create(name="Liga Empresarial")
    quinta = Organization.objects.create(name="Futebol Quinta")

    Membership.objects.create(user=joao, organization=arena, role=ROLE_ORGANIZADOR)
    Membership.objects.create(user=joao, organization=liga, role=ROLE_JOGADOR)
    Membership.objects.create(user=joao, organization=quinta, role=ROLE_JOGADOR)

    # Gerente na Arena: enxerga o cadastro.
    assert client_for(joao, arena).get("/api/players/").status_code == 200
    # Jogador na Liga: não enxerga.
    assert client_for(joao, liga).get("/api/players/").status_code == 403

    organizacoes = client_for(joao).get("/api/auth/organizations/mine/").json()
    papeis = {item["organization"]["name"]: item["role"] for item in organizacoes["results"]}
    assert papeis == {
        "Arena Norte": ROLE_ORGANIZADOR,
        "Liga Empresarial": ROLE_JOGADOR,
        "Futebol Quinta": ROLE_JOGADOR,
    }


@pytest.mark.django_db
def test_data_never_crosses_between_organizations():
    joao = User.objects.create_user(username="joao", email="j@x.com", password="senha-forte-123")
    arena = Organization.objects.create(name="Arena")
    liga = Organization.objects.create(name="Liga")
    Membership.objects.create(user=joao, organization=arena, role=ROLE_ORGANIZADOR)
    Membership.objects.create(user=joao, organization=liga, role=ROLE_ORGANIZADOR)

    PlayerFactory(organization=arena, name="Só da Arena")
    PlayerFactory(organization=liga, name="Só da Liga")

    da_arena = [p["name"] for p in client_for(joao, arena).get("/api/players/").json()["results"]]
    da_liga = [p["name"] for p in client_for(joao, liga).get("/api/players/").json()["results"]]

    assert da_arena == ["Só da Arena"]
    assert da_liga == ["Só da Liga"]


@pytest.mark.django_db
def test_malformed_organization_header_is_forbidden_not_a_crash():
    membership = MembershipFactory()
    client = APIClient()
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(membership.user).access_token}",
        HTTP_X_ORGANIZATION_ID="não-é-número",
    )

    assert client.get("/api/players/").status_code == 403


# ---------------------------------------------------------------------------
# Auto-serviço do jogador: partidas e presença
# ---------------------------------------------------------------------------


def _player_membership(org, *, name="Eu"):
    """Um jogador com login vinculado à ficha desta organização."""
    membership = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    player = PlayerFactory(organization=org, user=membership.user, name=name)
    return membership, player


@pytest.mark.django_db
def test_player_lists_their_own_matches_with_their_presence():
    org = OrganizationFactory()
    membership, player = _player_membership(org)
    match = MatchFactory(organization=org, max_players=20, min_players=2)
    client = client_for(membership.user, org)

    partidas = client.get("/api/matches/mine/").json()

    assert len(partidas) == 1
    assert partidas[0]["id"] == match.id
    assert partidas[0]["my_confirmation_status"] == "pending"
    assert partidas[0]["my_player_id"] == player.id


@pytest.mark.django_db
def test_player_confirms_and_cancels_their_own_presence():
    from apps.matches.models import Confirmation

    org = OrganizationFactory()
    membership, player = _player_membership(org)
    match = MatchFactory(organization=org, max_players=20, min_players=2)
    client = client_for(membership.user, org)

    confirmada = client.post(
        f"/api/matches/{match.id}/confirm-me/", {"status": "confirmed"}, format="json"
    )
    assert confirmada.status_code == 200
    assert confirmada.json()["status"] == "confirmed"
    assert Confirmation.objects.get(match=match, player=player).status == "confirmed"

    cancelada = client.post(
        f"/api/matches/{match.id}/confirm-me/", {"status": "declined"}, format="json"
    )
    assert cancelada.json()["status"] == "declined"
    assert client.get("/api/matches/mine/").json()[0]["my_confirmation_status"] == "declined"


@pytest.mark.django_db
def test_confirm_me_ignores_a_player_id_sent_by_the_client():
    """A trava central do auto-serviço: mandar o id de outra pessoa no corpo
    não confirma a presença dela."""
    from apps.matches.models import Confirmation

    org = OrganizationFactory()
    membership, minha_ficha = _player_membership(org)
    vitima = PlayerFactory(organization=org, name="Outro")
    match = MatchFactory(organization=org, max_players=20, min_players=2)

    client_for(membership.user, org).post(
        f"/api/matches/{match.id}/confirm-me/",
        {"status": "confirmed", "player": vitima.id},
        format="json",
    )

    assert Confirmation.objects.filter(match=match, player=minha_ficha).exists()
    assert not Confirmation.objects.filter(match=match, player=vitima).exists()


@pytest.mark.django_db
def test_a_player_without_a_linked_profile_gets_a_clear_error():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    match = MatchFactory(organization=org, max_players=20, min_players=2)

    response = client_for(membership.user, org).post(
        f"/api/matches/{match.id}/confirm-me/", {"status": "confirmed"}, format="json"
    )

    assert response.status_code == 400
    assert "não está vinculado" in str(response.json())


@pytest.mark.django_db
def test_self_service_never_leaks_another_organization():
    """O mesmo login, duas peladas: em cada uma ele vê só as partidas de lá."""
    arena = OrganizationFactory()
    liga = OrganizationFactory()
    membership, _ = _player_membership(arena)
    joao = membership.user
    MembershipFactory(user=joao, organization=liga, role=ROLE_JOGADOR)
    PlayerFactory(organization=liga, user=joao, name="Eu")

    da_arena = MatchFactory(organization=arena, max_players=20, min_players=2)
    da_liga = MatchFactory(organization=liga, max_players=20, min_players=2)

    assert [m["id"] for m in client_for(joao, arena).get("/api/matches/mine/").json()] == [da_arena.id]
    assert [m["id"] for m in client_for(joao, liga).get("/api/matches/mine/").json()] == [da_liga.id]


@pytest.mark.django_db
def test_player_still_cannot_confirm_someone_else_through_the_admin_route():
    org = OrganizationFactory()
    membership, _ = _player_membership(org)
    vitima = PlayerFactory(organization=org, name="Outro")
    match = MatchFactory(organization=org, max_players=20, min_players=2)

    response = client_for(membership.user, org).post(
        f"/api/matches/{match.id}/set-confirmation/",
        {"player": vitima.id, "status": "confirmed"},
        format="json",
    )

    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Vincular ficha de jogador a um login
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_manager_links_a_player_profile_to_a_login():
    """Sem esta vinculação o perfil Jogador não tem o que mostrar — é ela que
    faz "Minhas Partidas" e "Minhas Mensalidades" encontrarem a ficha certa."""
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    jogador = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    ficha = PlayerFactory(organization=org, name="Aderval")

    response = client_for(gerente.user, org).patch(
        f"/api/players/{ficha.id}/", {"user": jogador.user.id}, format="json"
    )

    assert response.status_code == 200, response.json()
    assert response.json()["user_name"] == jogador.user.username
    ficha.refresh_from_db()
    assert ficha.user_id == jogador.user.id

    # E agora o jogador enxerga a si mesmo.
    minhas = client_for(jogador.user, org).get("/api/matches/mine/").json()
    assert all(m["my_player_id"] == ficha.id for m in minhas)


@pytest.mark.django_db
def test_a_login_cannot_hold_two_profiles_in_the_same_organization():
    """Duas fichas para o mesmo login fariam `_my_player()` escolher uma por
    ordem de id — o jogador confirmaria presença como outra pessoa."""
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    jogador = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    PlayerFactory(organization=org, user=jogador.user, name="Primeira")
    outra_ficha = PlayerFactory(organization=org, name="Segunda")

    response = client_for(gerente.user, org).patch(
        f"/api/players/{outra_ficha.id}/", {"user": jogador.user.id}, format="json"
    )

    assert response.status_code == 400
    assert "já está vinculado a Primeira" in str(response.json())


@pytest.mark.django_db
def test_cannot_link_a_user_from_another_organization():
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    forasteiro = MembershipFactory(role=ROLE_JOGADOR)  # membro de outra org
    ficha = PlayerFactory(organization=org)

    response = client_for(gerente.user, org).patch(
        f"/api/players/{ficha.id}/", {"user": forasteiro.user.id}, format="json"
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_linkable_users_shows_who_is_free_and_who_is_taken():
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    ocupado = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    MembershipFactory(organization=org, role=ROLE_JOGADOR)  # livre
    PlayerFactory(organization=org, user=ocupado.user, name="Aderval")

    payload = client_for(gerente.user, org).get("/api/players/linkable-users/").json()

    por_usuario = {item["username"]: item for item in payload}
    assert por_usuario[ocupado.user.username]["linked_player_name"] == "Aderval"
    assert por_usuario[gerente.user.username]["linked_player_name"] is None
    assert por_usuario[gerente.user.username]["role"] == ROLE_ORGANIZADOR


@pytest.mark.django_db
def test_a_player_cannot_link_profiles_themselves():
    org = OrganizationFactory()
    jogador = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    ficha = PlayerFactory(organization=org)

    client = client_for(jogador.user, org)
    assert client.get("/api/players/linkable-users/").status_code == 403
    assert client.patch(
        f"/api/players/{ficha.id}/", {"user": jogador.user.id}, format="json"
    ).status_code == 403


# ---------------------------------------------------------------------------
# Gerente administrando a própria organização
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_manager_adds_an_existing_user_to_the_organization():
    """O e-mail é a chave: se já existe login com ele, o vínculo aponta para
    esse login — a mesma pessoa não vira dois cadastros."""
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    ja_existe = MembershipFactory(role=ROLE_JOGADOR).user  # membro de outra org

    response = client_for(gerente.user, org).post(
        "/api/auth/members/",
        {"email": ja_existe.email, "role": ROLE_JOGADOR},
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert Membership.objects.filter(organization=org, user=ja_existe).exists()
    assert User.objects.filter(email__iexact=ja_existe.email).count() == 1


@pytest.mark.django_db
def test_manager_creates_a_new_access_when_the_email_is_unknown():
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    response = client_for(gerente.user, org).post(
        "/api/auth/members/",
        {"email": "novato@pelada.com", "password": "senha-forte-123", "role": ROLE_JOGADOR},
        format="json",
    )

    assert response.status_code == 201, response.json()
    novo = User.objects.get(email="novato@pelada.com")
    assert novo.check_password("senha-forte-123")
    assert not novo.is_superadmin  # nunca nasce com poder de sistema


@pytest.mark.django_db
def test_adding_an_unknown_email_without_a_password_is_refused():
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    response = client_for(gerente.user, org).post(
        "/api/auth/members/", {"email": "ninguem@pelada.com", "role": ROLE_JOGADOR}, format="json"
    )

    assert response.status_code == 400
    assert "senha inicial" in str(response.json())


@pytest.mark.django_db
def test_manager_only_ever_sees_and_touches_their_own_organization():
    org = OrganizationFactory()
    outra = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    alheio = MembershipFactory(organization=outra, role=ROLE_JOGADOR)

    client = client_for(gerente.user, org)
    listados = client.get("/api/auth/members/").json()["results"]

    assert {m["id"] for m in listados} == {gerente.id}
    assert client.patch(
        f"/api/auth/members/{alheio.id}/", {"role": ROLE_ADMIN}, format="json"
    ).status_code == 404


@pytest.mark.django_db
def test_manager_changes_a_role_and_it_is_audited():
    from apps.audit.models import AuditLog

    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    jogador = MembershipFactory(organization=org, role=ROLE_JOGADOR)

    response = client_for(gerente.user, org).patch(
        f"/api/auth/members/{jogador.id}/", {"role": ROLE_VISUALIZADOR}, format="json"
    )

    assert response.status_code == 200
    jogador.refresh_from_db()
    assert jogador.role == ROLE_VISUALIZADOR
    log = AuditLog.objects.filter(action=AuditLog.Action.MEMBERSHIP_CHANGED).latest("created_at")
    assert log.before["role"] == ROLE_JOGADOR
    assert log.after["role"] == ROLE_VISUALIZADOR


@pytest.mark.django_db
def test_the_last_manager_cannot_demote_or_remove_themselves():
    """Sem esta trava, o gerente rebaixava a si mesmo e trancava todo mundo
    para fora da gestão da própria pelada."""
    org = OrganizationFactory()
    sozinho = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    MembershipFactory(organization=org, role=ROLE_JOGADOR)
    client = client_for(sozinho.user, org)

    rebaixar = client.patch(
        f"/api/auth/members/{sozinho.id}/", {"role": ROLE_JOGADOR}, format="json"
    )
    remover = client.delete(f"/api/auth/members/{sozinho.id}/")

    assert rebaixar.status_code == 400
    assert "última pessoa com perfil de Gerente" in str(rebaixar.json())
    assert remover.status_code == 400
    sozinho.refresh_from_db()
    assert sozinho.role == ROLE_ORGANIZADOR


@pytest.mark.django_db
def test_a_second_manager_releases_the_lock():
    org = OrganizationFactory()
    primeiro = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    MembershipFactory(organization=org, role=ROLE_ADMIN)  # outro gerente

    response = client_for(primeiro.user, org).patch(
        f"/api/auth/members/{primeiro.id}/", {"role": ROLE_JOGADOR}, format="json"
    )

    assert response.status_code == 200


@pytest.mark.django_db
def test_removing_a_member_deactivates_instead_of_deleting():
    """O histórico da pessoa (confirmações, sorteios, mensalidades) fica, e o
    login dela continua valendo nas outras organizações."""
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    jogador = MembershipFactory(organization=org, role=ROLE_JOGADOR)

    response = client_for(gerente.user, org).delete(f"/api/auth/members/{jogador.id}/")

    assert response.status_code == 200
    jogador.refresh_from_db()
    assert jogador.is_active is False
    assert User.objects.filter(id=jogador.user_id).exists()
    # E o vínculo desativado barra o acesso.
    assert client_for(jogador.user, org).get("/api/matches/mine/").status_code == 403


@pytest.mark.django_db
def test_a_player_cannot_manage_members():
    org = OrganizationFactory()
    jogador = MembershipFactory(organization=org, role=ROLE_JOGADOR)

    client = client_for(jogador.user, org)
    assert client.get("/api/auth/members/").status_code == 403
    assert client.post(
        "/api/auth/members/", {"email": "x@y.com", "role": ROLE_ADMIN}, format="json"
    ).status_code == 403


@pytest.mark.django_db
def test_member_list_shows_who_already_has_a_player_profile():
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    jogador = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    PlayerFactory(organization=org, user=jogador.user, name="Aderval")

    listados = client_for(gerente.user, org).get("/api/auth/members/").json()["results"]

    por_id = {m["id"]: m for m in listados}
    assert por_id[jogador.id]["linked_player_name"] == "Aderval"
    assert por_id[gerente.id]["linked_player_name"] is None
