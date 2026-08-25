"""Mensalidade por mensalista: valor vigente, alteração (individual e em massa),
estorno de baixa, linha do tempo e permissões financeiras.

As três promessas que estes testes travam:

1. **Alterar o valor não é retroativo.** A vigência nova começa numa
   competência; as anteriores — e as cobranças já geradas — ficam intactas.
2. **Competência ≠ data de pagamento.** Pagar em maio a mensalidade de abril
   não move nada para maio.
3. **Nada é destruído.** Cancelar uma baixa preserva o pagamento, com quem
   cancelou, quando e por quê.
"""

import datetime
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.finance.models import Charge, MembershipFeePlan, Payment, PlayerMonthlyFee
from apps.finance.services import (
    bulk_change_preview,
    bulk_set_player_fees,
    cancel_payment,
    charge_timeline,
    create_charge,
    fee_amount_for,
    financial_summary,
    generate_recurring_charges,
    register_payment,
    set_player_fee,
)
from apps.players.models import Player
from common.exceptions import DomainError
from common.permissions import ROLE_JOGADOR, ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import MembershipFactory, OrganizationFactory, PlayerFactory
from .test_roles_and_superadmin import client_for

HOJE = timezone.localdate()
AMANHA = HOJE + datetime.timedelta(days=1)


def _plan(org, *, amount="100.00", due_day=10):
    return MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=Decimal(amount), due_day=due_day
    )


def _mensalista(org, name="João"):
    return PlayerFactory(
        organization=org, name=name, player_type=Player.PlayerType.MENSALISTA
    )


# ---------------------------------------------------------------------------
# 1. Valor vigente e alteração não retroativa
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_fee_falls_back_to_the_organization_plan():
    """Quem nunca teve valor próprio paga o do plano — não fica sem valor."""
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org)

    assert fee_amount_for(joao, "2026-01") == Decimal("100.00")


@pytest.mark.django_db
def test_changing_the_fee_only_applies_from_the_chosen_reference():
    """O exemplo do enunciado: 100 até abril, 120 de maio em diante."""
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org)

    set_player_fee(
        organization=org, player=joao, amount=Decimal("120.00"), effective_from="2026-05"
    )

    assert fee_amount_for(joao, "2026-01") == Decimal("100.00")
    assert fee_amount_for(joao, "2026-04") == Decimal("100.00")
    assert fee_amount_for(joao, "2026-05") == Decimal("120.00")
    assert fee_amount_for(joao, "2026-06") == Decimal("120.00")


@pytest.mark.django_db
def test_changing_the_fee_never_rewrites_charges_already_generated():
    """A garantia central: janeiro a abril continuam valendo 100 no banco mesmo
    depois de o jogador passar a pagar 120."""
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org)
    for referencia in ("2026-01", "2026-02", "2026-03", "2026-04"):
        generate_recurring_charges(organization=org, reference=referencia)

    set_player_fee(
        organization=org, player=joao, amount=Decimal("120.00"), effective_from="2026-05"
    )
    generate_recurring_charges(organization=org, reference="2026-05")
    generate_recurring_charges(organization=org, reference="2026-06")

    valores = {
        charge.reference: charge.amount
        for charge in Charge.objects.filter(player=joao).order_by("reference")
    }
    assert valores == {
        "2026-01": Decimal("100.00"),
        "2026-02": Decimal("100.00"),
        "2026-03": Decimal("100.00"),
        "2026-04": Decimal("100.00"),
        "2026-05": Decimal("120.00"),
        "2026-06": Decimal("120.00"),
    }


@pytest.mark.django_db
def test_a_paid_charge_keeps_its_amount_after_a_fee_change():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org)
    generate_recurring_charges(organization=org, reference="2026-03")
    charge = Charge.objects.get(player=joao, reference="2026-03")
    register_payment(charge=charge, amount=Decimal("100.00"))

    set_player_fee(
        organization=org, player=joao, amount=Decimal("150.00"), effective_from="2026-04"
    )

    charge.refresh_from_db()
    assert charge.amount == Decimal("100.00")
    assert charge.effective_status == "paid"


@pytest.mark.django_db
def test_changing_the_fee_is_audited_with_the_previous_and_the_new_amount():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org)

    set_player_fee(
        organization=org,
        player=joao,
        amount=Decimal("120.00"),
        effective_from="2026-05",
        reason="reajuste anual",
    )

    log = AuditLog.objects.get(action=AuditLog.Action.FEE_CHANGED)
    assert log.player_id == joao.id
    assert log.before["amount"] == "100.00"
    assert log.after["amount"] == "120.00"
    assert log.after["effective_from"] == "2026-05"
    assert log.reason == "reajuste anual"
    assert log.entity == "player_monthly_fee"


@pytest.mark.django_db
def test_each_change_adds_a_vigency_instead_of_overwriting_the_previous_one():
    org = OrganizationFactory()
    _plan(org)
    joao = _mensalista(org)

    set_player_fee(organization=org, player=joao, amount=Decimal("120.00"), effective_from="2026-05")
    set_player_fee(organization=org, player=joao, amount=Decimal("150.00"), effective_from="2026-08")

    vigencias = list(PlayerMonthlyFee.objects.filter(player=joao).order_by("effective_from"))
    assert [(v.effective_from, v.amount) for v in vigencias] == [
        ("2026-05", Decimal("120.00")),
        ("2026-08", Decimal("150.00")),
    ]
    assert fee_amount_for(joao, "2026-07") == Decimal("120.00")
    assert fee_amount_for(joao, "2026-08") == Decimal("150.00")


@pytest.mark.django_db
def test_correcting_the_same_reference_replaces_the_vigency_but_audits_the_old_value():
    org = OrganizationFactory()
    _plan(org)
    joao = _mensalista(org)
    set_player_fee(organization=org, player=joao, amount=Decimal("120.00"), effective_from="2026-05")

    set_player_fee(organization=org, player=joao, amount=Decimal("125.00"), effective_from="2026-05")

    assert PlayerMonthlyFee.objects.filter(player=joao, effective_from="2026-05").count() == 1
    assert fee_amount_for(joao, "2026-05") == Decimal("125.00")
    assert AuditLog.objects.filter(action=AuditLog.Action.FEE_CHANGED).count() == 2


@pytest.mark.django_db
def test_only_mensalistas_have_a_monthly_fee():
    org = OrganizationFactory()
    convidado = PlayerFactory(organization=org, player_type=Player.PlayerType.CONVIDADO)

    with pytest.raises(DomainError, match="não é mensalista"):
        set_player_fee(
            organization=org, player=convidado, amount=Decimal("10.00"), effective_from="2026-05"
        )


@pytest.mark.django_db
def test_a_fee_cannot_reach_a_player_from_another_organization():
    org = OrganizationFactory()
    alheio = _mensalista(OrganizationFactory())

    with pytest.raises(DomainError, match="não pertence a esta organização"):
        set_player_fee(
            organization=org, player=alheio, amount=Decimal("10.00"), effective_from="2026-05"
        )


@pytest.mark.django_db
@pytest.mark.parametrize("invalida", ["2026-13", "2026-5", "maio", "26-05", ""])
def test_an_invalid_reference_is_refused(invalida):
    org = OrganizationFactory()
    joao = _mensalista(org)

    with pytest.raises(DomainError, match="Competência inválida"):
        set_player_fee(
            organization=org, player=joao, amount=Decimal("10.00"), effective_from=invalida
        )


# ---------------------------------------------------------------------------
# 2. Alteração em massa
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_bulk_change_applies_to_every_mensalista_and_shares_one_batch():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    jogadores = [_mensalista(org, name=f"Jogador {i}") for i in range(5)]

    resultado = bulk_set_player_fees(
        organization=org,
        players=None,  # todos
        amount=Decimal("120.00"),
        effective_from="2026-05",
        reason="reajuste 2026",
    )

    assert resultado["players_count"] == 5
    assert resultado["previous_amounts"] == ["100.00"]
    batches = set(
        PlayerMonthlyFee.objects.filter(organization=org).values_list("batch", flat=True)
    )
    assert len(batches) == 1  # um identificador para a operação inteira
    for jogador in jogadores:
        assert fee_amount_for(jogador, "2026-05") == Decimal("120.00")
        assert fee_amount_for(jogador, "2026-04") == Decimal("100.00")


@pytest.mark.django_db
def test_bulk_change_can_target_a_subset():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    escolhidos = [_mensalista(org, name=f"Escolhido {i}") for i in range(2)]
    de_fora = _mensalista(org, name="De fora")

    bulk_set_player_fees(
        organization=org, players=escolhidos, amount=Decimal("120.00"), effective_from="2026-05"
    )

    assert all(fee_amount_for(p, "2026-05") == Decimal("120.00") for p in escolhidos)
    assert fee_amount_for(de_fora, "2026-05") == Decimal("100.00")


@pytest.mark.django_db
def test_bulk_change_audits_the_batch_and_each_player():
    org = OrganizationFactory()
    _plan(org)
    for i in range(3):
        _mensalista(org, name=f"Jogador {i}")

    resultado = bulk_set_player_fees(
        organization=org, players=None, amount=Decimal("120.00"), effective_from="2026-05"
    )

    lote = AuditLog.objects.get(action=AuditLog.Action.FEE_BULK_CHANGED)
    assert lote.after["batch"] == resultado["batch"]
    assert lote.after["players_count"] == 3
    assert lote.after["effective_from"] == "2026-05"
    assert lote.before["players_count"] == 3
    # O resumo do lote não substitui o registro individual de cada jogador.
    assert AuditLog.objects.filter(action=AuditLog.Action.FEE_CHANGED).count() == 3


@pytest.mark.django_db
def test_bulk_preview_describes_the_impact_without_changing_anything():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    for i in range(4):
        _mensalista(org, name=f"Jogador {i}")
    generate_recurring_charges(organization=org, reference="2026-05")

    previa = bulk_change_preview(organization=org, players=None, effective_from="2026-05")

    assert previa["players_count"] == 4
    assert previa["current_amounts"] == ["100.00"]
    assert previa["already_charged"] == 4  # já lançadas: a alteração não as toca
    assert PlayerMonthlyFee.objects.count() == 0


@pytest.mark.django_db
def test_bulk_change_refuses_a_player_from_another_organization():
    org = OrganizationFactory()
    alheio = _mensalista(OrganizationFactory())

    with pytest.raises(DomainError, match="outra organização"):
        bulk_set_player_fees(
            organization=org, players=[alheio], amount=Decimal("120.00"), effective_from="2026-05"
        )


# ---------------------------------------------------------------------------
# 3. Competência ≠ data de pagamento
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_late_payment_still_belongs_to_the_original_reference():
    """Mensalidade de abril paga em 15/05 continua sendo de abril."""
    org = OrganizationFactory()
    joao = _mensalista(org)
    charge = create_charge(
        organization=org,
        player=joao,
        reference="2026-04",
        amount=Decimal("100.00"),
        due_date=datetime.date(2026, 4, 10),
    )

    register_payment(charge=charge, amount=Decimal("100.00"), paid_at=datetime.date(2026, 5, 15))

    charge.refresh_from_db()
    assert charge.reference == "2026-04"
    assert charge.effective_status == "paid"
    # O painel de maio não ganha essa mensalidade: ela é de abril.
    assert financial_summary(org, reference="2026-05")["by_status"]["paid"]["count"] == 0
    assert financial_summary(org, reference="2026-04")["by_status"]["paid"]["count"] == 1


# ---------------------------------------------------------------------------
# 4. Estorno de baixa
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cancelling_a_payment_preserves_the_record_and_reopens_the_charge():
    org = OrganizationFactory()
    joao = _mensalista(org)
    charge = create_charge(
        organization=org,
        player=joao,
        reference="2026-05",
        amount=Decimal("120.00"),
        due_date=AMANHA,
    )
    pagamento = register_payment(charge=charge, amount=Decimal("120.00"))
    charge.refresh_from_db()
    assert charge.effective_status == "paid"

    cancel_payment(payment=pagamento, reason="Baixa realizada na competência incorreta")

    pagamento.refresh_from_db()
    charge.refresh_from_db()
    # O pagamento continua lá — com quem cancelou, quando e por quê.
    assert Payment.objects.filter(id=pagamento.id).exists()
    assert pagamento.status == Payment.Status.CANCELED
    assert pagamento.cancelled_at is not None
    assert pagamento.cancellation_reason == "Baixa realizada na competência incorreta"
    assert pagamento.amount == Decimal("120.00")  # o valor original não é zerado
    # A competência volta a ficar em aberto.
    assert charge.effective_status == "pending"
    assert charge.paid_amount == Decimal("0")
    assert charge.outstanding == Decimal("120.00")


@pytest.mark.django_db
def test_cancelling_a_payment_requires_a_reason():
    org = OrganizationFactory()
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    pagamento = register_payment(charge=charge, amount=Decimal("100.00"))

    for vazio in ("", "   "):
        with pytest.raises(DomainError, match="motivo do cancelamento"):
            cancel_payment(payment=pagamento, reason=vazio)


@pytest.mark.django_db
def test_a_cancelled_payment_cannot_be_cancelled_again():
    org = OrganizationFactory()
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    pagamento = register_payment(charge=charge, amount=Decimal("100.00"))
    cancel_payment(payment=pagamento, reason="erro")

    with pytest.raises(DomainError, match="já está cancelada"):
        cancel_payment(payment=pagamento, reason="de novo")


@pytest.mark.django_db
def test_a_new_payment_after_a_cancellation_settles_the_charge_again():
    """O fluxo do enunciado: baixa → cancelamento → nova baixa."""
    org = OrganizationFactory()
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("120.00"),
        due_date=AMANHA,
    )
    primeira = register_payment(charge=charge, amount=Decimal("120.00"), method=Payment.Method.PIX)
    cancel_payment(payment=primeira, reason="baixa realizada incorretamente")

    register_payment(charge=charge, amount=Decimal("120.00"), method=Payment.Method.CASH)

    charge.refresh_from_db()
    assert charge.effective_status == "paid"
    assert charge.paid_amount == Decimal("120.00")  # a cancelada não é contada
    assert charge.payments.count() == 2  # as duas continuam no histórico


@pytest.mark.django_db
def test_cancelled_payments_do_not_count_as_revenue():
    org = OrganizationFactory()
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    pagamento = register_payment(charge=charge, amount=Decimal("100.00"))

    cancel_payment(payment=pagamento, reason="estorno")

    assert financial_summary(org)["total_received"] == "0"


# ---------------------------------------------------------------------------
# 5. Linha do tempo
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_timeline_tells_the_whole_story_of_a_reference():
    org = OrganizationFactory()
    maria = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR).user
    carlos = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR).user
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("120.00"),
        due_date=AMANHA,
    )
    pagamento = register_payment(
        charge=charge, amount=Decimal("120.00"), method=Payment.Method.PIX, registered_by=maria
    )
    cancel_payment(payment=pagamento, reason="baixa realizada incorretamente", cancelled_by=carlos)
    register_payment(
        charge=charge, amount=Decimal("120.00"), method=Payment.Method.CASH, registered_by=carlos
    )

    linha = charge_timeline(charge)

    assert [entrada["action"] for entrada in linha] == [
        "charge_created",
        "payment_registered",
        "payment_canceled",
        "payment_registered",
    ]
    assert linha[1]["user"] == maria.username
    assert linha[1]["after"]["method"] == "pix"
    assert linha[2]["user"] == carlos.username
    assert linha[2]["reason"] == "baixa realizada incorretamente"
    assert linha[3]["after"]["method"] == "cash"


@pytest.mark.django_db
def test_the_timeline_of_one_charge_never_leaks_another():
    org = OrganizationFactory()
    joao = _mensalista(org, name="João")
    outra = create_charge(
        organization=org,
        player=_mensalista(org, name="Pedro"),
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    register_payment(charge=outra, amount=Decimal("100.00"))
    minha = create_charge(
        organization=org,
        player=joao,
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )

    assert [e["action"] for e in charge_timeline(minha)] == ["charge_created"]


# ---------------------------------------------------------------------------
# 6. API e permissões
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_manager_changes_one_fee_through_the_api():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org)
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    resposta = client.post(
        "/api/finance/member-fees/set/",
        {"player": joao.id, "amount": "120.00", "effective_from": "2026-05", "reason": "reajuste"},
        format="json",
    )

    assert resposta.status_code == 201, resposta.json()
    assert resposta.json()["amount"] == "120.00"
    assert resposta.json()["created_by_name"] == membership.user.username


@pytest.mark.django_db
def test_manager_runs_a_bulk_change_and_gets_the_batch_id():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    for i in range(3):
        _mensalista(org, name=f"Jogador {i}")
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    previa = client.get("/api/finance/member-fees/bulk-set/", {"effective_from": "2026-05"}).json()
    resposta = client.post(
        "/api/finance/member-fees/bulk-set/",
        {"amount": "120.00", "effective_from": "2026-05", "reason": "reajuste 2026"},
        format="json",
    )

    assert previa["players_count"] == 3
    assert previa["current_amounts"] == ["100.00"]
    assert resposta.status_code == 201
    assert resposta.json()["players_count"] == 3
    assert resposta.json()["batch"]


@pytest.mark.django_db
def test_member_fees_listing_shows_the_current_amount_of_each_mensalista():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org, name="João")
    _mensalista(org, name="Pedro")
    set_player_fee(organization=org, player=joao, amount=Decimal("150.00"), effective_from="2020-01")
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    linhas = client_for(membership.user, org).get("/api/finance/member-fees/").json()

    por_nome = {linha["player_name"]: linha for linha in linhas}
    assert por_nome["João"]["current_amount"] == "150.00"
    assert por_nome["João"]["from_plan"] is False
    assert por_nome["Pedro"]["current_amount"] == "100.00"
    assert por_nome["Pedro"]["from_plan"] is True


@pytest.mark.django_db
def test_fee_history_endpoint_lists_every_vigency():
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org)
    set_player_fee(organization=org, player=joao, amount=Decimal("120.00"), effective_from="2026-05")
    set_player_fee(organization=org, player=joao, amount=Decimal("150.00"), effective_from="2026-08")
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    corpo = (
        client_for(membership.user, org)
        .get(f"/api/finance/member-fees/{joao.id}/history/")
        .json()
    )

    assert [(v["effective_from"], v["amount"]) for v in corpo["history"]] == [
        ("2026-08", "150.00"),
        ("2026-05", "120.00"),
    ]


@pytest.mark.django_db
def test_manager_cancels_a_payment_through_the_api_with_a_reason():
    org = OrganizationFactory()
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    pagamento = register_payment(charge=charge, amount=Decimal("100.00"))
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    sem_motivo = client.post(f"/api/finance/payments/{pagamento.id}/cancel/", {}, format="json")
    com_motivo = client.post(
        f"/api/finance/payments/{pagamento.id}/cancel/",
        {"reason": "competência incorreta"},
        format="json",
    )

    assert sem_motivo.status_code == 400  # motivo é obrigatório
    assert com_motivo.status_code == 200
    assert com_motivo.json()["status"] == "canceled"
    assert com_motivo.json()["cancelled_by_name"] == membership.user.username
    assert com_motivo.json()["cancellation_reason"] == "competência incorreta"


@pytest.mark.django_db
def test_the_timeline_endpoint_returns_the_history():
    org = OrganizationFactory()
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    register_payment(charge=charge, amount=Decimal("100.00"))
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    linha = (
        client_for(membership.user, org).get(f"/api/finance/charges/{charge.id}/timeline/").json()
    )

    assert [e["action"] for e in linha] == ["charge_created", "payment_registered"]
    assert linha[0]["action_display"] == "Mensalidade lançada"


@pytest.mark.django_db
def test_charges_can_be_filtered_by_reference_period_amount_and_payment_date():
    org = OrganizationFactory()
    joao = _mensalista(org, name="João")
    pedro = _mensalista(org, name="Pedro")
    abril = create_charge(
        organization=org,
        player=joao,
        reference="2026-04",
        amount=Decimal("100.00"),
        due_date=datetime.date(2026, 4, 10),
    )
    create_charge(
        organization=org,
        player=pedro,
        reference="2026-05",
        amount=Decimal("150.00"),
        due_date=datetime.date(2026, 5, 10),
    )
    register_payment(charge=abril, amount=Decimal("100.00"), paid_at=datetime.date(2026, 5, 15))
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, org)

    def referencias(query):
        return sorted(item["reference"] for item in client.get(query).json()["results"])

    assert referencias("/api/finance/charges/?reference=2026-04") == ["2026-04"]
    assert referencias("/api/finance/charges/?reference_after=2026-05") == ["2026-05"]
    assert referencias("/api/finance/charges/?due_after=2026-05-01") == ["2026-05"]
    assert referencias("/api/finance/charges/?amount_min=120") == ["2026-05"]
    # Pago em 15/05, mas a competência continua sendo abril.
    assert referencias("/api/finance/charges/?paid_after=2026-05-01") == ["2026-04"]


@pytest.mark.django_db
def test_summary_can_be_scoped_to_one_reference():
    org = OrganizationFactory()
    create_charge(
        organization=org,
        player=_mensalista(org, name="A"),
        reference="2026-04",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    create_charge(
        organization=org,
        player=_mensalista(org, name="B"),
        reference="2026-05",
        amount=Decimal("150.00"),
        due_date=AMANHA,
    )
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    resumo = (
        client_for(membership.user, org).get("/api/finance/summary/?reference=2026-05").json()
    )

    assert resumo["reference"] == "2026-05"
    assert resumo["total_expected"] == "150.00"


@pytest.mark.django_db
@pytest.mark.parametrize("role", [ROLE_VISUALIZADOR, ROLE_JOGADOR])
def test_who_cannot_touch_the_fee_endpoints(role):
    org = OrganizationFactory()
    joao = _mensalista(org)
    membership = MembershipFactory(organization=org, role=role)
    client = client_for(membership.user, org)

    assert client.get("/api/finance/member-fees/").status_code == 403
    assert (
        client.post(
            "/api/finance/member-fees/set/",
            {"player": joao.id, "amount": "1.00", "effective_from": "2026-05"},
            format="json",
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/finance/member-fees/bulk-set/",
            {"amount": "1.00", "effective_from": "2026-05"},
            format="json",
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_a_player_cannot_cancel_a_payment():
    org = OrganizationFactory()
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    pagamento = register_payment(charge=charge, amount=Decimal("100.00"))
    membership = MembershipFactory(organization=org, role=ROLE_JOGADOR)

    resposta = client_for(membership.user, org).post(
        f"/api/finance/payments/{pagamento.id}/cancel/", {"reason": "quero"}, format="json"
    )

    assert resposta.status_code == 403


@pytest.mark.django_db
def test_a_manager_cannot_reach_another_organizations_finance():
    """Isolamento: nem para ler, nem para alterar valor, nem para estornar."""
    minha = OrganizationFactory()
    outra = OrganizationFactory()
    alheio = _mensalista(outra, name="De outra pelada")
    charge_alheia = create_charge(
        organization=outra,
        player=alheio,
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    pagamento_alheio = register_payment(charge=charge_alheia, amount=Decimal("100.00"))
    membership = MembershipFactory(organization=minha, role=ROLE_ORGANIZADOR)
    client = client_for(membership.user, minha)

    assert client.get("/api/finance/member-fees/").json() == []
    assert client.get(f"/api/finance/charges/{charge_alheia.id}/timeline/").status_code == 404
    assert (
        client.post(
            f"/api/finance/payments/{pagamento_alheio.id}/cancel/",
            {"reason": "x"},
            format="json",
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/finance/member-fees/set/",
            {"player": alheio.id, "amount": "1.00", "effective_from": "2026-05"},
            format="json",
        ).status_code
        == 400
    )


@pytest.mark.django_db
def test_capabilities_endpoint_tells_the_screen_what_this_user_can_do():
    org = OrganizationFactory()
    gerente = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    jogador = MembershipFactory(organization=org, role=ROLE_JOGADOR)

    do_gerente = client_for(gerente.user, org).get("/api/finance/capabilities/").json()
    do_jogador = client_for(jogador.user, org).get("/api/finance/capabilities/").json()

    assert "financial.cancel_payment" in do_gerente["capabilities"]
    assert do_jogador["capabilities"] == []


@pytest.mark.django_db
def test_a_charge_is_never_deleted_only_canceled():
    org = OrganizationFactory()
    charge = create_charge(
        organization=org,
        player=_mensalista(org),
        reference="2026-05",
        amount=Decimal("100.00"),
        due_date=AMANHA,
    )
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)

    resposta = client_for(membership.user, org).delete(f"/api/finance/charges/{charge.id}/")

    assert resposta.status_code == 400
    assert Charge.objects.filter(id=charge.id).exists()


@pytest.mark.django_db
def test_generation_uses_each_players_own_fee():
    """Uma organização com valores diferentes por jogador gera cobranças
    diferentes na mesma competência."""
    org = OrganizationFactory()
    _plan(org, amount="100.00")
    joao = _mensalista(org, name="João")
    pedro = _mensalista(org, name="Pedro")
    set_player_fee(organization=org, player=joao, amount=Decimal("150.00"), effective_from="2026-05")

    generate_recurring_charges(organization=org, reference="2026-05")

    assert Charge.objects.get(player=joao, reference="2026-05").amount == Decimal("150.00")
    assert Charge.objects.get(player=pedro, reference="2026-05").amount == Decimal("100.00")


@pytest.mark.django_db
def test_generation_is_audited_once_per_organization():
    org = OrganizationFactory()
    _plan(org)
    _mensalista(org, name="A")
    _mensalista(org, name="B")

    generate_recurring_charges(organization=org, reference="2026-05")

    log = AuditLog.objects.get(action=AuditLog.Action.CHARGES_GENERATED)
    assert log.after == {
        "reference": "2026-05",
        "created": 2,
        "plan_id": MembershipFeePlan.objects.get(organization=org).id,
        "due_day": 10,
        # A geração passou a registrar também a multa vigente do plano: é ela
        # que fica congelada em cada cobrança, e sem isso a trilha não explica
        # por que uma competência cobra multa e a outra não.
        "late_fee_amount": "0.00",
    }
