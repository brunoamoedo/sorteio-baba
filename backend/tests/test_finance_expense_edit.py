"""Edição de despesa e o campo de vencimento.

Duas coisas aqui têm peso. A primeira é que **editar audita**: o `ModelViewSet`
gravava direto, então alterar o valor de uma despesa não deixava rastro nenhum
— num módulo cuja premissa é que toda operação relevante audita.

A segunda é o que o vencimento **não** faz. Ele é informativo: a despesa entra
no custo do mês pelo lançamento, não pelo vencimento. Se um dia isso mudar, o
saldo que o organizador já usa muda junto — e há teste travando essa fronteira.
"""

import datetime
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.finance.models import Expense
from apps.finance.services import (
    create_expense,
    expenses_summary,
    financial_summary,
    update_expense,
)
from common.exceptions import DomainError

from .factories import MembershipFactory, UserFactory

REFERENCIA = "2026-08"


@pytest.fixture
def pelada(db):
    membership = MembershipFactory()
    return membership.organization, membership.user


def despesa(org, **kwargs):
    padrao = dict(
        organization=org,
        description="Aluguel da quadra",
        amount=Decimal("300.00"),
        reference=REFERENCIA,
    )
    padrao.update(kwargs)
    return create_expense(**padrao)


def cliente(user, org):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_ORGANIZATION_ID=str(org.id))
    return client


# --- Vencimento -------------------------------------------------------------


@pytest.mark.django_db
def test_despesa_nasce_sem_vencimento(pelada):
    """Opcional: nem toda despesa tem data para vencer."""
    org, _ = pelada

    assert despesa(org).due_date is None


@pytest.mark.django_db
def test_aceita_vencimento_na_criacao(pelada):
    org, _ = pelada

    criada = despesa(org, due_date=datetime.date(2026, 8, 10))

    assert criada.due_date == datetime.date(2026, 8, 10)


@pytest.mark.django_db
def test_aceita_vencimento_como_texto(pelada):
    """O JSON não tem tipo data — o que chega da API é string."""
    org, _ = pelada

    criada = despesa(org, due_date="2026-08-10")

    assert criada.due_date == datetime.date(2026, 8, 10)


@pytest.mark.django_db
def test_vencimento_nao_muda_o_custo_do_mes(pelada):
    """A fronteira da decisão: despesa é gasto consumado. Se isto quebrar, o
    saldo que o organizador já usa muda junto."""
    org, _ = pelada
    despesa(org, amount=Decimal("300.00"), due_date=datetime.date(2099, 1, 1))

    resumo = expenses_summary(org, reference=REFERENCIA)
    painel = financial_summary(org, reference=REFERENCIA)

    assert resumo["total"] == "300.00"
    assert painel["balance"] == "-300.00"


# --- Edição -----------------------------------------------------------------


@pytest.mark.django_db
def test_edita_valor_e_descricao(pelada):
    org, gestor = pelada
    alvo = despesa(org)

    update_expense(
        expense=alvo, description="Aluguel + arbitragem", amount=Decimal("450.00"),
        performed_by=gestor,
    )

    alvo.refresh_from_db()
    assert alvo.description == "Aluguel + arbitragem"
    assert alvo.amount == Decimal("450.00")


@pytest.mark.django_db
def test_edicao_audita_so_o_que_mudou(pelada):
    org, gestor = pelada
    alvo = despesa(org)

    update_expense(expense=alvo, amount=Decimal("450.00"), performed_by=gestor)

    log = AuditLog.objects.get(action=AuditLog.Action.EXPENSE_UPDATED)
    assert log.before == {"amount": "300.00"}
    assert log.after == {"amount": "450.00"}
    assert "description" not in log.after


@pytest.mark.django_db
def test_salvar_sem_mudar_nada_nao_audita(pelada):
    org, gestor = pelada
    alvo = despesa(org)

    update_expense(expense=alvo, amount=Decimal("300.00"), performed_by=gestor)

    assert not AuditLog.objects.filter(action=AuditLog.Action.EXPENSE_UPDATED).exists()


@pytest.mark.django_db
def test_despesa_cancelada_nao_aceita_edicao(pelada):
    """Ela é o registro do que foi lançado e desfeito — corrigir apagaria
    justamente o que se quis registrar."""
    org, gestor = pelada
    alvo = despesa(org)
    alvo.status = Expense.Status.CANCELED
    alvo.save(update_fields=["status"])

    with pytest.raises(DomainError, match="cancelada"):
        update_expense(expense=alvo, amount=Decimal("450.00"), performed_by=gestor)


@pytest.mark.django_db
def test_valor_zero_e_recusado(pelada):
    org, gestor = pelada

    with pytest.raises(DomainError, match="maior que zero"):
        update_expense(expense=despesa(org), amount=Decimal("0"), performed_by=gestor)


@pytest.mark.django_db
def test_nao_altera_a_origem_da_despesa(pelada):
    """`kind` e `recurring` dizem de onde ela veio: reescrevê-los
    transformaria um custo fixo lançado em outra coisa, sem rastro."""
    org, gestor = pelada
    alvo = despesa(org, kind=Expense.Kind.FIXED)

    update_expense(expense=alvo, kind=Expense.Kind.EXTRA, performed_by=gestor)

    alvo.refresh_from_db()
    assert alvo.kind == Expense.Kind.FIXED


@pytest.mark.django_db
def test_edita_o_vencimento(pelada):
    org, gestor = pelada
    alvo = despesa(org, due_date=datetime.date(2026, 8, 10))

    update_expense(expense=alvo, due_date="2026-08-20", performed_by=gestor)

    alvo.refresh_from_db()
    assert alvo.due_date == datetime.date(2026, 8, 20)


# --- Endpoint ---------------------------------------------------------------


@pytest.mark.django_db
def test_patch_passa_pelo_servico_e_audita(pelada):
    org, gestor = pelada
    alvo = despesa(org)

    resposta = cliente(gestor, org).patch(
        f"/api/finance/expenses/{alvo.id}/", {"amount": "450.00"}, format="json"
    )

    assert resposta.status_code == 200
    assert resposta.json()["amount"] == "450.00"
    assert AuditLog.objects.filter(action=AuditLog.Action.EXPENSE_UPDATED).exists()


@pytest.mark.django_db
def test_listagem_traz_o_vencimento(pelada):
    org, gestor = pelada
    despesa(org, due_date=datetime.date(2026, 8, 10))

    resposta = cliente(gestor, org).get("/api/finance/expenses/")

    assert resposta.json()["results"][0]["due_date"] == "2026-08-10"


@pytest.mark.django_db
def test_listagem_devolve_so_despesas(pelada):
    """A aba não pode misturar mensalidade com despesa."""
    org, gestor = pelada
    despesa(org)

    dados = cliente(gestor, org).get("/api/finance/expenses/").json()["results"]

    assert all("player" not in linha for linha in dados)
    assert all("kind" in linha for linha in dados)


@pytest.mark.django_db
def test_visualizador_nao_edita(pelada):
    org, _ = pelada
    alvo = despesa(org)
    from common.permissions import ROLE_VISUALIZADOR

    espectador = UserFactory(username="so_olha")
    MembershipFactory(user=espectador, organization=org, role=ROLE_VISUALIZADOR)

    resposta = cliente(espectador, org).patch(
        f"/api/finance/expenses/{alvo.id}/", {"amount": "450.00"}, format="json"
    )

    assert resposta.status_code == 403
