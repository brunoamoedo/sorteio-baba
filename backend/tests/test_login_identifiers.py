"""Login por usuário, telefone ou e-mail.

O jogador não escolheu o próprio `username` e não lembra dele. Estes testes
cobrem os identificadores que ele reconhece — e, principalmente, garantem que
aceitar mais identificadores **não** afrouxou a autenticação nem transformou o
login num verificador de quem está cadastrado na pelada.
"""

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.players.models import normalize_phone

from .factories import PlayerFactory, UserFactory

SENHA = "senha-forte-123"


@pytest.fixture(autouse=True)
def sem_throttle_residual():
    """O throttle de login é por minuto e por IP, e o contador vive no cache —
    que não é revertido junto com o banco entre os testes. Sem isto, um arquivo
    com muitas tentativas de login começa a receber 429 no meio."""
    cache.clear()
    yield
    cache.clear()


def autenticar(identificador: str, senha: str = SENHA):
    return APIClient().post(
        "/api/auth/token/",
        {"username": identificador, "password": senha},
        format="json",
    )


@pytest.fixture
def jogador():
    """Uma ficha com telefone, vinculada a um login."""
    user = UserFactory(username="aderval_2481", email="aderval@example.com")
    PlayerFactory(name="Aderval", phone="(11) 92824-1409", user=user)
    return user


@pytest.mark.django_db
@pytest.mark.parametrize(
    "digitado",
    [
        "11928241409",
        "(11) 92824-1409",
        "11 92824 1409",
        "+55 11 92824-1409",
        "5511928241409",
    ],
)
def test_entra_com_o_telefone_em_qualquer_formato(jogador, digitado):
    assert autenticar(digitado).status_code == 200


@pytest.mark.django_db
def test_entra_com_o_email(jogador):
    assert autenticar("aderval@example.com").status_code == 200


@pytest.mark.django_db
def test_email_ignora_maiusculas(jogador):
    assert autenticar("Aderval@Example.com").status_code == 200


@pytest.mark.django_db
def test_o_usuario_continua_funcionando(jogador):
    assert autenticar("aderval_2481").status_code == 200


@pytest.mark.django_db
def test_a_senha_continua_obrigatoria(jogador):
    """O identificador mudou; a prova de identidade, não."""
    assert autenticar("11928241409", senha="senha-errada").status_code == 401
    assert autenticar("aderval@example.com", senha="senha-errada").status_code == 401


@pytest.mark.django_db
def test_telefone_de_ficha_sem_login_nao_entra():
    """Uma ficha sem `user` é um cadastro, não uma conta."""
    PlayerFactory(name="Sem Conta", phone="(11) 90000-0001")

    assert autenticar("11900000001").status_code == 401


@pytest.mark.django_db
def test_telefone_de_ficha_removida_nao_entra(jogador):
    """A remoção é lógica; se o telefone continuasse valendo, desligar alguém
    da pelada não tiraria o acesso dele."""
    from apps.players.models import Player

    ficha = Player.objects.get(name="Aderval")
    ficha.is_deleted = True
    ficha.save(update_fields=["is_deleted"])

    assert autenticar("11928241409").status_code == 401
    # O login continua válido pelos outros identificadores: quem foi removido de
    # uma pelada pode ainda participar de outra.
    assert autenticar("aderval_2481").status_code == 200


@pytest.mark.django_db
def test_mesmo_telefone_em_organizacoes_diferentes_entra(jogador):
    """A mesma pessoa com ficha em duas peladas — o telefone leva ao mesmo
    login, então não há ambiguidade."""
    PlayerFactory(name="Aderval", phone="(11) 92824-1409", user=jogador)

    assert autenticar("11928241409").status_code == 200


@pytest.mark.django_db
def test_telefone_que_leva_a_dois_logins_e_recusado(jogador):
    """Escolher um dos dois seria entregar a conta errada."""
    outro = UserFactory(username="outro_dono")
    PlayerFactory(name="Homônimo", phone="(11) 92824-1409", user=outro)

    assert autenticar("11928241409").status_code == 401


@pytest.mark.django_db
def test_e_impossivel_dois_logins_com_o_mesmo_email():
    """É o que dispensa o tratamento de ambiguidade que o telefone precisa.
    Se esta garantia cair, `resolve_username_from_email` passa a poder entregar
    a conta errada — e este teste avisa antes."""
    from django.db import IntegrityError

    UserFactory(username="conta_a", email="familia@example.com")

    with pytest.raises(IntegrityError):
        UserFactory(username="conta_b", email="familia@example.com")


@pytest.mark.django_db
def test_identificador_desconhecido_e_recusado(jogador):
    assert autenticar("11999999999").status_code == 401
    assert autenticar("ninguem@example.com").status_code == 401


@pytest.mark.django_db
def test_a_recusa_nao_revela_quem_existe(jogador):
    """Respostas diferentes para "não existe" e "existe, senha errada"
    transformariam o login num verificador de quem está na pelada."""
    existe = autenticar("11928241409", senha="senha-errada")
    nao_existe = autenticar("11999999999", senha="senha-errada")

    assert existe.status_code == nao_existe.status_code == 401
    assert existe.json() == nao_existe.json()


@pytest.mark.django_db
def test_username_so_de_digitos_nao_e_confundido_com_telefone():
    """Um `username` numérico continua entrando por ele mesmo."""
    UserFactory(username="12345678901", email="numerico@example.com")

    assert autenticar("12345678901").status_code == 200


@pytest.mark.django_db
def test_usuario_inativo_continua_barrado(jogador):
    jogador.is_active = False
    jogador.save(update_fields=["is_active"])

    assert autenticar("11928241409").status_code == 401


class TestNormalizacao:
    """`normalize_phone` é o que torna comparável o digitado com o gravado."""

    @pytest.mark.parametrize(
        "entrada",
        ["11928241409", "(11) 92824-1409", "11 92824 1409", "+55 11 92824-1409", "55 11 92824-1409"],
    )
    def test_formas_do_mesmo_numero_convergem(self, entrada):
        assert normalize_phone(entrada) == "11928241409"

    def test_vazio_e_nulo_viram_string_vazia(self):
        assert normalize_phone("") == ""
        assert normalize_phone(None) == ""

    def test_numero_curto_iniciado_em_55_e_preservado(self):
        """Um fixo de Caxias do Sul (DDD 54) não perde o DDD por começar com
        5 e 5 — o corte do prefixo do país só vale para número completo."""
        assert normalize_phone("5533334444") == "5533334444"
