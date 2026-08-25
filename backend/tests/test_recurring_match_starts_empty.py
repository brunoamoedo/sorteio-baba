"""Cada ocorrência de um jogo recorrente tem confirmações próprias.

`Confirmation` é por partida, e `ensure_next_match` cria a ocorrência seguinte
sem tocar nas confirmações da anterior — hoje isso está correto **por
construção**, não por uma regra escrita em algum lugar.

Estes testes existem justamente por isso: o comportamento certo não tem defesa
nenhuma contra alguém que amanhã ache útil "já deixar confirmado quem sempre
vai". Copiar confirmações significaria contar como presente quem não disse que
vai — e sortear um time com ele.

Ver `docs/REGRAS_DE_NEGOCIO.md` §5 e o plano em
`docs/PLANO_IMPLEMENTACAO_FINANCEIRO_CONFIRMACOES.md` §12.5.
"""

import datetime

import pytest

from apps.matches.models import Confirmation, Match
from apps.matches.services import (
    confirmed_confirmations,
    count_confirmed,
    ensure_next_match,
    set_confirmation,
)

from .factories import (
    MatchFactory,
    PlayerFactory,
    PositionFactory,
    RecurringGameFactory,
)


def _jogo_semanal(**kwargs):
    """Um jogo recorrente cuja próxima ocorrência cai daqui a poucos dias."""
    hoje = datetime.date.today()
    return RecurringGameFactory(weekday=hoje.weekday(), **kwargs)


def _elenco(organization, quantos: int) -> list:
    position = PositionFactory(organization=organization)
    return [
        PlayerFactory(organization=organization, name=f"Jogador {i}", primary_position=position)
        for i in range(quantos)
    ]


@pytest.fixture
def partida_realizada(db):
    """Uma ocorrência **passada**, sorteada, com 4 confirmados.

    A data no passado é o que faz `ensure_next_match` calcular a ocorrência
    seguinte em vez de devolver esta — que é exatamente o cenário do requisito:
    "a partida aconteceu, e agora vem a próxima"."""
    jogo = _jogo_semanal()
    org = jogo.organization
    anterior = MatchFactory(
        organization=org,
        recurring_game=jogo,
        scheduled_date=datetime.date.today() - datetime.timedelta(days=7),
        scheduled_time=jogo.match_time,
        status=Match.Status.COMPLETED,
    )
    for player in _elenco(org, 4):
        set_confirmation(match=anterior, player=player, status=Confirmation.Status.CONFIRMED)
    return jogo, anterior


@pytest.mark.django_db
def test_nova_ocorrencia_nasce_com_zero_confirmados(partida_realizada):
    jogo, anterior = partida_realizada
    assert count_confirmed(anterior) == 4

    nova = ensure_next_match(jogo, force=True)

    assert nova is not None
    assert nova.id != anterior.id
    assert count_confirmed(nova) == 0


@pytest.mark.django_db
def test_nova_ocorrencia_nasce_sem_nenhuma_linha_de_confirmacao(partida_realizada):
    """Zero **confirmados** não bastaria: quatro linhas `pending` copiadas já
    seriam estado da partida anterior vazando para a nova."""
    jogo, _ = partida_realizada

    nova = ensure_next_match(jogo, force=True)

    assert Confirmation.objects.filter(match=nova).count() == 0
    assert list(confirmed_confirmations(nova)) == []


@pytest.mark.django_db
def test_a_partida_anterior_fica_intacta(partida_realizada):
    jogo, anterior = partida_realizada

    ensure_next_match(jogo, force=True)

    anterior.refresh_from_db()
    assert count_confirmed(anterior) == 4
    assert anterior.status == Match.Status.COMPLETED


@pytest.mark.django_db
def test_confirmar_na_nova_nao_afeta_a_anterior(partida_realizada):
    jogo, anterior = partida_realizada
    nova = ensure_next_match(jogo, force=True)
    novato = _elenco(jogo.organization, 1)[0]

    set_confirmation(match=nova, player=novato, status=Confirmation.Status.CONFIRMED)

    assert count_confirmed(nova) == 1
    assert count_confirmed(anterior) == 4


@pytest.mark.django_db
def test_o_mesmo_jogador_confirma_de_novo_na_nova_ocorrencia(partida_realizada):
    """A constraint é `(match, player)`, não `(recurring_game, player)`: quem
    jogou semana passada precisa poder confirmar de novo esta semana."""
    jogo, anterior = partida_realizada
    veterano = confirmed_confirmations(anterior).first().player
    nova = ensure_next_match(jogo, force=True)

    set_confirmation(match=nova, player=veterano, status=Confirmation.Status.CONFIRMED)

    assert count_confirmed(nova) == 1
    assert count_confirmed(anterior) == 4


@pytest.mark.django_db
def test_geracao_automatica_tambem_nasce_zerada(partida_realizada):
    """O caminho da task periódica (`force=False`) segue a mesma regra — não é
    privilégio do botão."""
    jogo, anterior = partida_realizada

    nova = ensure_next_match(jogo)

    assert nova is not None
    assert nova.id != anterior.id
    assert count_confirmed(nova) == 0


@pytest.mark.django_db
def test_gerar_duas_vezes_nao_cria_duplicata(partida_realizada):
    """Idempotência: a segunda chamada devolve **a mesma** partida, não uma
    terceira ocorrência com o mesmo dia."""
    jogo, _ = partida_realizada

    primeira = ensure_next_match(jogo, force=True)
    segunda = ensure_next_match(jogo, force=True)

    assert primeira.id == segunda.id


@pytest.mark.django_db
def test_reabrir_ocorrencia_removida_preserva_as_confirmacoes():
    """A exceção documentada, e o motivo de ela não contradizer a regra.

    Reabrir uma partida removida por engano é **desfazer uma remoção** — o
    registro é o mesmo (mesmo id), e ressuscitá-lo vazio faria o organizador
    perder as confirmações que já tinha. Não é "a próxima ocorrência".

    Ver `apps/matches/services.py:157`.
    """
    jogo = _jogo_semanal()
    futura = ensure_next_match(jogo, force=True)
    for player in _elenco(jogo.organization, 3):
        set_confirmation(match=futura, player=player, status=Confirmation.Status.CONFIRMED)

    futura.is_deleted = True
    futura.save(update_fields=["is_deleted"])

    reaberta = ensure_next_match(jogo, force=True)

    assert reaberta.id == futura.id
    assert count_confirmed(reaberta) == 3
