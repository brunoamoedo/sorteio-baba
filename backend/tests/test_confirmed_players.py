"""O jogador vê quem confirmou.

Até aqui ele via só o número — "18 de 18 confirmados" — e precisava perguntar
no grupo quem eram. A lista existe agora, mas com um limite que estes testes
protegem: ela mostra **nomes**, não o cadastro.

O `roster` do organizador devolve `PlayerSerializer` inteiro (telefone, nível
técnico, observações). Liberá-lo para o jogador seria abrir a ficha de todo
mundo para conseguir mostrar uma lista de presença. Por isso a rota nova é
outra, com serializer próprio — e o `roster` continua exigindo gestão.
"""

import pytest
from rest_framework.test import APIClient

from apps.matches.models import Confirmation, Match
from apps.matches.services import set_confirmation
from apps.players.models import Player
from common.permissions import ROLE_JOGADOR, ROLE_VISUALIZADOR

from .factories import (
    MatchFactory,
    MembershipFactory,
    PlayerFactory,
    PositionFactory,
    UserFactory,
)


@pytest.fixture
def partida(db):
    membership = MembershipFactory()
    org = membership.organization
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=10)
    position = PositionFactory(organization=org)
    players = [
        PlayerFactory(organization=org, name=nome, primary_position=position)
        for nome in ("Ana", "Bruno", "Carla")
    ]
    return org, match, players, membership.user


def cliente(user, org):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_ORGANIZATION_ID=str(org.id))
    return client


def jogador_de(org, username="so_joga"):
    """Um login com papel de jogador — quem a rota existe para atender."""
    user = UserFactory(username=username)
    MembershipFactory(user=user, organization=org, role=ROLE_JOGADOR)
    return user


@pytest.mark.django_db
def test_jogador_ve_quem_confirmou(partida):
    org, match, players, _ = partida
    for player in players[:2]:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    resposta = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/confirmed/")

    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["confirmed_count"] == 2
    assert [linha["name"] for linha in dados["confirmed"]] == ["Ana", "Bruno"]


@pytest.mark.django_db
def test_nao_expoe_o_cadastro(partida):
    """O limite da rota: nomes, não fichas."""
    org, match, players, _ = partida
    players[0].phone = "(11) 91234-5678"
    players[0].skill_level = 5
    players[0].notes = "só joga de canhota"
    players[0].save()
    set_confirmation(match=match, player=players[0], status=Confirmation.Status.CONFIRMED)

    resposta = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/confirmed/")

    linha = resposta.json()["confirmed"][0]
    assert set(linha) == {"id", "name", "nickname", "confirmed_at"}
    corpo = resposta.content.decode()
    assert "91234" not in corpo
    assert "canhota" not in corpo


@pytest.mark.django_db
def test_o_roster_continua_fechado_para_o_jogador(partida):
    """A rota nova não afrouxou a antiga."""
    org, match, _, _ = partida

    resposta = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/roster/")

    assert resposta.status_code == 403


@pytest.mark.django_db
def test_partida_sem_ninguem_devolve_lista_vazia(partida):
    """O estado que a tela precisa distinguir de "ainda carregando"."""
    org, match, _, _ = partida

    resposta = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/confirmed/")

    assert resposta.json()["confirmed"] == []
    assert resposta.json()["confirmed_count"] == 0


@pytest.mark.django_db
def test_traz_a_capacidade(partida):
    """"8 de 10 confirmados" precisa dos dois números."""
    org, match, players, _ = partida
    set_confirmation(match=match, player=players[0], status=Confirmation.Status.CONFIRMED)

    dados = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/confirmed/").json()

    assert dados["max_players"] == match.capacity.max_players
    assert dados["min_players"] == match.capacity.min_players


@pytest.mark.django_db
def test_quem_recusou_nao_aparece(partida):
    org, match, players, _ = partida
    set_confirmation(match=match, player=players[0], status=Confirmation.Status.CONFIRMED)
    set_confirmation(match=match, player=players[1], status=Confirmation.Status.DECLINED)

    dados = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/confirmed/").json()

    assert [linha["name"] for linha in dados["confirmed"]] == ["Ana"]


@pytest.mark.django_db
def test_jogador_inativo_nao_aparece(partida):
    """Mesma fonte do contador e do sorteio — se divergisse, a tela mostraria
    oito nomes com o contador dizendo nove."""
    org, match, players, _ = partida
    for player in players[:2]:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
    players[0].status = Player.Status.INATIVO
    players[0].save(update_fields=["status"])

    dados = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/confirmed/").json()

    assert dados["confirmed_count"] == 1
    assert [linha["name"] for linha in dados["confirmed"]] == ["Bruno"]


@pytest.mark.django_db
def test_gerente_e_visualizador_tambem_acessam(partida):
    org, match, players, gestor = partida
    set_confirmation(match=match, player=players[0], status=Confirmation.Status.CONFIRMED)
    espectador = UserFactory(username="so_olha")
    MembershipFactory(user=espectador, organization=org, role=ROLE_VISUALIZADOR)

    assert cliente(gestor, org).get(f"/api/matches/{match.id}/confirmed/").status_code == 200
    assert cliente(espectador, org).get(f"/api/matches/{match.id}/confirmed/").status_code == 200


@pytest.mark.django_db
def test_nao_alcanca_partida_de_outra_organizacao(partida):
    org, _, _, _ = partida
    alheia = MatchFactory(organization=MembershipFactory().organization)

    resposta = cliente(jogador_de(org), org).get(f"/api/matches/{alheia.id}/confirmed/")

    assert resposta.status_code == 404


@pytest.mark.django_db
def test_sem_vinculo_na_organizacao_nao_acessa(partida):
    org, match, _, _ = partida
    de_fora = MembershipFactory()

    resposta = cliente(de_fora.user, org).get(f"/api/matches/{match.id}/confirmed/")

    assert resposta.status_code in (403, 404)


@pytest.mark.django_db
def test_a_ordem_e_a_de_confirmacao(partida):
    """Quem confirmou primeiro aparece primeiro — é a ordem que decide a fila
    de espera, e a tela não pode contar outra história."""
    org, match, players, _ = partida
    for player in reversed(players):
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    dados = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/confirmed/").json()

    assert [linha["name"] for linha in dados["confirmed"]] == ["Carla", "Bruno", "Ana"]


@pytest.mark.django_db
def test_partida_encerrada_ainda_mostra_quem_jogou(partida):
    org, match, players, _ = partida
    set_confirmation(match=match, player=players[0], status=Confirmation.Status.CONFIRMED)
    match.status = Match.Status.COMPLETED
    match.save(update_fields=["status"])

    dados = cliente(jogador_de(org), org).get(f"/api/matches/{match.id}/confirmed/").json()

    assert dados["confirmed_count"] == 1
