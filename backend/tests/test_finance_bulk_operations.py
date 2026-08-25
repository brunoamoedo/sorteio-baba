"""Operações em massa: gerar, alterar vencimento e dar baixa.

Uma regra atravessa as três: **cada registro é tratado por si**. Um lote
atômico faria uma mensalidade problemática desfazer dezessete baixas boas — o
oposto do que o organizador quer quando seleciona meia pelada e clica.

Por isso o que estes testes mais protegem é o **resultado parcial**: quantas
entraram, quantas ficaram de fora e *por quê*. "3 de 5 processadas" sem dizer o
que houve com as outras duas obriga a conferir tudo na mão.
"""

import datetime
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.finance.models import Charge, MembershipFeePlan, Payment
from apps.finance.services import (
    bulk_change_due_date,
    bulk_register_payments,
    generate_charges_for,
    register_payment,
    set_player_fee,
)
from apps.players.models import Player
from common.exceptions import DomainError

from .factories import MembershipFactory, PlayerFactory, PositionFactory, UserFactory

REFERENCIA = "2026-08"
VALOR = Decimal("90.00")


@pytest.fixture
def pelada(db):
    """Uma organização com plano ativo e cinco mensalistas, sem cobrança."""
    membership = MembershipFactory()
    org = membership.organization
    MembershipFeePlan.objects.create(
        organization=org, name="Mensalidade", amount=VALOR, due_day=15, late_fee_amount=Decimal("10.00")
    )
    position = PositionFactory(organization=org)
    players = [
        PlayerFactory(
            organization=org,
            name=nome,
            primary_position=position,
            player_type=Player.PlayerType.MENSALISTA,
        )
        for nome in ("Ana", "Bruno", "Carla", "Diego", "Elis")
    ]
    return org, players, membership.user


def _ids(org) -> list[int]:
    """Ids das cobranças da organização — o que a tela seleciona."""
    return list(Charge.objects.filter(organization=org).values_list("id", flat=True))


def cliente(user, org):
    client = APIClient()
    client.force_authenticate(user=user)
    client.credentials(HTTP_X_ORGANIZATION_ID=str(org.id))
    return client


# ===========================================================================
# Gerar mensalidade
# ===========================================================================


@pytest.mark.django_db
def test_gera_para_todos_os_mensalistas(pelada):
    org, players, _ = pelada

    resultado = generate_charges_for(organization=org, reference=REFERENCIA)

    assert resultado["processed_count"] == 5
    assert resultado["skipped_count"] == 0
    assert Charge.objects.filter(organization=org, reference=REFERENCIA).count() == 5


@pytest.mark.django_db
def test_gera_so_para_os_selecionados(pelada):
    org, players, _ = pelada

    resultado = generate_charges_for(
        organization=org, reference=REFERENCIA, players=players[:2]
    )

    assert resultado["processed_count"] == 2
    assert Charge.objects.filter(organization=org, reference=REFERENCIA).count() == 2


@pytest.mark.django_db
def test_nao_duplica_quem_ja_tem(pelada):
    """A segunda passada não cobra ninguém em dobro — é o que permite clicar
    duas vezes sem medo."""
    org, _, _ = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)

    segunda = generate_charges_for(organization=org, reference=REFERENCIA)

    assert segunda["processed_count"] == 0
    assert segunda["skipped_count"] == 5
    assert {linha["reason"] for linha in segunda["skipped"]} == {
        "já possui mensalidade nesta competência"
    }
    assert Charge.objects.filter(organization=org, reference=REFERENCIA).count() == 5


@pytest.mark.django_db
def test_resumo_com_situacoes_mistas(pelada):
    """O formato que a tela mostra: 'Total 5 · Criadas 3 · Já possuíam 2'."""
    org, players, _ = pelada
    generate_charges_for(organization=org, reference=REFERENCIA, players=players[:2])

    resultado = generate_charges_for(organization=org, reference=REFERENCIA)

    assert resultado["total"] == 5
    assert resultado["processed_count"] == 3
    assert resultado["skipped_count"] == 2


@pytest.mark.django_db
def test_usa_o_valor_vigente_de_cada_jogador(pelada):
    org, players, _ = pelada
    set_player_fee(
        organization=org, player=players[0], amount=Decimal("150.00"), effective_from=REFERENCIA
    )

    generate_charges_for(organization=org, reference=REFERENCIA)

    assert Charge.objects.get(player=players[0]).amount == Decimal("150.00")
    assert Charge.objects.get(player=players[1]).amount == VALOR


@pytest.mark.django_db
def test_usa_o_vencimento_e_a_multa_do_plano(pelada):
    org, players, _ = pelada

    generate_charges_for(organization=org, reference=REFERENCIA)

    charge = Charge.objects.get(player=players[0])
    assert charge.due_date == datetime.date(2026, 8, 15)
    assert charge.late_fee_amount == Decimal("10.00")


@pytest.mark.django_db
def test_sem_plano_ativo_recusa(pelada):
    org, _, _ = pelada
    MembershipFeePlan.objects.filter(organization=org).update(is_active=False)

    with pytest.raises(DomainError, match="plano de mensalidade"):
        generate_charges_for(organization=org, reference=REFERENCIA)


@pytest.mark.django_db
def test_jogador_de_outra_organizacao_e_recusado(pelada):
    org, _, _ = pelada
    outra = MembershipFactory().organization
    forasteiro = PlayerFactory(
        organization=outra, primary_position=PositionFactory(organization=outra)
    )

    with pytest.raises(DomainError, match="outra organização"):
        generate_charges_for(organization=org, reference=REFERENCIA, players=[forasteiro])


@pytest.mark.django_db
def test_geracao_audita_o_escopo(pelada):
    """A trilha distingue "gerei o mês inteiro" de "gerei para estes dois"."""
    org, players, user = pelada

    generate_charges_for(organization=org, reference=REFERENCIA, players=players[:2], performed_by=user)

    log = AuditLog.objects.get(action=AuditLog.Action.CHARGES_GENERATED)
    assert log.after["scope"] == "selection"
    assert log.after["created"] == 2


# ===========================================================================
# Alterar vencimento em massa
# ===========================================================================


@pytest.mark.django_db
def test_altera_o_vencimento_das_pendentes(pelada):
    org, _, _ = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)

    resultado = bulk_change_due_date(organization=org, due_day=10, charge_ids=_ids(org))

    assert resultado["processed_count"] == 5
    assert set(
        Charge.objects.filter(reference=REFERENCIA).values_list("due_date", flat=True)
    ) == {datetime.date(2026, 8, 10)}


@pytest.mark.django_db
def test_vencimento_pula_a_paga(pelada):
    org, players, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    paga = Charge.objects.get(player=players[0])
    register_payment(charge=paga, amount=paga.total_due, registered_by=user)

    resultado = bulk_change_due_date(organization=org, due_day=10, charge_ids=_ids(org))

    paga.refresh_from_db()
    assert paga.due_date == datetime.date(2026, 8, 15)
    assert resultado["processed_count"] == 4
    assert [linha["reason"] for linha in resultado["skipped"]] == ["já paga"]


@pytest.mark.django_db
def test_vencimento_altera_a_que_tem_baixa_parcial(pelada):
    """Mudar a data não mexe em dinheiro já recebido — só no prazo do que
    falta."""
    org, players, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    parcial = Charge.objects.get(player=players[0])
    register_payment(charge=parcial, amount=Decimal("40.00"), registered_by=user)

    resultado = bulk_change_due_date(organization=org, due_day=10, charge_ids=_ids(org))

    parcial.refresh_from_db()
    assert parcial.due_date == datetime.date(2026, 8, 10)
    assert parcial.paid_amount == Decimal("40.00")
    assert resultado["processed_count"] == 5


@pytest.mark.django_db
def test_vencimento_pula_a_cancelada(pelada):
    org, players, _ = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    Charge.objects.filter(player=players[0]).update(status=Charge.Status.CANCELED)

    resultado = bulk_change_due_date(organization=org, due_day=10, charge_ids=_ids(org))

    assert resultado["processed_count"] == 4
    assert [linha["reason"] for linha in resultado["skipped"]] == ["cancelada"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("reference", "dia", "esperado"),
    [
        ("2026-02", 31, datetime.date(2026, 2, 28)),
        ("2024-02", 31, datetime.date(2024, 2, 29)),
        ("2026-04", 31, datetime.date(2026, 4, 30)),
    ],
)
def test_vencimento_resolve_o_dia_contra_a_competencia(pelada, reference, dia, esperado):
    """"Dia 31" não é uma data: é resolvido contra o mês de cada cobrança."""
    org, _, _ = pelada
    generate_charges_for(organization=org, reference=reference)

    bulk_change_due_date(organization=org, due_day=dia, charge_ids=_ids(org))

    assert set(
        Charge.objects.filter(reference=reference).values_list("due_date", flat=True)
    ) == {esperado}


@pytest.mark.django_db
def test_adiar_o_vencimento_remove_a_multa(pelada):
    """Consequência intencional da regra da multa (§14.4.1) — travada aqui
    para não virar surpresa.

    As datas saem de **hoje**, não de constantes: uma cobrança vencida ontem e
    adiada para hoje deixa de estar atrasada em qualquer dia do mês em que a
    suíte rodar. Constantes fixas fariam este teste passar em agosto e falhar
    em setembro."""
    org, players, _ = pelada
    hoje = timezone.localdate()
    competencia = f"{hoje.year}-{hoje.month:02d}"
    generate_charges_for(organization=org, reference=competencia)
    charge = Charge.objects.get(player=players[0])
    # Vencida ontem.
    Charge.objects.filter(reference=competencia).update(
        due_date=hoje - datetime.timedelta(days=1)
    )
    charge.refresh_from_db()
    assert charge.late_fee_due == Decimal("10.00")

    resultado = bulk_change_due_date(
        organization=org, due_day=hoje.day, charge_ids=_ids(org)
    )

    charge.refresh_from_db()
    # Vence hoje: ainda não atrasou.
    assert charge.late_fee_due == Decimal("0.00")
    assert resultado["processed"][0]["lost_late_fee"] is True


@pytest.mark.django_db
def test_dia_invalido_e_recusado(pelada):
    org, _, _ = pelada

    with pytest.raises(DomainError, match="entre 1 e 31"):
        bulk_change_due_date(organization=org, due_day=45, charge_ids=[1])


@pytest.mark.django_db
def test_vencimento_audita_quantas_perderam_a_multa(pelada):
    org, _, user = pelada
    hoje = timezone.localdate()
    competencia = f"{hoje.year}-{hoje.month:02d}"
    generate_charges_for(organization=org, reference=competencia)
    Charge.objects.filter(reference=competencia).update(
        due_date=hoje - datetime.timedelta(days=1)
    )

    bulk_change_due_date(
        organization=org, due_day=hoje.day, charge_ids=_ids(org), performed_by=user
    )

    log = AuditLog.objects.get(action=AuditLog.Action.CHARGES_DUE_DATE_CHANGED)
    assert log.after["updated"] == 5
    assert log.after["lost_late_fee"] == 5
    assert log.after["due_dates"] == [str(hoje)]


# ===========================================================================
# Baixa em massa
# ===========================================================================


@pytest.mark.django_db
def test_baixa_em_massa_quita_todas(pelada):
    org, _, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    ids = list(Charge.objects.values_list("id", flat=True))

    resultado = bulk_register_payments(
        organization=org, charge_ids=ids, paid_at=datetime.date(2026, 8, 10), registered_by=user
    )

    assert resultado["processed_count"] == 5
    assert Charge.objects.filter(status=Charge.Status.PAID).count() == 5


@pytest.mark.django_db
def test_baixa_em_massa_cobra_o_total_de_cada_um(pelada):
    """Não é um valor único aplicado a todos: quem paga 150 recebe baixa de
    150, quem paga 90 recebe de 90."""
    org, players, user = pelada
    set_player_fee(
        organization=org, player=players[0], amount=Decimal("150.00"), effective_from=REFERENCIA
    )
    generate_charges_for(organization=org, reference=REFERENCIA)
    ids = list(Charge.objects.values_list("id", flat=True))

    bulk_register_payments(
        organization=org, charge_ids=ids, paid_at=datetime.date(2026, 8, 10), registered_by=user
    )

    assert Payment.objects.get(charge__player=players[0]).amount == Decimal("150.00")
    assert Payment.objects.get(charge__player=players[1]).amount == VALOR


@pytest.mark.django_db
def test_baixa_em_massa_inclui_a_multa(pelada):
    org, _, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    ids = list(Charge.objects.values_list("id", flat=True))

    resultado = bulk_register_payments(
        organization=org, charge_ids=ids, paid_at=datetime.date(2026, 8, 20), registered_by=user
    )

    # Vencimento 15/08, pagamento em 20/08: 90 + 10 de multa.
    assert resultado["processed"][0]["amount"] == "100.00"
    assert resultado["processed"][0]["late_fee"] == "10.00"
    assert Charge.objects.filter(status=Charge.Status.PAID).count() == 5


@pytest.mark.django_db
def test_baixa_em_massa_pula_a_ja_paga(pelada):
    """É o que torna a baixa duplicada impossível."""
    org, players, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    paga = Charge.objects.get(player=players[0])
    register_payment(charge=paga, amount=paga.total_due, registered_by=user)
    ids = list(Charge.objects.values_list("id", flat=True))

    resultado = bulk_register_payments(
        organization=org, charge_ids=ids, paid_at=datetime.date(2026, 8, 10), registered_by=user
    )

    assert resultado["processed_count"] == 4
    assert [linha["reason"] for linha in resultado["skipped"]] == ["já paga"]
    assert Payment.objects.filter(charge=paga).count() == 1


@pytest.mark.django_db
def test_repetir_o_lote_nao_duplica_nada(pelada):
    org, _, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    ids = list(Charge.objects.values_list("id", flat=True))
    bulk_register_payments(organization=org, charge_ids=ids, registered_by=user)

    segunda = bulk_register_payments(organization=org, charge_ids=ids, registered_by=user)

    assert segunda["processed_count"] == 0
    assert segunda["skipped_count"] == 5
    assert Payment.objects.count() == 5


@pytest.mark.django_db
def test_baixa_em_massa_completa_o_que_falta(pelada):
    """Com baixa parcial já lançada, a de massa cobra só a diferença."""
    org, players, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    parcial = Charge.objects.get(player=players[0])
    register_payment(
        charge=parcial, amount=Decimal("40.00"), paid_at=datetime.date(2026, 8, 10), registered_by=user
    )

    bulk_register_payments(
        organization=org,
        charge_ids=[parcial.id],
        paid_at=datetime.date(2026, 8, 10),
        registered_by=user,
    )

    parcial.refresh_from_db()
    assert parcial.status == Charge.Status.PAID
    assert parcial.paid_amount == VALOR
    assert Payment.objects.filter(charge=parcial).count() == 2


@pytest.mark.django_db
def test_baixa_em_massa_pula_a_cancelada(pelada):
    org, players, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    Charge.objects.filter(player=players[0]).update(status=Charge.Status.CANCELED)
    ids = list(Charge.objects.values_list("id", flat=True))

    resultado = bulk_register_payments(organization=org, charge_ids=ids, registered_by=user)

    assert resultado["processed_count"] == 4
    assert [linha["reason"] for linha in resultado["skipped"]] == ["cancelada"]


@pytest.mark.django_db
def test_uma_cobranca_problematica_nao_derruba_as_boas(pelada):
    """A razão de o lote não ser atômico."""
    org, players, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    Charge.objects.filter(player=players[0]).update(status=Charge.Status.CANCELED)
    ids = list(Charge.objects.values_list("id", flat=True))

    bulk_register_payments(organization=org, charge_ids=ids, registered_by=user)

    assert Payment.objects.count() == 4


@pytest.mark.django_db
def test_baixa_de_outra_organizacao_e_ignorada(pelada):
    org, _, user = pelada
    outra = MembershipFactory().organization
    forasteiro = PlayerFactory(
        organization=outra, primary_position=PositionFactory(organization=outra)
    )
    alheia = Charge.objects.create(
        organization=outra,
        player=forasteiro,
        reference=REFERENCIA,
        amount=VALOR,
        due_date=datetime.date(2026, 8, 15),
    )

    resultado = bulk_register_payments(
        organization=org, charge_ids=[alheia.id], registered_by=user
    )

    assert resultado["total"] == 0
    alheia.refresh_from_db()
    assert alheia.status == Charge.Status.PENDING


@pytest.mark.django_db
def test_baixa_em_massa_audita_o_lote_e_cada_uma(pelada):
    org, _, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    ids = list(Charge.objects.values_list("id", flat=True))

    bulk_register_payments(
        organization=org, charge_ids=ids, paid_at=datetime.date(2026, 8, 20), registered_by=user
    )

    lote = AuditLog.objects.get(action=AuditLog.Action.PAYMENT_BULK_REGISTERED)
    assert lote.after["registered"] == 5
    assert lote.after["total"] == "500.00"  # 5 × (90 + 10 de multa)
    assert lote.after["late_fees"] == "50.00"
    assert AuditLog.objects.filter(action=AuditLog.Action.PAYMENT_REGISTERED).count() == 5


@pytest.mark.django_db
def test_selecao_vazia_e_recusada(pelada):
    org, _, _ = pelada

    with pytest.raises(DomainError, match="Nenhuma mensalidade selecionada"):
        bulk_register_payments(organization=org, charge_ids=[])


# ===========================================================================
# Endpoints e permissões
# ===========================================================================


@pytest.mark.django_db
def test_endpoint_gerar(pelada):
    org, _, user = pelada

    response = cliente(user, org).post(
        "/api/finance/charges/generate-for/", {"reference": REFERENCIA}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["processed_count"] == 5


@pytest.mark.django_db
def test_endpoint_vencimento(pelada):
    org, _, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)

    response = cliente(user, org).post(
        "/api/finance/charges/bulk-due-date/",
        {"due_day": 10, "charge_ids": _ids(org)},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["processed_count"] == 5


@pytest.mark.django_db
def test_endpoint_baixa(pelada):
    org, _, user = pelada
    generate_charges_for(organization=org, reference=REFERENCIA)
    ids = list(Charge.objects.values_list("id", flat=True))

    response = cliente(user, org).post(
        "/api/finance/charges/bulk-register-payment/",
        {"charge_ids": ids, "paid_at": "2026-08-10"},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["processed_count"] == 5


@pytest.mark.django_db
@pytest.mark.parametrize(
    "rota",
    [
        "/api/finance/charges/generate-for/",
        "/api/finance/charges/bulk-due-date/",
        "/api/finance/charges/bulk-register-payment/",
    ],
)
def test_jogador_nao_executa_operacao_em_massa(pelada, rota):
    org, _, _ = pelada
    from common.permissions import ROLE_JOGADOR

    jogador = UserFactory(username="so_joga")
    MembershipFactory(user=jogador, organization=org, role=ROLE_JOGADOR)

    response = cliente(jogador, org).post(rota, {"reference": REFERENCIA}, format="json")

    assert response.status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize(
    "rota",
    [
        "/api/finance/charges/generate-for/",
        "/api/finance/charges/bulk-due-date/",
        "/api/finance/charges/bulk-register-payment/",
    ],
)
def test_visualizador_nao_executa_operacao_em_massa(pelada, rota):
    org, _, _ = pelada
    from common.permissions import ROLE_VISUALIZADOR

    espectador = UserFactory(username="so_olha")
    MembershipFactory(user=espectador, organization=org, role=ROLE_VISUALIZADOR)

    response = cliente(espectador, org).post(rota, {"reference": REFERENCIA}, format="json")

    assert response.status_code == 403


@pytest.mark.django_db
def test_ids_de_outra_organizacao_no_recorte_sao_ignorados(pelada):
    """O isolamento não depende de o cliente mandar a coisa certa."""
    org, _, user = pelada
    outra = MembershipFactory().organization
    forasteiro = PlayerFactory(
        organization=outra, primary_position=PositionFactory(organization=outra)
    )

    response = cliente(user, org).post(
        "/api/finance/charges/generate-for/",
        {"reference": REFERENCIA, "player_ids": [forasteiro.id]},
        format="json",
    )

    assert response.status_code == 400
    assert Charge.objects.filter(organization=outra).count() == 0


@pytest.mark.django_db
def test_vencimento_de_selecao_que_cruza_competencias(pelada):
    """Cada cobrança recebe o dia 10 **do seu próprio mês**.

    Era o motivo de a operação receber cobranças em vez de jogadores: com uma
    competência única no parâmetro, uma seleção de julho e agosto sairia toda
    com a mesma data."""
    org, _, _ = pelada
    generate_charges_for(organization=org, reference="2026-07")
    generate_charges_for(organization=org, reference="2026-08")

    bulk_change_due_date(organization=org, due_day=10, charge_ids=_ids(org))

    assert set(
        Charge.objects.filter(reference="2026-07").values_list("due_date", flat=True)
    ) == {datetime.date(2026, 7, 10)}
    assert set(
        Charge.objects.filter(reference="2026-08").values_list("due_date", flat=True)
    ) == {datetime.date(2026, 8, 10)}
