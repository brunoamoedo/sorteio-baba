"""Despesas da pelada: custos fixos mensais e custos extras.

O desenho espelha o lado da receita de propósito — competência, valor congelado,
geração idempotente e cancelamento não destrutivo — porque as perguntas são as
mesmas ("quanto custou abril?", "quem lançou isso?", "por que esta despesa
sumiu?").
"""

import datetime
from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.finance.models import Expense, RecurringExpense
from apps.finance.services import (
    cancel_expense,
    create_expense,
    expenses_summary,
    financial_summary,
    generate_fixed_expenses,
    register_payment,
)
from common.exceptions import DomainError
from common.permissions import ROLE_JOGADOR, ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import MembershipFactory, OrganizationFactory, PlayerFactory
from .test_finance_fees import _mensalista
from .test_roles_and_superadmin import client_for


def _fixo(org, descricao="Aluguel da quadra", amount="400.00", **kwargs):
    return RecurringExpense.objects.create(
        organization=org, description=descricao, amount=Decimal(amount), **kwargs
    )


# ---------------------------------------------------------------------------
# Custo extra
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_an_extra_expense_is_registered_with_its_reference_and_audited():
    org = OrganizationFactory()

    despesa = create_expense(
        organization=org,
        description="Bola nova",
        amount=Decimal("180.00"),
        reference="2026-05",
        incurred_on=datetime.date(2026, 5, 3),
    )

    assert despesa.kind == Expense.Kind.EXTRA
    assert despesa.status == Expense.Status.REGISTERED
    log = AuditLog.objects.get(action=AuditLog.Action.EXPENSE_CREATED)
    assert log.entity == "expense"
    assert log.after["amount"] == "180.00"
    assert log.after["reference"] == "2026-05"


@pytest.mark.django_db
def test_an_expense_refuses_a_zero_amount_or_an_empty_description():
    org = OrganizationFactory()

    with pytest.raises(DomainError, match="maior que zero"):
        create_expense(
            organization=org, description="Bola", amount=Decimal("0"), reference="2026-05"
        )
    with pytest.raises(DomainError, match="descrição"):
        create_expense(
            organization=org, description="   ", amount=Decimal("10.00"), reference="2026-05"
        )


@pytest.mark.django_db
@pytest.mark.parametrize("invalida", ["2026-13", "maio", "2026-5"])
def test_an_expense_refuses_an_invalid_reference(invalida):
    org = OrganizationFactory()

    with pytest.raises(DomainError, match="Competência inválida"):
        create_expense(
            organization=org, description="Bola", amount=Decimal("10.00"), reference=invalida
        )


# ---------------------------------------------------------------------------
# Custo fixo mensal
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_fixed_costs_are_generated_for_the_reference():
    org = OrganizationFactory()
    _fixo(org, "Aluguel da quadra", "400.00")
    _fixo(org, "Arbitragem", "120.00")

    criadas = generate_fixed_expenses(organization=org, reference="2026-05")

    assert criadas == 2
    despesas = Expense.objects.filter(organization=org, reference="2026-05")
    assert all(d.kind == Expense.Kind.FIXED for d in despesas)
    assert sum(d.amount for d in despesas) == Decimal("520.00")


@pytest.mark.django_db
def test_generating_fixed_costs_twice_does_not_duplicate_them():
    org = OrganizationFactory()
    _fixo(org)

    assert generate_fixed_expenses(organization=org, reference="2026-05") == 1
    assert generate_fixed_expenses(organization=org, reference="2026-05") == 0
    assert Expense.objects.filter(organization=org, reference="2026-05").count() == 1


@pytest.mark.django_db
def test_an_inactive_fixed_cost_is_not_generated():
    org = OrganizationFactory()
    _fixo(org, "Quadra antiga", is_active=False)

    assert generate_fixed_expenses(organization=org, reference="2026-05") == 0


@pytest.mark.django_db
def test_changing_a_fixed_cost_does_not_rewrite_the_expenses_already_generated():
    """O valor fica congelado na competência, como do lado da receita."""
    org = OrganizationFactory()
    quadra = _fixo(org, "Aluguel da quadra", "400.00")
    generate_fixed_expenses(organization=org, reference="2026-04")

    quadra.amount = Decimal("450.00")
    quadra.save(update_fields=["amount"])
    generate_fixed_expenses(organization=org, reference="2026-05")

    assert Expense.objects.get(reference="2026-04").amount == Decimal("400.00")
    assert Expense.objects.get(reference="2026-05").amount == Decimal("450.00")


@pytest.mark.django_db
def test_generation_is_audited_per_organization():
    org = OrganizationFactory()
    _fixo(org)

    generate_fixed_expenses(organization=org, reference="2026-05")

    log = AuditLog.objects.get(action=AuditLog.Action.EXPENSES_GENERATED)
    assert log.after == {"reference": "2026-05", "created": 1}


# ---------------------------------------------------------------------------
# Cancelamento não destrutivo
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cancelling_an_expense_preserves_the_record():
    org = OrganizationFactory()
    despesa = create_expense(
        organization=org, description="Churrasco", amount=Decimal("300.00"), reference="2026-05"
    )

    cancel_expense(expense=despesa, reason="lançada em duplicidade")

    despesa.refresh_from_db()
    assert Expense.objects.filter(id=despesa.id).exists()
    assert despesa.status == Expense.Status.CANCELED
    assert despesa.cancelled_at is not None
    assert despesa.cancellation_reason == "lançada em duplicidade"
    assert despesa.amount == Decimal("300.00")


@pytest.mark.django_db
def test_cancelling_an_expense_requires_a_reason():
    org = OrganizationFactory()
    despesa = create_expense(
        organization=org, description="Churrasco", amount=Decimal("300.00"), reference="2026-05"
    )

    with pytest.raises(DomainError, match="motivo do cancelamento"):
        cancel_expense(expense=despesa, reason="  ")


@pytest.mark.django_db
def test_a_cancelled_expense_does_not_count_as_cost():
    org = OrganizationFactory()
    create_expense(
        organization=org, description="Bola", amount=Decimal("100.00"), reference="2026-05"
    )
    cancelada = create_expense(
        organization=org, description="Erro", amount=Decimal("999.00"), reference="2026-05"
    )

    cancel_expense(expense=cancelada, reason="lançamento errado")

    assert expenses_summary(org, reference="2026-05")["total"] == "100.00"


# ---------------------------------------------------------------------------
# Painel: receita x despesa x saldo
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_summary_separates_fixed_from_extra_and_computes_the_balance():
    from apps.finance.services import create_charge

    org = OrganizationFactory()
    _fixo(org, "Quadra", "400.00")
    generate_fixed_expenses(organization=org, reference="2026-05")
    create_expense(
        organization=org, description="Bola nova", amount=Decimal("180.00"), reference="2026-05"
    )
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("1000.00"),
        due_date=datetime.date(2026, 5, 10),
    )
    register_payment(charge=charge, amount=Decimal("1000.00"))

    resumo = financial_summary(org, reference="2026-05")

    assert resumo["expenses"]["fixed"]["amount"] == "400.00"
    assert resumo["expenses"]["extra"]["amount"] == "180.00"
    assert resumo["expenses"]["total"] == "580.00"
    assert resumo["total_received"] == "1000.00"
    assert resumo["balance"] == "420.00"


@pytest.mark.django_db
def test_the_balance_can_be_negative_when_the_month_costs_more_than_it_receives():
    org = OrganizationFactory()
    create_expense(
        organization=org, description="Reforma", amount=Decimal("500.00"), reference="2026-05"
    )

    assert financial_summary(org, reference="2026-05")["balance"] == "-500.00"


@pytest.mark.django_db
def test_expenses_never_mix_organizations():
    org = OrganizationFactory()
    outra = OrganizationFactory()
    create_expense(
        organization=outra, description="Quadra deles", amount=Decimal("900.00"), reference="2026-05"
    )

    assert expenses_summary(org, reference="2026-05")["total"] == "0"


# ---------------------------------------------------------------------------
# API e permissões
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_manager_registers_a_fixed_cost_and_generates_the_month():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    cadastro = client.post(
        "/api/finance/recurring-expenses/",
        {"description": "Aluguel da quadra", "amount": "400.00", "due_day": 5},
        format="json",
    )
    geracao = client.post(
        "/api/finance/expenses/generate-fixed/", {"reference": "2026-05"}, format="json"
    )
    lista = client.get("/api/finance/expenses/?reference=2026-05").json()

    assert cadastro.status_code == 201, cadastro.json()
    assert geracao.json()["created"] == 1
    assert lista["results"][0]["kind"] == "fixed"
    assert lista["results"][0]["recurring_description"] == "Aluguel da quadra"


@pytest.mark.django_db
def test_manager_registers_an_extra_cost_through_the_api():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    resposta = client_for(membership.user, org).post(
        "/api/finance/expenses/",
        {
            "description": "Bola nova",
            "amount": "180.00",
            "reference": "2026-05",
            "incurred_on": "2026-05-03",
            "kind": "extra",
        },
        format="json",
    )

    assert resposta.status_code == 201, resposta.json()
    assert resposta.json()["kind"] == "extra"
    assert resposta.json()["registered_by_name"] == membership.user.username


@pytest.mark.django_db
def test_expenses_can_be_filtered_by_kind_and_reference():
    org = OrganizationFactory()
    _fixo(org)
    generate_fixed_expenses(organization=org, reference="2026-05")
    create_expense(
        organization=org, description="Bola", amount=Decimal("100.00"), reference="2026-05"
    )
    create_expense(
        organization=org, description="Antiga", amount=Decimal("50.00"), reference="2026-04"
    )
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    assert client.get("/api/finance/expenses/?kind=fixed").json()["count"] == 1
    assert client.get("/api/finance/expenses/?kind=extra").json()["count"] == 2
    assert client.get("/api/finance/expenses/?reference=2026-05").json()["count"] == 2


@pytest.mark.django_db
def test_an_expense_is_never_deleted_only_canceled():
    org = OrganizationFactory()
    despesa = create_expense(
        organization=org, description="Bola", amount=Decimal("100.00"), reference="2026-05"
    )
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    exclusao = client.delete(f"/api/finance/expenses/{despesa.id}/")
    sem_motivo = client.post(f"/api/finance/expenses/{despesa.id}/cancel/", {}, format="json")
    cancelamento = client.post(
        f"/api/finance/expenses/{despesa.id}/cancel/", {"reason": "duplicada"}, format="json"
    )

    assert exclusao.status_code == 400
    assert sem_motivo.status_code == 400
    assert cancelamento.status_code == 200
    assert cancelamento.json()["status"] == "canceled"
    assert Expense.objects.filter(id=despesa.id).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("role", [ROLE_VISUALIZADOR, ROLE_JOGADOR])
def test_who_cannot_see_or_touch_expenses(role):
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=role)
    client = client_for(membership.user, org)

    assert client.get("/api/finance/expenses/").status_code == 403
    assert client.get("/api/finance/recurring-expenses/").status_code == 403
    assert (
        client.post(
            "/api/finance/expenses/",
            {"description": "x", "amount": "1.00", "reference": "2026-05"},
            format="json",
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_a_manager_cannot_reach_another_organizations_expenses():
    minha = OrganizationFactory()
    outra = OrganizationFactory()
    alheia = create_expense(
        organization=outra, description="Quadra deles", amount=Decimal("400.00"), reference="2026-05"
    )
    membership = MembershipFactory(organization=minha, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, minha)

    assert client.get("/api/finance/expenses/").json()["count"] == 0
    assert (
        client.post(
            f"/api/finance/expenses/{alheia.id}/cancel/", {"reason": "x"}, format="json"
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_a_temporary_guest_is_irrelevant_to_expenses():
    """Sanidade do escopo: despesa é da organização, não do jogador — nenhum
    cadastro de jogador entra nessa conta."""
    org = OrganizationFactory()
    PlayerFactory(organization=org, is_temporary=True)
    create_expense(
        organization=org, description="Quadra", amount=Decimal("400.00"), reference="2026-05"
    )

    assert expenses_summary(org, reference="2026-05")["total"] == "400.00"
