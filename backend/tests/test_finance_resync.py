"""Ressincronização das mensalidades em aberto.

O elo que faltava entre "quanto o jogador paga" e "quanto está cobrado". A
alteração de valor nunca foi retroativa — o que estava faltando era um caminho
para corrigir a competência **já lançada e ainda em aberto**, que ficava presa
no valor antigo sem nenhum aviso.

O que estes testes protegem, acima de tudo, é o limite: cobrança paga, com baixa
parcial ou cancelada **nunca** é tocada. Se essa linha cair, a ressincronização
deixa de ser "corrigir antes de cobrar" e vira reescrita do passado.
"""

import datetime
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.finance.models import Charge, MembershipFeePlan
from apps.finance.services import (
    register_payment,
    resync_pending_charges,
    resync_preview,
    set_player_fee,
)
from apps.players.models import Player

from .factories import MembershipFactory, PlayerFactory, PositionFactory, UserFactory

REFERENCIA = "2026-08"


@pytest.fixture
def cenario(db):
    """Três mensalistas cobrados a R$ 45,00 numa competência cujo valor
    vigente já subiu para R$ 90,00 — o estado real encontrado no banco."""
    membership = MembershipFactory()
    org = membership.organization
    MembershipFeePlan.objects.create(organization=org, name="Mensalidade", amount=Decimal("90.00"))
    position = PositionFactory(organization=org)

    players, charges = [], []
    for nome in ("Ana", "Bruno", "Carla"):
        player = PlayerFactory(
            organization=org,
            name=nome,
            primary_position=position,
            player_type=Player.PlayerType.MENSALISTA,
        )
        players.append(player)
        charges.append(
            Charge.objects.create(
                organization=org,
                player=player,
                reference=REFERENCIA,
                amount=Decimal("45.00"),
                due_date=datetime.date(2026, 8, 15),
            )
        )
        set_player_fee(
            organization=org,
            player=player,
            amount=Decimal("90.00"),
            effective_from=REFERENCIA,
        )
    return org, players, charges, membership.user


# ---------------------------------------------------------------------------
# Prévia
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_previa_nao_altera_nada(cenario):
    org, _, charges, _ = cenario

    resultado = resync_preview(organization=org, reference=REFERENCIA)

    assert resultado["to_update_count"] == 3
    assert resultado["current_amounts"] == ["45.00"]
    charges[0].refresh_from_db()
    assert charges[0].amount == Decimal("45.00")


@pytest.mark.django_db
def test_previa_e_execucao_enxergam_o_mesmo(cenario):
    """Se divergirem, a tela promete um número e o servidor faz outro."""
    org, _, _, _ = cenario

    previa = resync_preview(organization=org, reference=REFERENCIA)
    execucao = resync_pending_charges(organization=org, reference=REFERENCIA)

    assert previa["to_update_count"] == execucao["updated_count"]
    assert previa["skipped_count"] == execucao["skipped_count"]


# ---------------------------------------------------------------------------
# Execução
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_atualiza_as_pendentes(cenario):
    org, _, charges, _ = cenario

    resultado = resync_pending_charges(organization=org, reference=REFERENCIA)

    assert resultado["updated_count"] == 3
    for charge in charges:
        charge.refresh_from_db()
        assert charge.amount == Decimal("90.00")


@pytest.mark.django_db
def test_pula_a_paga(cenario):
    org, _, charges, user = cenario
    register_payment(charge=charges[0], amount=Decimal("45.00"), registered_by=user)
    charges[0].refresh_from_db()
    assert charges[0].status == Charge.Status.PAID

    resultado = resync_pending_charges(organization=org, reference=REFERENCIA)

    charges[0].refresh_from_db()
    assert charges[0].amount == Decimal("45.00")
    assert resultado["updated_count"] == 2
    assert [linha["reason"] for linha in resultado["skipped"]] == ["já paga"]


@pytest.mark.django_db
def test_pula_a_que_tem_baixa_parcial(cenario):
    """Pendente, mas com dinheiro recebido: mudar o valor reescreveria o saldo
    de uma baixa que já existe."""
    org, _, charges, user = cenario
    register_payment(charge=charges[0], amount=Decimal("20.00"), registered_by=user)
    charges[0].refresh_from_db()
    assert charges[0].status == Charge.Status.PENDING

    resultado = resync_pending_charges(organization=org, reference=REFERENCIA)

    charges[0].refresh_from_db()
    assert charges[0].amount == Decimal("45.00")
    assert [linha["reason"] for linha in resultado["skipped"]] == ["tem baixa parcial lançada"]


@pytest.mark.django_db
def test_pula_a_cancelada(cenario):
    org, _, charges, _ = cenario
    charges[0].status = Charge.Status.CANCELED
    charges[0].save(update_fields=["status"])

    resultado = resync_pending_charges(organization=org, reference=REFERENCIA)

    charges[0].refresh_from_db()
    assert charges[0].amount == Decimal("45.00")
    assert [linha["reason"] for linha in resultado["skipped"]] == ["cancelada"]


@pytest.mark.django_db
def test_baixa_estornada_volta_a_ser_ressincronizavel(cenario):
    """O estorno devolve a cobrança ao estado "ninguém pagou" — e o critério
    é o dinheiro ativo, não o histórico de tentativas."""
    org, _, charges, user = cenario
    payment = register_payment(charge=charges[0], amount=Decimal("45.00"), registered_by=user)
    from apps.finance.services import cancel_payment

    cancel_payment(payment=payment, reason="lançamento errado", cancelled_by=user)

    resultado = resync_pending_charges(organization=org, reference=REFERENCIA)

    charges[0].refresh_from_db()
    assert charges[0].amount == Decimal("90.00")
    assert resultado["updated_count"] == 3


@pytest.mark.django_db
def test_cobranca_ja_correta_nao_conta_como_alterada(cenario):
    """Nem alterada nem pulada: rodar de novo devolve zero, e a tela não
    oferece uma ação que não faria nada."""
    org, _, _, _ = cenario
    resync_pending_charges(organization=org, reference=REFERENCIA)

    segunda = resync_pending_charges(organization=org, reference=REFERENCIA)

    assert segunda["updated_count"] == 0
    assert segunda["skipped_count"] == 0


@pytest.mark.django_db
def test_restringe_a_jogadores_especificos(cenario):
    org, players, charges, _ = cenario

    resultado = resync_pending_charges(
        organization=org, reference=REFERENCIA, players=[players[0]]
    )

    assert resultado["updated_count"] == 1
    charges[0].refresh_from_db()
    charges[1].refresh_from_db()
    assert charges[0].amount == Decimal("90.00")
    assert charges[1].amount == Decimal("45.00")


@pytest.mark.django_db
def test_nao_toca_em_outra_competencia(cenario):
    """A não-retroatividade continua valendo: julho não muda porque agosto
    mudou."""
    org, players, _, _ = cenario
    julho = Charge.objects.create(
        organization=org,
        player=players[0],
        reference="2026-07",
        amount=Decimal("45.00"),
        due_date=datetime.date(2026, 7, 15),
    )

    resync_pending_charges(organization=org, reference=REFERENCIA)

    julho.refresh_from_db()
    assert julho.amount == Decimal("45.00")


@pytest.mark.django_db
def test_nao_toca_em_outra_organizacao(cenario):
    org, _, _, _ = cenario
    outra = MembershipFactory().organization
    MembershipFeePlan.objects.create(
        organization=outra, name="Mensalidade", amount=Decimal("300.00")
    )
    forasteiro = PlayerFactory(
        organization=outra,
        primary_position=PositionFactory(organization=outra),
        player_type=Player.PlayerType.MENSALISTA,
    )
    charge_alheia = Charge.objects.create(
        organization=outra,
        player=forasteiro,
        reference=REFERENCIA,
        amount=Decimal("45.00"),
        due_date=datetime.date(2026, 8, 15),
    )

    resync_pending_charges(organization=org, reference=REFERENCIA)

    charge_alheia.refresh_from_db()
    assert charge_alheia.amount == Decimal("45.00")


# ---------------------------------------------------------------------------
# Auditoria
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_audita_o_lote_e_cada_cobranca(cenario):
    org, _, _, user = cenario

    resync_pending_charges(organization=org, reference=REFERENCIA, performed_by=user)

    lote = AuditLog.objects.filter(organization=org, action=AuditLog.Action.CHARGES_RESYNCED)
    assert lote.count() == 1
    assert lote.first().before["amounts"] == ["45.00"]
    assert lote.first().after["updated"] == 3
    # O registro do lote é um resumo, não um substituto do individual.
    assert (
        AuditLog.objects.filter(organization=org, action=AuditLog.Action.CHARGE_UPDATED).count() == 3
    )


@pytest.mark.django_db
def test_nao_audita_lote_vazio(cenario):
    """Uma trilha com "atualizou 0 cobranças" é ruído."""
    org, _, _, user = cenario
    resync_pending_charges(organization=org, reference=REFERENCIA, performed_by=user)

    resync_pending_charges(organization=org, reference=REFERENCIA, performed_by=user)

    assert (
        AuditLog.objects.filter(organization=org, action=AuditLog.Action.CHARGES_RESYNCED).count()
        == 1
    )


# ---------------------------------------------------------------------------
# Endpoints e permissões
# ---------------------------------------------------------------------------


def _cliente(user, org):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_ORGANIZATION_ID=str(org.id))
    return client


@pytest.mark.django_db
def test_endpoint_de_previa(cenario):
    org, _, _, user = cenario

    response = _cliente(user, org).get(
        "/api/finance/charges/resync-preview/", {"reference": REFERENCIA}
    )

    assert response.status_code == 200
    assert response.json()["to_update_count"] == 3


@pytest.mark.django_db
def test_endpoint_de_execucao(cenario):
    org, _, charges, user = cenario

    response = _cliente(user, org).post(
        "/api/finance/charges/resync/", {"reference": REFERENCIA}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["updated_count"] == 3
    charges[0].refresh_from_db()
    assert charges[0].amount == Decimal("90.00")


@pytest.mark.django_db
def test_sem_competencia_usa_a_corrente(cenario):
    org, _, _, user = cenario

    response = _cliente(user, org).get("/api/finance/charges/resync-preview/")

    assert response.status_code == 200
    from apps.finance.services import current_reference

    assert response.json()["reference"] == current_reference()


@pytest.mark.django_db
def test_jogador_nao_ressincroniza(cenario):
    org, _, _, _ = cenario
    from common.permissions import ROLE_JOGADOR

    jogador = UserFactory(username="so_joga")
    MembershipFactory(user=jogador, organization=org, role=ROLE_JOGADOR)

    response = _cliente(jogador, org).post(
        "/api/finance/charges/resync/", {"reference": REFERENCIA}, format="json"
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_visualizador_nao_ressincroniza(cenario):
    org, _, _, _ = cenario
    from common.permissions import ROLE_VISUALIZADOR

    espectador = UserFactory(username="so_olha")
    MembershipFactory(user=espectador, organization=org, role=ROLE_VISUALIZADOR)

    response = _cliente(espectador, org).post(
        "/api/finance/charges/resync/", {"reference": REFERENCIA}, format="json"
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_ids_de_outra_organizacao_sao_ignorados(cenario):
    """O isolamento não depende de o cliente mandar a coisa certa."""
    org, _, charges, user = cenario
    outra = MembershipFactory().organization
    forasteiro = PlayerFactory(
        organization=outra, primary_position=PositionFactory(organization=outra)
    )

    response = _cliente(user, org).post(
        "/api/finance/charges/resync/",
        {"reference": REFERENCIA, "player_ids": [forasteiro.id]},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["updated_count"] == 0
    charges[0].refresh_from_db()
    assert charges[0].amount == Decimal("45.00")
