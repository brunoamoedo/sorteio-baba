"""Módulo financeiro: mensalidades, baixa manual e dashboard.

Duas decisões de modelagem que estes testes travam:

- **"Atrasado" nunca é gravado** — é derivado de vencimento + pagamentos, como
  vitória/derrota é derivada dos gols. Um status gravado que envelhece sozinho
  ficaria errado entre execuções de qualquer rotina.
- **`Charge` e `Payment` são separados** — é o que permite pagamento parcial,
  estorno e, no futuro, um gateway criando o `Payment` por webhook sem tocar em
  `Charge` nem no dashboard.
"""

import datetime
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.finance.models import Charge, Payment
from apps.finance.services import (
    cancel_charge,
    cancel_payment,
    create_charge,
    financial_summary,
    register_payment,
)
from apps.players.models import Player
from common.exceptions import DomainError
from common.permissions import ROLE_JOGADOR, ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import MembershipFactory, OrganizationFactory, PlayerFactory
from .test_roles_and_superadmin import client_for

HOJE = timezone.localdate()
ONTEM = HOJE - datetime.timedelta(days=1)
AMANHA = HOJE + datetime.timedelta(days=1)


def _charge(org, player, *, amount="100.00", due_date=None, reference="2026-08"):
    return create_charge(
        organization=org,
        player=player,
        reference=reference,
        amount=Decimal(amount),
        due_date=due_date or AMANHA,
    )


# ---------------------------------------------------------------------------
# Cobrança
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_creating_a_charge_records_an_audit_entry():
    org = OrganizationFactory()
    player = PlayerFactory(organization=org)

    charge = _charge(org, player)

    assert charge.effective_status == "pending"
    assert charge.outstanding == Decimal("100.00")
    log = AuditLog.objects.get(action=AuditLog.Action.CHARGE_CREATED)
    assert log.player_id == player.id
    assert log.after["reference"] == "2026-08"


@pytest.mark.django_db
def test_the_same_player_cannot_be_charged_twice_for_the_same_month():
    org = OrganizationFactory()
    player = PlayerFactory(organization=org)
    _charge(org, player, reference="2026-08")

    with pytest.raises(DomainError, match="já tem uma mensalidade"):
        _charge(org, player, reference="2026-08")


@pytest.mark.django_db
def test_a_charge_cannot_reach_a_player_from_another_organization():
    org = OrganizationFactory()
    outra = OrganizationFactory()
    alheio = PlayerFactory(organization=outra)

    with pytest.raises(DomainError, match="não pertence a esta organização"):
        _charge(org, alheio)


@pytest.mark.django_db
def test_overdue_is_derived_never_stored():
    org = OrganizationFactory()
    vencida = _charge(org, PlayerFactory(organization=org), due_date=ONTEM, reference="2026-07")
    em_dia = _charge(org, PlayerFactory(organization=org), due_date=AMANHA, reference="2026-08")

    assert vencida.effective_status == "overdue"
    assert em_dia.effective_status == "pending"
    # O que está no banco continua sendo `pending` nos dois casos.
    assert vencida.status == Charge.Status.PENDING
    assert em_dia.status == Charge.Status.PENDING


# ---------------------------------------------------------------------------
# Baixa
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_full_payment_settles_the_charge_and_audits():
    org = OrganizationFactory()
    charge = _charge(org, PlayerFactory(organization=org))

    register_payment(charge=charge, amount=Decimal("100.00"), method=Payment.Method.PIX)

    charge.refresh_from_db()
    assert charge.effective_status == "paid"
    assert charge.outstanding == Decimal("0")
    log = AuditLog.objects.get(action=AuditLog.Action.PAYMENT_REGISTERED)
    assert log.after["method"] == "pix"
    assert log.before["status"] == "pending"


@pytest.mark.django_db
def test_partial_payment_keeps_the_charge_open():
    """Pagar em partes é normal numa pelada — quitar no primeiro lançamento
    esconderia o que ainda falta."""
    org = OrganizationFactory()
    charge = _charge(org, PlayerFactory(organization=org))

    register_payment(charge=charge, amount=Decimal("40.00"))
    charge.refresh_from_db()

    assert charge.effective_status == "pending"
    assert charge.paid_amount == Decimal("40.00")
    assert charge.outstanding == Decimal("60.00")

    register_payment(charge=charge, amount=Decimal("60.00"))
    charge.refresh_from_db()
    assert charge.effective_status == "paid"
    assert charge.payments.count() == 2


@pytest.mark.django_db
def test_an_overdue_charge_that_gets_paid_stops_being_overdue():
    org = OrganizationFactory()
    charge = _charge(org, PlayerFactory(organization=org), due_date=ONTEM)
    assert charge.effective_status == "overdue"

    register_payment(charge=charge, amount=Decimal("100.00"))

    charge.refresh_from_db()
    assert charge.effective_status == "paid"


@pytest.mark.django_db
def test_overpayment_does_not_produce_negative_outstanding():
    org = OrganizationFactory()
    charge = _charge(org, PlayerFactory(organization=org))

    register_payment(charge=charge, amount=Decimal("150.00"))

    charge.refresh_from_db()
    assert charge.outstanding == Decimal("0")


@pytest.mark.django_db
def test_a_canceled_charge_refuses_payment():
    org = OrganizationFactory()
    charge = cancel_charge(charge=_charge(org, PlayerFactory(organization=org)))

    with pytest.raises(DomainError, match="cancelada"):
        register_payment(charge=charge, amount=Decimal("10.00"))


@pytest.mark.django_db
def test_a_charge_with_an_active_payment_cannot_be_canceled():
    org = OrganizationFactory()
    charge = _charge(org, PlayerFactory(organization=org))
    register_payment(charge=charge, amount=Decimal("10.00"))

    with pytest.raises(DomainError, match="Cancele a baixa"):
        cancel_charge(charge=charge)


@pytest.mark.django_db
def test_a_charge_whose_payment_was_cancelled_can_be_canceled():
    """A baixa estornada não trava mais o cancelamento da mensalidade: ela
    continua no histórico, mas não é dinheiro."""
    org = OrganizationFactory()
    charge = _charge(org, PlayerFactory(organization=org))
    pagamento = register_payment(charge=charge, amount=Decimal("10.00"))
    cancel_payment(payment=pagamento, reason="lançada na competência errada")

    cancel_charge(charge=charge, reason="jogador saiu da pelada")

    charge.refresh_from_db()
    assert charge.effective_status == "canceled"


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_summary_counts_every_status_and_totals():
    org = OrganizationFactory()
    paga = _charge(org, PlayerFactory(organization=org), reference="2026-05")
    register_payment(charge=paga, amount=Decimal("100.00"))
    _charge(org, PlayerFactory(organization=org), reference="2026-06", due_date=ONTEM)  # atrasada
    _charge(org, PlayerFactory(organization=org), reference="2026-07", due_date=AMANHA)  # pendente
    cancelada = _charge(org, PlayerFactory(organization=org), reference="2026-08")
    cancel_charge(charge=cancelada)

    resumo = financial_summary(org)

    assert resumo["by_status"]["paid"]["count"] == 1
    assert resumo["by_status"]["overdue"]["count"] == 1
    assert resumo["by_status"]["pending"]["count"] == 1
    assert resumo["by_status"]["canceled"]["count"] == 1
    # Cancelada não entra no previsto; o recebido é o que de fato entrou.
    assert resumo["total_expected"] == "300.00"
    assert resumo["total_received"] == "100.00"
    assert resumo["total_outstanding"] == "200.00"


@pytest.mark.django_db
def test_summary_never_mixes_organizations():
    org = OrganizationFactory()
    outra = OrganizationFactory()
    _charge(org, PlayerFactory(organization=org))
    _charge(outra, PlayerFactory(organization=outra), amount="999.00")

    assert financial_summary(org)["total_expected"] == "100.00"


# ---------------------------------------------------------------------------
# API e permissões
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_manager_creates_a_charge_and_settles_it_through_the_api():
    org = OrganizationFactory()
    player = PlayerFactory(organization=org)
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    criada = client.post(
        "/api/finance/charges/",
        {"player": player.id, "reference": "2026-08", "amount": "80.00", "due_date": str(AMANHA)},
        format="json",
    )
    assert criada.status_code == 201, criada.json()
    charge_id = criada.json()["id"]
    assert criada.json()["effective_status"] == "pending"

    baixa = client.post(
        f"/api/finance/charges/{charge_id}/register-payment/",
        {"amount": "80.00", "method": "pix", "notes": "recebido no grupo"},
        format="json",
    )
    assert baixa.status_code == 200
    assert baixa.json()["effective_status"] == "paid"
    assert baixa.json()["payments"][0]["registered_by_name"] == membership.user.username

    resumo = client.get("/api/finance/summary/").json()
    assert resumo["total_received"] == "80.00"


@pytest.mark.django_db
def test_the_api_blocks_charging_a_player_from_another_organization():
    org = OrganizationFactory()
    alheio = PlayerFactory(organization=OrganizationFactory())
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    response = client_for(membership.user, org).post(
        "/api/finance/charges/",
        {"player": alheio.id, "reference": "2026-08", "amount": "80.00", "due_date": str(AMANHA)},
        format="json",
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_player_sees_only_their_own_charges():
    """Auto-serviço: a rota filtra pelo login. Sem vínculo `Player.user`, a
    lista vem vazia — nunca "todas"."""
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    minha_ficha = PlayerFactory(organization=org, user=membership.user, name="Eu")
    de_outro = PlayerFactory(organization=org, name="Outro")
    _charge(org, minha_ficha, reference="2026-08", amount="50.00")
    _charge(org, de_outro, reference="2026-08", amount="70.00")

    client = client_for(membership.user, org)

    assert client.get("/api/finance/charges/").status_code == 403  # lista administrativa
    minhas = client.get("/api/finance/charges/mine/").json()
    assert [c["player_name"] for c in minhas] == ["Eu"]
    assert minhas[0]["amount"] == "50.00"


@pytest.mark.django_db
def test_a_player_without_a_linked_profile_gets_an_empty_list_not_everything():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_JOGADOR)
    _charge(org, PlayerFactory(organization=org), reference="2026-08")

    assert client_for(membership.user, org).get("/api/finance/charges/mine/").json() == []


@pytest.mark.django_db
def test_viewer_cannot_touch_the_finance_module():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    client = client_for(membership.user, org)

    assert client.get("/api/finance/charges/").status_code == 403
    assert client.get("/api/finance/summary/").status_code == 403


@pytest.mark.django_db
def test_finance_is_isolated_per_organization_through_the_api():
    org = OrganizationFactory()
    outra = OrganizationFactory()
    _charge(outra, PlayerFactory(organization=outra))
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    assert client_for(membership.user, org).get("/api/finance/charges/").json()["count"] == 0


@pytest.mark.django_db
def test_the_same_person_has_separate_finances_in_each_organization():
    """A ficha é por organização, então o financeiro também é — o João da
    Arena não vê a mensalidade do João da Liga."""
    arena = OrganizationFactory()
    liga = OrganizationFactory()
    membership_arena = MembershipFactory(organization=arena, role=ROLE_JOGADOR)
    joao = membership_arena.user
    MembershipFactory.create(user=joao, organization=liga, role=ROLE_JOGADOR)

    ficha_arena = PlayerFactory(organization=arena, user=joao, name="João")
    ficha_liga = PlayerFactory(organization=liga, user=joao, name="João")
    _charge(arena, ficha_arena, amount="30.00")
    _charge(liga, ficha_liga, amount="90.00")

    na_arena = client_for(joao, arena).get("/api/finance/charges/mine/").json()
    na_liga = client_for(joao, liga).get("/api/finance/charges/mine/").json()

    assert [c["amount"] for c in na_arena] == ["30.00"]
    assert [c["amount"] for c in na_liga] == ["90.00"]
    assert Player.objects.filter(user=joao).count() == 2  # um cadastro por organização


# ---------------------------------------------------------------------------
# Geração recorrente
# ---------------------------------------------------------------------------


def _fee_plan(org, *, amount="100.00", due_day=10):
    from apps.finance.models import MembershipFeePlan

    return MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=Decimal(amount), due_day=due_day
    )


@pytest.mark.django_db
def test_recurring_generation_charges_every_active_mensalista():
    from apps.finance.services import generate_recurring_charges

    org = OrganizationFactory()
    _fee_plan(org, amount="75.00")
    mensalistas = [
        PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA) for _ in range(3)
    ]
    PlayerFactory(organization=org, player_type=Player.PlayerType.CONVIDADO)  # convidado: fora
    PlayerFactory(
        organization=org, player_type=Player.PlayerType.MENSALISTA, status=Player.Status.INATIVO
    )  # inativo: fora

    criadas = generate_recurring_charges(organization=org, reference="2026-09")

    assert criadas == 3
    charges = Charge.objects.filter(organization=org, reference="2026-09")
    assert set(charges.values_list("player_id", flat=True)) == {p.id for p in mensalistas}
    assert all(c.amount == Decimal("75.00") for c in charges)
    assert all(str(c.due_date) == "2026-09-10" for c in charges)


@pytest.mark.django_db
def test_recurring_generation_is_idempotent():
    """Rodar a task duas vezes no mesmo mês não cobra ninguém em dobro."""
    from apps.finance.services import generate_recurring_charges

    org = OrganizationFactory()
    _fee_plan(org)
    PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA)

    assert generate_recurring_charges(organization=org, reference="2026-09") == 1
    assert generate_recurring_charges(organization=org, reference="2026-09") == 0
    assert Charge.objects.filter(organization=org, reference="2026-09").count() == 1


@pytest.mark.django_db
def test_recurring_generation_never_charges_a_temporary_guest():
    """O convidado da lista colada existe só para o sorteio — cobrar
    mensalidade dele seria absurdo."""
    from apps.finance.services import generate_recurring_charges

    org = OrganizationFactory()
    _fee_plan(org)
    PlayerFactory(
        organization=org, player_type=Player.PlayerType.MENSALISTA, is_temporary=True, name="Zango"
    )

    assert generate_recurring_charges(organization=org, reference="2026-09") == 0


@pytest.mark.django_db
def test_due_day_31_falls_back_to_the_last_day_of_a_short_month():
    """Dia 31 em fevereiro estouraria `ValueError`; escorrega para o último dia."""
    from apps.finance.services import generate_recurring_charges

    org = OrganizationFactory()
    _fee_plan(org, due_day=31)
    PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA)

    generate_recurring_charges(organization=org, reference="2026-02")

    assert str(Charge.objects.get(organization=org).due_date) == "2026-02-28"


@pytest.mark.django_db
def test_an_organization_without_an_active_plan_generates_nothing():
    from apps.finance.models import MembershipFeePlan
    from apps.finance.services import generate_recurring_charges

    org = OrganizationFactory()
    MembershipFeePlan.objects.create(
        organization=org, name="Desativado", amount=Decimal("50.00"), is_active=False
    )
    PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA)

    assert generate_recurring_charges(organization=org, reference="2026-09") == 0


@pytest.mark.django_db
def test_the_celery_task_runs_across_organizations():
    from apps.finance.tasks import generate_recurring_charges_task

    uma = OrganizationFactory()
    outra = OrganizationFactory()
    for org in (uma, outra):
        _fee_plan(org)
        PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA)

    assert generate_recurring_charges_task() == 2
    assert Charge.objects.filter(organization=uma).count() == 1
    assert Charge.objects.filter(organization=outra).count() == 1


@pytest.mark.django_db
def test_manager_generates_the_month_on_demand_through_the_api():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    _fee_plan(org, amount="60.00")
    PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA)
    PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA)
    client = client_for(membership.user, org)

    primeira = client.post(
        "/api/finance/charges/generate-monthly/", {"reference": "2026-09"}, format="json"
    )
    segunda = client.post(
        "/api/finance/charges/generate-monthly/", {"reference": "2026-09"}, format="json"
    )

    assert primeira.json()["created"] == 2
    assert segunda.json()["created"] == 0  # idempotente
    assert Charge.objects.filter(organization=org, reference="2026-09").count() == 2


@pytest.mark.django_db
def test_player_cannot_generate_charges():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_JOGADOR)

    response = client_for(membership.user, org).post(
        "/api/finance/charges/generate-monthly/", {}, format="json"
    )

    assert response.status_code == 403
