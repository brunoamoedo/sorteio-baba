"""Multa por atraso.

A regra é a que a pelada combina: passou do vencimento, acrescenta um valor
fixo. R$ 100,00 com multa de R$ 10,00 e vencimento no dia 08 vira R$ 110,00 no
dia 09 — e continua R$ 110,00 no dia 15, porque a multa não acumula por dia.

Duas decisões de projeto sustentam tudo aqui, e são o que estes testes
protegem:

1. **A multa nunca é gravada.** É derivada de vencimento + datas de pagamento,
   como `overdue` sempre foi. Não existe estado "multa já cobrada" para sair de
   sincronia — cobrar duas vezes é impossível por construção, não por cuidado.

2. **A data que decide é a do pagamento, não a de hoje.** Lançar hoje uma baixa
   de um pagamento feito em dia não cobra multa de ninguém.

E, acima de tudo: com `late_fee_amount = 0` — o estado de todas as organizações
que já existem — o módulo tem de se comportar **exatamente** como antes.
"""

import datetime
from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.finance.models import Charge, MembershipFeePlan
from apps.finance.services import (
    cancel_payment,
    create_charge,
    generate_recurring_charges,
    late_fee_for,
    register_payment,
    update_fee_plan,
)
from apps.players.models import Player
from common.exceptions import DomainError

from .factories import MembershipFactory, PlayerFactory, PositionFactory

VENCIMENTO = datetime.date(2026, 8, 8)
VALOR = Decimal("100.00")
MULTA = Decimal("10.00")


@pytest.fixture
def org(db):
    return MembershipFactory().organization


@pytest.fixture
def mensalista(org):
    return PlayerFactory(
        organization=org,
        name="Ana",
        primary_position=PositionFactory(organization=org),
        player_type=Player.PlayerType.MENSALISTA,
    )


def cobranca(org, mensalista, *, multa=MULTA, valor=VALOR, reference="2026-08") -> Charge:
    return Charge.objects.create(
        organization=org,
        player=mensalista,
        reference=reference,
        amount=valor,
        late_fee_amount=multa,
        due_date=VENCIMENTO,
    )


# ---------------------------------------------------------------------------
# A garantia de não-regressão
# ---------------------------------------------------------------------------


class TestSemMultaNadaMuda:
    """`late_fee_amount = 0` é o estado de tudo que já existe no banco."""

    @pytest.mark.django_db
    def test_total_devido_e_o_valor(self, org, mensalista):
        charge = cobranca(org, mensalista, multa=Decimal("0"))

        assert charge.late_fee_due == Decimal("0")
        assert charge.total_due == charge.amount
        assert charge.outstanding == charge.amount

    @pytest.mark.django_db
    def test_quita_pagando_o_valor_mesmo_muito_atrasada(self, org, mensalista):
        """O caso que quebraria toda organização existente se o comparador de
        quitação passasse a exigir uma multa que ninguém configurou."""
        charge = cobranca(org, mensalista, multa=Decimal("0"))

        register_payment(charge=charge, amount=VALOR, paid_at=datetime.date(2026, 9, 30))

        charge.refresh_from_db()
        assert charge.status == Charge.Status.PAID
        assert charge.outstanding == Decimal("0")

    @pytest.mark.django_db
    def test_pagamento_parcial_continua_pendente(self, org, mensalista):
        charge = cobranca(org, mensalista, multa=Decimal("0"))

        register_payment(charge=charge, amount=Decimal("60.00"), paid_at=VENCIMENTO)

        charge.refresh_from_db()
        assert charge.status == Charge.Status.PENDING
        assert charge.outstanding == Decimal("40.00")


# ---------------------------------------------------------------------------
# O exemplo do requisito
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("dia", "total_esperado"),
    [
        (1, "100.00"),  # bem antes
        (7, "100.00"),  # véspera
        (8, "100.00"),  # no dia do vencimento — ainda não atrasou
        (9, "110.00"),  # um dia depois
        (15, "110.00"),  # uma semana depois: a multa **não** acumula
        (31, "110.00"),  # fim do mês
    ],
)
def test_total_devido_por_data_de_pagamento(org, mensalista, dia, total_esperado):
    charge = cobranca(org, mensalista)

    multa = late_fee_for(charge, on=datetime.date(2026, 8, dia))

    assert VALOR + multa == Decimal(total_esperado)


@pytest.mark.django_db
def test_pagar_no_vencimento_quita_sem_multa(org, mensalista):
    charge = cobranca(org, mensalista)

    register_payment(charge=charge, amount=VALOR, paid_at=VENCIMENTO)

    charge.refresh_from_db()
    assert charge.status == Charge.Status.PAID
    assert charge.late_fee_due == Decimal("0")


@pytest.mark.django_db
def test_pagar_atrasado_so_o_valor_nao_quita(org, mensalista):
    """Quem pagou R$ 100,00 no dia 09 deve R$ 110,00 — falta a multa."""
    charge = cobranca(org, mensalista)

    register_payment(charge=charge, amount=VALOR, paid_at=datetime.date(2026, 8, 9))

    charge.refresh_from_db()
    assert charge.status == Charge.Status.PENDING
    assert charge.total_due == Decimal("110.00")
    assert charge.outstanding == MULTA


@pytest.mark.django_db
def test_pagar_atrasado_com_a_multa_quita(org, mensalista):
    charge = cobranca(org, mensalista)

    register_payment(charge=charge, amount=Decimal("110.00"), paid_at=datetime.date(2026, 8, 15))

    charge.refresh_from_db()
    assert charge.status == Charge.Status.PAID
    assert charge.outstanding == Decimal("0")


# ---------------------------------------------------------------------------
# A data que decide
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_baixa_retroativa_de_pagamento_em_dia_nao_cobra_multa(org, mensalista):
    """O organizador só foi lançar dias depois — a multa pune o atraso de quem
    pagou, não a demora de quem registra."""
    charge = cobranca(org, mensalista)

    # Hoje é muito depois do vencimento, mas o dinheiro entrou no dia 08.
    register_payment(charge=charge, amount=VALOR, paid_at=VENCIMENTO)

    charge.refresh_from_db()
    assert charge.late_fee_due == Decimal("0")
    assert charge.status == Charge.Status.PAID


@pytest.mark.django_db
def test_cobranca_em_aberto_mostra_a_multa_prevista_de_hoje(org, mensalista):
    """Sem baixa nenhuma, a referência é hoje: é o que a pessoa pagaria agora.
    Com vencimento em 08/2026 e a suíte rodando depois disso, incide."""
    charge = cobranca(org, mensalista)

    assert charge.late_fee_due == MULTA
    assert charge.total_due == Decimal("110.00")


# ---------------------------------------------------------------------------
# Impossível cobrar duas vezes
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_duas_leituras_dao_o_mesmo_resultado(org, mensalista):
    """Se a multa fosse gravada, a segunda leitura poderia somar de novo."""
    charge = cobranca(org, mensalista)

    primeira = charge.total_due
    segunda = charge.total_due
    Charge.objects.get(pk=charge.pk)

    assert primeira == segunda == Charge.objects.get(pk=charge.pk).total_due


@pytest.mark.django_db
def test_dois_pagamentos_parciais_cobram_uma_multa_so(org, mensalista):
    charge = cobranca(org, mensalista)

    register_payment(charge=charge, amount=Decimal("60.00"), paid_at=datetime.date(2026, 8, 9))
    charge.refresh_from_db()
    register_payment(charge=charge, amount=Decimal("50.00"), paid_at=datetime.date(2026, 8, 10))

    charge.refresh_from_db()
    # 60 + 50 = 110 = valor + **uma** multa.
    assert charge.total_due == Decimal("110.00")
    assert charge.status == Charge.Status.PAID


@pytest.mark.django_db
def test_metade_em_dia_e_metade_atrasada_cobra_multa(org, mensalista):
    """Quem deixou parte em aberto passar do vencimento atrasou — a referência
    é o **último** recebimento."""
    charge = cobranca(org, mensalista)

    register_payment(charge=charge, amount=Decimal("50.00"), paid_at=datetime.date(2026, 8, 5))
    charge.refresh_from_db()
    register_payment(charge=charge, amount=Decimal("50.00"), paid_at=datetime.date(2026, 8, 20))

    charge.refresh_from_db()
    assert charge.total_due == Decimal("110.00")
    assert charge.status == Charge.Status.PENDING
    assert charge.outstanding == MULTA


@pytest.mark.django_db
def test_estornar_a_baixa_volta_a_multa_para_a_previsao(org, mensalista):
    charge = cobranca(org, mensalista)
    payment = register_payment(charge=charge, amount=Decimal("110.00"), paid_at=VENCIMENTO)
    charge.refresh_from_db()
    assert charge.status == Charge.Status.PAID

    cancel_payment(payment=payment, reason="lançamento errado")

    charge.refresh_from_db()
    assert charge.status == Charge.Status.PENDING
    # Sem baixa ativa, volta a valer a referência de hoje — que já passou.
    assert charge.late_fee_due == MULTA


@pytest.mark.django_db
def test_cobranca_cancelada_nao_tem_multa(org, mensalista):
    charge = cobranca(org, mensalista)
    charge.status = Charge.Status.CANCELED
    charge.save(update_fields=["status"])

    assert charge.late_fee_due == Decimal("0")
    assert charge.total_due == VALOR


# ---------------------------------------------------------------------------
# Congelamento
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_geracao_congela_a_multa_do_plano(org, mensalista):
    MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=8, late_fee_amount=MULTA
    )

    generate_recurring_charges(organization=org, reference="2026-08")

    charge = Charge.objects.get(player=mensalista, reference="2026-08")
    assert charge.late_fee_amount == MULTA
    assert charge.due_date == VENCIMENTO


@pytest.mark.django_db
def test_alterar_a_multa_do_plano_nao_muda_cobranca_lancada(org, mensalista):
    """Mesma regra do valor: reajustar hoje não cria dívida no passado."""
    plan = MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=8, late_fee_amount=MULTA
    )
    generate_recurring_charges(organization=org, reference="2026-08")
    charge = Charge.objects.get(player=mensalista, reference="2026-08")

    update_fee_plan(plan=plan, late_fee_amount=Decimal("50.00"))

    charge.refresh_from_db()
    assert charge.late_fee_amount == MULTA
    assert charge.total_due == Decimal("110.00")


@pytest.mark.django_db
def test_cobranca_avulsa_nasce_sem_multa(org, mensalista):
    """Quem lança uma mensalidade na mão não é surpreendido por uma multa que
    não pediu."""
    charge = create_charge(
        organization=org,
        player=mensalista,
        reference="2026-08",
        amount=VALOR,
        due_date=VENCIMENTO,
    )

    assert charge.late_fee_amount == Decimal("0")


# ---------------------------------------------------------------------------
# Vencimento configurável (regra que já existia — agora travada)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("reference", "due_day", "esperado"),
    [
        ("2026-08", 8, datetime.date(2026, 8, 8)),
        ("2026-02", 31, datetime.date(2026, 2, 28)),  # mês curto: escorrega
        ("2024-02", 31, datetime.date(2024, 2, 29)),  # bissexto
        ("2026-04", 31, datetime.date(2026, 4, 30)),
        ("2026-12", 15, datetime.date(2026, 12, 15)),
    ],
)
def test_vencimento_em_meses_diferentes(org, mensalista, reference, due_day, esperado):
    MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=due_day
    )

    generate_recurring_charges(organization=org, reference=reference)

    assert Charge.objects.get(player=mensalista, reference=reference).due_date == esperado


# ---------------------------------------------------------------------------
# Configuração e auditoria do plano
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_alterar_o_plano_audita_so_o_que_mudou(org):
    plan = MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=10
    )

    update_fee_plan(plan=plan, due_day=8, late_fee_amount=MULTA)

    log = AuditLog.objects.get(organization=org, action=AuditLog.Action.FEE_PLAN_CHANGED)
    assert log.before == {"due_day": "10", "late_fee_amount": "0.00"}
    assert log.after == {"due_day": "8", "late_fee_amount": "10.00"}
    # `name` e `amount` não mudaram e não poluem a trilha.
    assert "name" not in log.after


@pytest.mark.django_db
def test_salvar_o_plano_sem_mudar_nada_nao_audita(org):
    plan = MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=10
    )

    update_fee_plan(plan=plan, due_day=10)

    assert not AuditLog.objects.filter(action=AuditLog.Action.FEE_PLAN_CHANGED).exists()


@pytest.mark.django_db
def test_multa_negativa_e_recusada(org):
    plan = MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=10
    )

    with pytest.raises(DomainError, match="não pode ser negativa"):
        update_fee_plan(plan=plan, late_fee_amount=Decimal("-5.00"))


@pytest.mark.django_db
def test_dia_de_vencimento_invalido_e_recusado(org):
    plan = MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=10
    )

    with pytest.raises(DomainError, match="entre 1 e 31"):
        update_fee_plan(plan=plan, due_day=45)


@pytest.mark.django_db
def test_multa_zero_e_valida_e_desativa_a_cobranca(org):
    plan = MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=8, late_fee_amount=MULTA
    )

    update_fee_plan(plan=plan, late_fee_amount=Decimal("0"))

    plan.refresh_from_db()
    assert plan.late_fee_amount == Decimal("0")


# ---------------------------------------------------------------------------
# Trilha
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_baixa_registra_a_multa_aplicada(org, mensalista):
    charge = cobranca(org, mensalista)

    register_payment(charge=charge, amount=Decimal("110.00"), paid_at=datetime.date(2026, 8, 9))

    log = AuditLog.objects.filter(action=AuditLog.Action.PAYMENT_REGISTERED).latest("created_at")
    assert log.after["late_fee"] == "10.00"
    assert log.after["total_due"] == "110.00"


@pytest.mark.django_db
def test_baixa_em_dia_registra_multa_zero(org, mensalista):
    charge = cobranca(org, mensalista)

    register_payment(charge=charge, amount=VALOR, paid_at=VENCIMENTO)

    log = AuditLog.objects.filter(action=AuditLog.Action.PAYMENT_REGISTERED).latest("created_at")
    assert log.after["late_fee"] == "0.00"
