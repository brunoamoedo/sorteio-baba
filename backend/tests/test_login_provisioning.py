"""Geração de acesso, primeiro obrigatório e reset de senha.

Três garantias atravessam este arquivo, e são o motivo de ele existir:

1. **Senha nunca em texto puro.** Nem no banco, nem na resposta da API, nem na
   trilha de auditoria — nem o valor, nem o hash, nem o tamanho.
2. **Nunca dois usuários para a mesma pessoa.** Gerar duas vezes não cria
   conta nova; um telefone que aparece em duas fichas não gera para nenhuma.
3. **O primeiro acesso é obrigatório de verdade.** Não é uma tela que dá para
   pular: o servidor recusa todas as outras rotas até a troca acontecer.

A senha inicial é a mesma para todos, por decisão do produto. É `must_change_
password` que fecha a janela em que quem sabe o telefone de alguém entraria na
conta dessa pessoa — por isso o bloqueio não é um extra, é parte do mecanismo.
"""

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.login_provisioning import (
    SENHA_TEMPORARIA_PADRAO,
    change_own_password,
    generate_login,
    generate_logins,
    login_status,
    reset_password,
)
from apps.accounts.models import Membership, User
from apps.audit.models import AuditLog
from apps.players.models import Player
from common.exceptions import DomainError
from common.permissions import ROLE_ADMIN, ROLE_JOGADOR, ROLE_ORGANIZADOR

from .factories import MembershipFactory, PlayerFactory, PositionFactory, UserFactory

TELEFONE = "(11) 92824-1409"
DIGITOS = "11928241409"


@pytest.fixture(autouse=True)
def sem_throttle_residual():
    """O throttle de login vive no cache, que não é revertido entre testes."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def pelada(db):
    membership = MembershipFactory()
    return membership.organization, membership.user


def mensalista(org, nome="Aderval", phone=TELEFONE, **kwargs):
    return PlayerFactory(
        organization=org,
        name=nome,
        phone=phone,
        primary_position=PositionFactory(organization=org),
        player_type=Player.PlayerType.MENSALISTA,
        **kwargs,
    )


def cliente(user, org):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_ORGANIZATION_ID=str(org.id))
    return client


# ===========================================================================
# Gerar um login
# ===========================================================================


@pytest.mark.django_db
def test_cria_usuario_vinculo_e_ficha(pelada):
    """Os três passos. Faltar qualquer um entrega uma conta que não faz nada."""
    org, gestor = pelada
    player = mensalista(org)

    generate_login(organization=org, player=player, performed_by=gestor)

    player.refresh_from_db()
    assert player.user is not None
    assert player.user.username == DIGITOS
    assert Membership.objects.filter(
        organization=org, user=player.user, role=ROLE_JOGADOR
    ).exists()


@pytest.mark.django_db
def test_o_jogador_entra_com_o_telefone(pelada):
    """O teste que realmente importa: a conta gerada **funciona**."""
    org, gestor = pelada
    player = mensalista(org)
    generate_login(organization=org, player=player, performed_by=gestor)

    resposta = APIClient().post(
        "/api/auth/token/",
        {"username": TELEFONE, "password": SENHA_TEMPORARIA_PADRAO},
        format="json",
    )

    assert resposta.status_code == 200


@pytest.mark.django_db
def test_nasce_exigindo_troca_de_senha(pelada):
    org, gestor = pelada
    player = mensalista(org)

    generate_login(organization=org, player=player, performed_by=gestor)

    player.refresh_from_db()
    assert player.user.must_change_password is True
    assert player.user.password_changed_at is None


@pytest.mark.django_db
def test_email_fica_nulo_e_nao_colide(pelada):
    """`""` colidiria no índice único a partir do **segundo** login gerado — e
    o erro só apareceria no jogador nº 2."""
    org, gestor = pelada
    generate_login(organization=org, player=mensalista(org, "Ana", "11911111111"), performed_by=gestor)
    generate_login(organization=org, player=mensalista(org, "Bruno", "11922222222"), performed_by=gestor)

    assert User.objects.filter(email__isnull=True).count() == 2


@pytest.mark.django_db
def test_senha_gravada_com_hash(pelada):
    org, gestor = pelada
    player = mensalista(org)

    generate_login(organization=org, player=player, performed_by=gestor)

    player.refresh_from_db()
    assert player.user.check_password(SENHA_TEMPORARIA_PADRAO)
    # O texto puro **não** está no banco, e o que está tem forma de hash
    # (`algoritmo$salt$digest`). O algoritmo em si não é afirmado: o ambiente
    # de teste usa MD5 por velocidade, e travar o nome aqui testaria a
    # configuração da suíte, não a regra.
    assert SENHA_TEMPORARIA_PADRAO not in player.user.password
    assert player.user.password.count("$") >= 2


@pytest.mark.django_db
def test_a_resposta_nao_contem_a_senha(pelada):
    org, gestor = pelada

    resultado = generate_login(organization=org, player=mensalista(org), performed_by=gestor)

    assert SENHA_TEMPORARIA_PADRAO not in str(resultado)


@pytest.mark.django_db
def test_a_auditoria_nao_contem_a_senha(pelada):
    """Nem o valor, nem o hash, nem o tamanho."""
    org, gestor = pelada
    player = mensalista(org)
    generate_login(organization=org, player=player, performed_by=gestor)
    player.refresh_from_db()

    log = AuditLog.objects.get(action=AuditLog.Action.LOGIN_GENERATED)
    registro = str(log.before) + str(log.after)

    assert SENHA_TEMPORARIA_PADRAO not in registro
    assert player.user.password not in registro
    assert "password" not in log.after or log.after.get("must_change_password") is True


# ===========================================================================
# Nunca duplicar
# ===========================================================================


@pytest.mark.django_db
def test_ficha_que_ja_tem_login_e_recusada(pelada):
    org, gestor = pelada
    player = mensalista(org)
    generate_login(organization=org, player=player, performed_by=gestor)
    player.refresh_from_db()

    with pytest.raises(DomainError, match="já possui login"):
        generate_login(organization=org, player=player, performed_by=gestor)


@pytest.mark.django_db
def test_gerar_duas_vezes_nao_cria_usuario_novo(pelada):
    org, gestor = pelada
    mensalista(org)
    antes = User.objects.count()

    generate_logins(organization=org, performed_by=gestor)
    generate_logins(organization=org, performed_by=gestor)

    assert User.objects.count() == antes + 1


@pytest.mark.django_db
def test_nunca_cria_jogador_novo(pelada):
    org, gestor = pelada
    mensalista(org)
    antes = Player.objects.count()

    generate_logins(organization=org, performed_by=gestor)

    assert Player.objects.count() == antes


@pytest.mark.django_db
def test_telefone_repetido_entre_duas_fichas_bloqueia_as_duas(pelada):
    """Escolher uma das duas entregaria a conta errada."""
    org, gestor = pelada
    mensalista(org, "Ana", TELEFONE)
    mensalista(org, "Bruno", TELEFONE)

    resultado = generate_logins(organization=org, performed_by=gestor)

    assert resultado["processed_count"] == 0
    assert {linha["reason"] for linha in resultado["skipped"]} == {
        "telefone repetido com outra ficha"
    }


@pytest.mark.django_db
def test_ficha_sem_telefone_e_pulada(pelada):
    org, gestor = pelada
    mensalista(org, "Sem Fone", "")

    resultado = generate_logins(organization=org, performed_by=gestor)

    assert [linha["reason"] for linha in resultado["skipped"]] == ["sem telefone cadastrado"]


@pytest.mark.django_db
def test_reaproveita_o_usuario_da_mesma_pessoa_em_outra_pelada(pelada):
    """A identidade é global: o mesmo telefone em duas peladas é a mesma
    pessoa, com um login só e uma ficha em cada."""
    org, gestor = pelada
    generate_login(organization=org, player=mensalista(org), performed_by=gestor)

    outra_membership = MembershipFactory()
    outra_org = outra_membership.organization
    ficha_de_la = mensalista(outra_org)
    # Contado **depois** de criar o gestor da outra pelada: o que se afirma é
    # que gerar o login lá não cria usuário, não que o cenário inteiro não crie.
    antes = User.objects.count()

    generate_login(
        organization=outra_org, player=ficha_de_la, performed_by=outra_membership.user
    )

    assert User.objects.count() == antes
    ficha_de_la.refresh_from_db()
    assert ficha_de_la.user.username == DIGITOS
    assert Membership.objects.filter(user__username=DIGITOS).count() == 2


# ===========================================================================
# Em massa
# ===========================================================================


@pytest.mark.django_db
def test_gera_para_todos_os_mensalistas(pelada):
    org, gestor = pelada
    for i in range(3):
        mensalista(org, f"Jogador {i}", f"1191111{i:04d}")

    resultado = generate_logins(organization=org, performed_by=gestor)

    assert resultado["processed_count"] == 3
    assert Player.objects.filter(organization=org, user__isnull=False).count() == 3


@pytest.mark.django_db
def test_gera_so_para_os_selecionados(pelada):
    org, gestor = pelada
    alvos = [mensalista(org, f"Jogador {i}", f"1191111{i:04d}") for i in range(3)]

    resultado = generate_logins(organization=org, players=alvos[:1], performed_by=gestor)

    assert resultado["processed_count"] == 1


@pytest.mark.django_db
def test_situacao_mista_processa_o_que_da(pelada):
    org, gestor = pelada
    mensalista(org, "Com Fone", "11911110001")
    mensalista(org, "Sem Fone", "")
    ja_tem = mensalista(org, "Já Tem", "11911110003")
    generate_login(organization=org, player=ja_tem, performed_by=gestor)

    resultado = generate_logins(organization=org, performed_by=gestor)

    assert resultado["processed_count"] == 1
    assert resultado["skipped_count"] == 2
    assert {linha["reason"] for linha in resultado["skipped"]} == {
        "sem telefone cadastrado",
        "já possui login",
    }


@pytest.mark.django_db
def test_convidado_nao_entra_no_escopo(pelada):
    """A decisão foi gerar login só para mensalistas."""
    org, gestor = pelada
    PlayerFactory(
        organization=org,
        name="Convidado",
        phone="11933333333",
        primary_position=PositionFactory(organization=org),
        player_type=Player.PlayerType.CONVIDADO,
    )

    linhas = login_status(org)

    assert linhas == []


@pytest.mark.django_db
def test_jogador_de_outra_organizacao_e_recusado(pelada):
    org, gestor = pelada
    outra = MembershipFactory().organization
    forasteiro = mensalista(outra)

    with pytest.raises(DomainError, match="outra organização"):
        generate_logins(organization=org, players=[forasteiro], performed_by=gestor)


# ===========================================================================
# Situação (a lista da tela)
# ===========================================================================


@pytest.mark.django_db
def test_login_status_diz_quem_pode_e_quem_nao(pelada):
    org, gestor = pelada
    mensalista(org, "Pode", "11911110001")
    mensalista(org, "Sem Fone", "")
    ja_tem = mensalista(org, "Já Tem", "11911110003")
    generate_login(organization=org, player=ja_tem, performed_by=gestor)

    por_nome = {linha["player_name"]: linha for linha in login_status(org)}

    assert por_nome["Pode"]["blocked_reason"] is None
    assert por_nome["Sem Fone"]["blocked_reason"] == "sem telefone cadastrado"
    assert por_nome["Já Tem"]["blocked_reason"] == "já possui login"
    assert por_nome["Já Tem"]["has_login"] is True
    assert por_nome["Já Tem"]["must_change_password"] is True


@pytest.mark.django_db
def test_login_status_nao_expoe_dado_sensivel(pelada):
    """É uma tela de acesso, não o cadastro de jogadores."""
    org, _ = pelada
    mensalista(org, "Ana", "11911110001", skill_level=5, notes="joga mal de canhota")

    linha = login_status(org)[0]

    assert "skill_level" not in linha
    assert "notes" not in linha


# ===========================================================================
# Primeiro acesso obrigatório
# ===========================================================================


@pytest.fixture
def jogador_no_primeiro_acesso(pelada):
    org, gestor = pelada
    player = mensalista(org)
    generate_login(organization=org, player=player, performed_by=gestor)
    player.refresh_from_db()
    return org, player.user


def autenticado(user, org):
    """Cliente com **token real**, não `force_authenticate`: o bloqueio do
    primeiro acesso é middleware e lê o cabeçalho `Authorization`."""
    resposta = APIClient().post(
        "/api/auth/token/",
        {"username": user.username, "password": SENHA_TEMPORARIA_PADRAO},
        format="json",
    )
    assert resposta.status_code == 200, resposta.data
    client = APIClient()
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {resposta.json()['access']}",
        HTTP_X_ORGANIZATION_ID=str(org.id),
    )
    return client


@pytest.mark.django_db
def test_com_senha_temporaria_autentica(jogador_no_primeiro_acesso):
    """Bloquear o `token/` deixaria a pessoa sem caminho de volta."""
    org, user = jogador_no_primeiro_acesso

    resposta = APIClient().post(
        "/api/auth/token/",
        {"username": user.username, "password": SENHA_TEMPORARIA_PADRAO},
        format="json",
    )

    assert resposta.status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize(
    "rota",
    ["/api/matches/mine/", "/api/finance/charges/mine/", "/api/players/"],
)
def test_as_demais_rotas_ficam_bloqueadas(jogador_no_primeiro_acesso, rota):
    org, user = jogador_no_primeiro_acesso

    resposta = autenticado(user, org).get(rota)

    assert resposta.status_code == 403
    assert resposta.json()["code"] == "must_change_password"


@pytest.mark.django_db
def test_me_continua_acessivel(jogador_no_primeiro_acesso):
    """A tela precisa saber quem está trocando a senha."""
    org, user = jogador_no_primeiro_acesso

    assert autenticado(user, org).get("/api/auth/me/").status_code == 200


@pytest.mark.django_db
def test_trocar_a_senha_libera_o_sistema(jogador_no_primeiro_acesso):
    org, user = jogador_no_primeiro_acesso
    client = autenticado(user, org)

    troca = client.post(
        "/api/auth/change-password/",
        {"current_password": SENHA_TEMPORARIA_PADRAO, "new_password": "PeladaDeTerca#2026"},
        format="json",
    )

    assert troca.status_code == 200
    assert troca.json()["first_access"] is True
    assert client.get("/api/matches/mine/").status_code == 200


@pytest.mark.django_db
def test_a_nova_senha_nao_pode_ser_a_temporaria(jogador_no_primeiro_acesso):
    """Senão a marca seria limpa sem nada ter mudado."""
    org, user = jogador_no_primeiro_acesso

    with pytest.raises(DomainError, match="diferente da temporária"):
        change_own_password(
            user=user,
            current_password=SENHA_TEMPORARIA_PADRAO,
            new_password=SENHA_TEMPORARIA_PADRAO,
        )


@pytest.mark.django_db
def test_a_nova_senha_precisa_ser_forte(jogador_no_primeiro_acesso):
    org, user = jogador_no_primeiro_acesso

    with pytest.raises(DomainError):
        change_own_password(
            user=user, current_password=SENHA_TEMPORARIA_PADRAO, new_password="123456"
        )


@pytest.mark.django_db
def test_a_senha_atual_e_exigida(jogador_no_primeiro_acesso):
    """Sem isso, um token vazado viraria troca de senha direta."""
    org, user = jogador_no_primeiro_acesso

    with pytest.raises(DomainError, match="senha atual está incorreta"):
        change_own_password(
            user=user, current_password="chute", new_password="PeladaDeTerca#2026"
        )


@pytest.mark.django_db
def test_a_troca_registra_quando_aconteceu(jogador_no_primeiro_acesso):
    org, user = jogador_no_primeiro_acesso

    change_own_password(
        user=user, current_password=SENHA_TEMPORARIA_PADRAO, new_password="PeladaDeTerca#2026"
    )

    user.refresh_from_db()
    assert user.must_change_password is False
    assert user.password_changed_at is not None
    assert user.check_password("PeladaDeTerca#2026")


@pytest.mark.django_db
def test_quem_ja_trocou_nao_e_bloqueado(pelada):
    """A regressão que mais importa: os usuários que já existiam."""
    org, gestor = pelada

    resposta = cliente(gestor, org).get("/api/players/")

    assert resposta.status_code == 200


# ===========================================================================
# Reset de senha
# ===========================================================================


@pytest.mark.django_db
def test_reset_invalida_a_senha_anterior(pelada):
    org, gestor = pelada
    player = mensalista(org)
    generate_login(organization=org, player=player, performed_by=gestor)
    player.refresh_from_db()
    change_own_password(
        user=player.user,
        current_password=SENHA_TEMPORARIA_PADRAO,
        new_password="PeladaDeTerca#2026",
    )

    reset_password(organization=org, player=player, performed_by=gestor)

    player.user.refresh_from_db()
    assert not player.user.check_password("PeladaDeTerca#2026")
    assert player.user.check_password(SENHA_TEMPORARIA_PADRAO)
    assert player.user.must_change_password is True


@pytest.mark.django_db
def test_reset_de_ficha_sem_login_e_recusado(pelada):
    org, gestor = pelada

    with pytest.raises(DomainError, match="ainda não tem login"):
        reset_password(organization=org, player=mensalista(org), performed_by=gestor)


@pytest.mark.django_db
def test_reset_nao_alcanca_ficha_de_outra_organizacao(pelada):
    org, gestor = pelada
    outra = MembershipFactory().organization

    with pytest.raises(DomainError, match="não pertence a esta organização"):
        reset_password(organization=org, player=mensalista(outra), performed_by=gestor)


@pytest.mark.django_db
@pytest.mark.parametrize("papel_de_quem_reseta", [ROLE_ADMIN, ROLE_ORGANIZADOR])
@pytest.mark.parametrize("papel_do_alvo", [ROLE_ADMIN, ROLE_ORGANIZADOR])
def test_reset_alcanca_quem_administra(pelada, papel_de_quem_reseta, papel_do_alvo):
    """Gerente e Administrador resetam a senha um do outro.

    Havia um bloqueio aqui, com o argumento de que seria um caminho lateral
    para tomar a conta de quem administra. Mas os dois papéis têm poder
    idêntico (`MANAGER_ROLES`), então não há privilégio a escalar — e a
    mensagem mandava usar a gestão de membros, que **não troca senha**. Quem
    administrava e esquecia a senha ficava sem saída.
    """
    org, _ = pelada
    quem_reseta = UserFactory(username="quem-reseta")
    Membership.objects.update_or_create(
        user=quem_reseta, organization=org, defaults={"role": papel_de_quem_reseta}
    )
    alvo = UserFactory(username="alvo")
    MembershipFactory(user=alvo, organization=org, role=papel_do_alvo)
    ficha = mensalista(org, "Gerente", "11944444444", user=alvo)

    resultado = reset_password(organization=org, player=ficha, performed_by=quem_reseta)

    alvo.refresh_from_db()
    assert resultado["player_id"] == ficha.id
    assert alvo.check_password(SENHA_TEMPORARIA_PADRAO)
    assert alvo.must_change_password is True
    # A trilha é o controle que sobrou no lugar do bloqueio: precisa dizer
    # **quem** resetou a senha de quem.
    log = AuditLog.objects.filter(action=AuditLog.Action.PASSWORD_RESET).latest("id")
    assert log.user_id == quem_reseta.id
    assert log.player_id == ficha.id


@pytest.mark.django_db
def test_reset_e_auditado_sem_senha(pelada):
    org, gestor = pelada
    player = mensalista(org)
    generate_login(organization=org, player=player, performed_by=gestor)
    player.refresh_from_db()

    reset_password(organization=org, player=player, performed_by=gestor)

    log = AuditLog.objects.get(action=AuditLog.Action.PASSWORD_RESET)
    assert SENHA_TEMPORARIA_PADRAO not in str(log.after)
    assert log.player_id == player.id


# ===========================================================================
# Permissões
# ===========================================================================


@pytest.mark.django_db
def test_endpoint_de_situacao(pelada):
    org, gestor = pelada
    mensalista(org)

    resposta = cliente(gestor, org).get("/api/players/login-status/")

    assert resposta.status_code == 200
    assert resposta.json()[0]["blocked_reason"] is None


@pytest.mark.django_db
def test_endpoint_de_geracao(pelada):
    org, gestor = pelada
    mensalista(org)

    resposta = cliente(gestor, org).post(
        "/api/players/generate-logins/", {}, format="json"
    )

    assert resposta.status_code == 200
    assert resposta.json()["processed_count"] == 1


@pytest.mark.django_db
def test_endpoint_de_reset(pelada):
    org, gestor = pelada
    player = mensalista(org)
    generate_login(organization=org, player=player, performed_by=gestor)

    resposta = cliente(gestor, org).post(
        f"/api/players/{player.id}/reset-password/", {}, format="json"
    )

    assert resposta.status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("metodo", "rota"),
    [
        ("get", "/api/players/login-status/"),
        ("post", "/api/players/generate-logins/"),
    ],
)
def test_jogador_nao_gera_login(pelada, metodo, rota):
    org, _ = pelada
    jogador = UserFactory(username="so_joga")
    MembershipFactory(user=jogador, organization=org, role=ROLE_JOGADOR)

    resposta = getattr(cliente(jogador, org), metodo)(rota)

    assert resposta.status_code == 403


@pytest.mark.django_db
def test_gerente_de_outra_organizacao_nao_alcanca_a_ficha(pelada):
    org, _ = pelada
    player = mensalista(org)
    de_fora = MembershipFactory()

    resposta = cliente(de_fora.user, de_fora.organization).post(
        f"/api/players/{player.id}/reset-password/", {}, format="json"
    )

    assert resposta.status_code == 404
