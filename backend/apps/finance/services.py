"""Regras do financeiro.

O ponto de entrada de dinheiro é um só (`register_payment`): é ele que grava o
recebimento, decide se a cobrança quitou e audita. Nenhuma view mexe em
`Charge.status` por fora — foi assim que `TeamResult` deixou de aceitar
"vitória com 0 gol" vinda do cliente.

Quatro invariantes atravessam este módulo:

1. **Competência é do lançamento, não do caixa.** `Charge.reference` manda; a
   data do pagamento nunca reclassifica a competência.
2. **Valor histórico é imutável.** Alterar a mensalidade cria uma vigência nova
   (`PlayerMonthlyFee`) a partir de uma competência; as `Charge` já geradas
   ficam como estão.
3. **Nada é destruído.** Cancelar baixa muda o estado do `Payment` e registra
   quem/quando/por quê — nunca apaga.
4. **Toda operação relevante audita**, com `entity`/`entity_id` apontando para o
   registro afetado — é o que permite reconstruir a linha do tempo depois.
"""

import calendar
import uuid
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.audit.models import AuditLog
from apps.audit.services import log_action
from apps.players.models import Player
from common.exceptions import DomainError

from .models import (
    Charge,
    Expense,
    MembershipFeePlan,
    Payment,
    PlayerMonthlyFee,
    RecurringExpense,
)

#: Nomes das entidades na auditoria. Strings soltas espalhadas pelo módulo
#: viram divergência silenciosa na hora de consultar a trilha.
ENTITY_CHARGE = "charge"
ENTITY_PAYMENT = "payment"
ENTITY_FEE = "player_monthly_fee"
ENTITY_EXPENSE = "expense"
ENTITY_PLAN = "membership_fee_plan"

#: Zero com as duas casas. `Decimal("0")` e `Decimal("0.00")` são iguais em
#: valor mas viram `"0"` e `"0.00"` na trilha — e dinheiro escrito de dois
#: jeitos diferentes no mesmo histórico é o começo de alguém desconfiar do
#: registro.
ZERO = Decimal("0.00")


def _money(value) -> str:
    """Dinheiro para a auditoria, sempre com duas casas."""
    return str(Decimal(value).quantize(ZERO))


# ---------------------------------------------------------------------------
# Competência
# ---------------------------------------------------------------------------


def _reference_for(moment: date) -> str:
    """Competência (`AAAA-MM`) de uma data."""
    return f"{moment.year}-{moment.month:02d}"


def current_reference() -> str:
    return _reference_for(timezone.localdate())


def validate_reference(reference: str) -> str:
    """Aceita só `AAAA-MM` com mês válido.

    A competência é comparada como **string** em todo o módulo (`"2026-04" <=
    "2026-05"`), o que só funciona porque o formato é fixo e zero-padded. Um
    `"2026-5"` entrando no banco quebraria essa ordenação em silêncio — daí a
    validação viver aqui, no único caminho de entrada."""
    partes = str(reference).split("-")
    if len(partes) != 2 or len(partes[0]) != 4 or len(partes[1]) != 2:
        raise DomainError(f"Competência inválida: “{reference}”. Use o formato AAAA-MM.")
    try:
        ano, mes = int(partes[0]), int(partes[1])
    except ValueError:
        raise DomainError(f"Competência inválida: “{reference}”. Use o formato AAAA-MM.") from None
    if not 1 <= mes <= 12:
        raise DomainError(f"Competência inválida: “{reference}”. O mês precisa estar entre 01 e 12.")
    if ano < 2000:
        raise DomainError(f"Competência inválida: “{reference}”.")
    return f"{ano:04d}-{mes:02d}"


def _due_date_for(reference: str, due_day: int) -> date:
    """Vencimento da competência, tolerando mês curto.

    Dia 31 num mês de 30 (ou fevereiro) cairia em `ValueError`; o vencimento
    escorrega para o último dia do mês, que é o comportamento que o organizador
    espera de "todo dia 31"."""
    ano, mes = (int(parte) for parte in reference.split("-"))
    ultimo_dia = calendar.monthrange(ano, mes)[1]
    return date(ano, mes, min(due_day, ultimo_dia))


# ---------------------------------------------------------------------------
# Valor da mensalidade por jogador
# ---------------------------------------------------------------------------


def active_fee_plan(organization) -> MembershipFeePlan | None:
    return MembershipFeePlan.objects.filter(organization=organization, is_active=True).first()


def fee_amount_for(player: Player, reference: str, *, plan: MembershipFeePlan | None = None):
    """Quanto **este jogador** paga **nesta competência**.

    Vale a vigência mais recente que já começou (`effective_from <=
    reference`); não havendo nenhuma, cai no valor do plano da organização.
    A comparação é lexicográfica, o que é correto para `AAAA-MM` zero-padded.

    É esta função que faz a alteração de valor não ser retroativa: perguntar
    "quanto era em abril?" devolve o valor vigente em abril, mesmo depois de o
    jogador passar a pagar outro valor em maio.
    """
    vigencia = (
        PlayerMonthlyFee.objects.filter(player=player, effective_from__lte=reference)
        .order_by("-effective_from")
        .first()
    )
    if vigencia is not None:
        return vigencia.amount
    if plan is None:
        plan = active_fee_plan(player.organization)
    return plan.amount if plan is not None else None


#: Campos do plano cuja alteração muda o que a organização cobra. Ficam numa
#: constante porque a auditoria e a comparação precisam da mesma lista — uma
#: divergência aqui produziria uma trilha que esquece justamente o que mudou.
PLAN_AUDITED_FIELDS = ("name", "amount", "due_day", "late_fee_amount", "is_active")
#: Quais deles são dinheiro, e por isso precisam das duas casas na trilha.
PLAN_MONEY_FIELDS = ("amount", "late_fee_amount")


@transaction.atomic
def update_fee_plan(*, plan: MembershipFeePlan, performed_by=None, **campos) -> MembershipFeePlan:
    """Altera o contrato da organização (valor base, vencimento, multa).

    Passa a existir como serviço porque o `ModelViewSet` gravava direto: mudar
    o dia do vencimento ou a multa não deixava rastro nenhum, e são justamente
    as duas coisas que alguém vai querer conferir quando uma cobrança vier
    diferente do esperado.

    **Não** mexe em nenhuma cobrança já lançada — elas carregam valor,
    vencimento e multa congelados. Aumentar a multa hoje não cria dívida em
    competência nenhuma do passado.
    """
    def instantaneo() -> dict[str, str]:
        return {
            campo: _money(getattr(plan, campo)) if campo in PLAN_MONEY_FIELDS
            else str(getattr(plan, campo))
            for campo in PLAN_AUDITED_FIELDS
        }

    before = instantaneo()

    for campo, valor in campos.items():
        if campo in PLAN_AUDITED_FIELDS and valor is not None:
            setattr(plan, campo, valor)

    if plan.amount is not None and plan.amount <= 0:
        raise DomainError("O valor da mensalidade precisa ser maior que zero.")
    if plan.late_fee_amount is not None and plan.late_fee_amount < 0:
        raise DomainError("A multa não pode ser negativa. Use zero para não cobrar multa.")
    if not 1 <= plan.due_day <= 31:
        raise DomainError("O dia do vencimento precisa estar entre 1 e 31.")

    plan.save()
    after = instantaneo()

    if before != after:
        log_action(
            organization=plan.organization,
            action=AuditLog.Action.FEE_PLAN_CHANGED,
            user=performed_by,
            entity=ENTITY_PLAN,
            entity_id=plan.id,
            # Só o que mudou: um `before`/`after` com os cinco campos sempre
            # obrigaria quem lê a trilha a comparar coluna por coluna.
            before={campo: before[campo] for campo in before if before[campo] != after[campo]},
            after={campo: after[campo] for campo in after if before[campo] != after[campo]},
        )
    return plan


def current_fee_for(player: Player, *, plan: MembershipFeePlan | None = None):
    """Valor vigente hoje — o "Mensalidade atual" da tela."""
    return fee_amount_for(player, current_reference(), plan=plan)


def fee_history(player: Player):
    """Todas as vigências do jogador, da mais recente para a mais antiga."""
    return PlayerMonthlyFee.objects.filter(player=player).select_related("created_by")


@transaction.atomic
def set_player_fee(
    *,
    organization,
    player: Player,
    amount: Decimal,
    effective_from: str,
    reason: str = "",
    performed_by=None,
    batch: uuid.UUID | None = None,
) -> PlayerMonthlyFee:
    """Define o valor da mensalidade de um jogador a partir de uma competência.

    **Não** é um `UPDATE` no valor anterior: cria (ou substitui) a vigência
    daquela competência e deixa as anteriores intactas — junto com todas as
    cobranças já geradas, que carregam o valor congelado.

    Alterar duas vezes a **mesma** competência sobrescreve a vigência (é
    correção, não histórico novo) — mas o valor antigo fica registrado na
    auditoria com `before`/`after`, então nada se perde.
    """
    if player.organization_id != organization.id:
        raise DomainError("Este jogador não pertence a esta organização.")
    if player.player_type != Player.PlayerType.MENSALISTA:
        raise DomainError(f"{player.name} não é mensalista — só mensalistas têm mensalidade.")
    if amount is None or amount <= 0:
        raise DomainError("O valor da mensalidade precisa ser maior que zero.")

    effective_from = validate_reference(effective_from)
    anterior = PlayerMonthlyFee.objects.filter(
        player=player, effective_from=effective_from
    ).first()
    valor_anterior = fee_amount_for(player, effective_from)

    if anterior is not None:
        anterior.amount = amount
        anterior.reason = reason
        anterior.batch = batch
        anterior.created_by = performed_by
        anterior.save(update_fields=["amount", "reason", "batch", "created_by", "updated_at"])
        fee = anterior
    else:
        fee = PlayerMonthlyFee.objects.create(
            organization=organization,
            player=player,
            amount=amount,
            effective_from=effective_from,
            reason=reason,
            batch=batch,
            created_by=performed_by,
        )

    log_action(
        organization=organization,
        action=AuditLog.Action.FEE_CHANGED,
        player=player,
        user=performed_by,
        entity=ENTITY_FEE,
        entity_id=fee.id,
        before={"amount": str(valor_anterior) if valor_anterior is not None else None},
        after={
            "amount": str(amount),
            "effective_from": effective_from,
            "batch": str(batch) if batch else None,
        },
        reason=reason,
    )
    return fee


def mensalistas_of(organization):
    """Quem tem mensalidade: mensalista ativo e não temporário.

    O convidado da lista colada (`is_temporary`) existe só para o sorteio de uma
    partida — cobrar mensalidade dele seria absurdo."""
    return Player.objects.filter(
        organization=organization,
        player_type=Player.PlayerType.MENSALISTA,
        status=Player.Status.ATIVO,
        is_temporary=False,
    ).order_by("name")


@transaction.atomic
def bulk_set_player_fees(
    *,
    organization,
    players: list[Player] | None,
    amount: Decimal,
    effective_from: str,
    reason: str = "",
    performed_by=None,
) -> dict:
    """Altera a mensalidade de vários (ou de todos os) mensalistas de uma vez.

    `players=None` significa "todos os mensalistas ativos da organização" — a
    lista é resolvida **aqui**, não no cliente, para que a operação não dependa
    de o navegador ter carregado a página inteira.

    Toda a operação compartilha um `batch` (UUID): é o identificador que a
    auditoria usa depois para responder "o que aquela alteração de 87
    mensalistas fez, exatamente". Cada jogador ainda gera seu próprio registro
    `fee_changed` — o do lote é um resumo, não um substituto.
    """
    effective_from = validate_reference(effective_from)
    if amount is None or amount <= 0:
        raise DomainError("O valor da mensalidade precisa ser maior que zero.")

    alvos = list(players) if players is not None else list(mensalistas_of(organization))
    if not alvos:
        raise DomainError("Nenhum mensalista selecionado para a alteração.")

    for player in alvos:
        if player.organization_id != organization.id:
            raise DomainError("A seleção contém jogador de outra organização.")

    batch = uuid.uuid4()
    anteriores = {
        player.id: fee_amount_for(player, effective_from) for player in alvos
    }

    for player in alvos:
        set_player_fee(
            organization=organization,
            player=player,
            amount=amount,
            effective_from=effective_from,
            reason=reason,
            performed_by=performed_by,
            batch=batch,
        )

    valores_anteriores = sorted(
        {str(valor) for valor in anteriores.values() if valor is not None}
    )
    log_action(
        organization=organization,
        action=AuditLog.Action.FEE_BULK_CHANGED,
        user=performed_by,
        entity=ENTITY_FEE,
        before={
            "players_count": len(alvos),
            # Um lote pode partir de valores diferentes (nem todo mundo pagava o
            # mesmo). Guardar o conjunto é honesto; guardar "o valor anterior"
            # no singular seria mentira em metade dos casos.
            "amounts": valores_anteriores,
        },
        after={
            "batch": str(batch),
            "amount": str(amount),
            "effective_from": effective_from,
            "players_count": len(alvos),
            "player_ids": [player.id for player in alvos],
        },
        reason=reason,
    )

    return {
        "batch": str(batch),
        "players_count": len(alvos),
        "amount": str(amount),
        "effective_from": effective_from,
        "previous_amounts": valores_anteriores,
    }


def bulk_change_preview(*, organization, players: list[Player] | None, effective_from: str) -> dict:
    """O que a tela mostra **antes** de confirmar uma alteração em massa.

    Existe para que a confirmação seja específica ("87 mensalistas, de R$ 100,00
    para R$ 120,00, a partir de Maio/2026") em vez de genérica ("tem certeza?").
    Nenhum dado é alterado aqui."""
    effective_from = validate_reference(effective_from)
    alvos = list(players) if players is not None else list(mensalistas_of(organization))
    valores = [fee_amount_for(player, effective_from) for player in alvos]
    distintos = sorted({str(valor) for valor in valores if valor is not None})

    return {
        "players_count": len(alvos),
        "effective_from": effective_from,
        "current_amounts": distintos,
        # Já lançadas nesta competência: a alteração **não** as toca, e a tela
        # precisa dizer isso em vez de deixar o organizador descobrir depois.
        "already_charged": Charge.objects.filter(
            organization=organization,
            player__in=alvos,
            reference=effective_from,
        ).count(),
    }


# ---------------------------------------------------------------------------
# Operações em massa
# ---------------------------------------------------------------------------
#
# Três operações, uma regra comum: **cada registro é tratado por si**.
#
# Um lote atômico faria uma mensalidade problemática desfazer dezessete baixas
# boas — o oposto do que o organizador quer quando seleciona meia pelada e
# clica em "dar baixa". Então nenhuma delas é `@transaction.atomic` no lote;
# cada item já é atômico na operação individual que o executa.
#
# E todas devolvem o mesmo formato: o que foi processado, o que foi pulado e
# **por quê**. "3 de 5 processadas" sem dizer o que houve com as outras duas é
# o tipo de resposta que obriga a conferir tudo na mão.


def _as_date(value) -> date | None:
    """Aceita `date` ou `"AAAA-MM-DD"`.

    O JSON não tem tipo data: o que chega da API é string, e comparar string
    com `date` levanta `TypeError` na hora de decidir a multa. A conversão fica
    **aqui**, na fronteira do serviço, e não em cada view — do contrário a
    próxima rota a chamar esta função repetiria o mesmo esquecimento.
    """
    if value is None or isinstance(value, date):
        return value
    convertida = parse_date(str(value))
    if convertida is None:
        raise DomainError(f"Data inválida: “{value}”. Use o formato AAAA-MM-DD.")
    return convertida


def _mass_result(processados: list[dict], pulados: list[dict], **extra) -> dict:
    return {
        "processed": processados,
        "skipped": pulados,
        "processed_count": len(processados),
        "skipped_count": len(pulados),
        "total": len(processados) + len(pulados),
        **extra,
    }


def _skip(player, motivo: str, **extra) -> dict:
    return {"player_id": player.id, "player_name": player.name, "reason": motivo, **extra}


def generate_charges_for(
    *,
    organization,
    reference: str | None = None,
    players: list[Player] | None = None,
    performed_by=None,
) -> dict:
    """Lança a mensalidade da competência para os mensalistas escolhidos.

    `players=None` significa **todos os mensalistas ativos** — e a lista é
    resolvida aqui, no servidor, não no navegador: a operação não pode depender
    de a tela ter carregado a pelada inteira.

    Idempotente, como `generate_recurring_charges`: quem já tem mensalidade
    naquela competência é **pulado**, não é erro. Rodar duas vezes não cobra
    ninguém em dobro.

    A diferença para `generate_recurring_charges` é o recorte e o retorno: esta
    responde "42 criadas, 8 já possuíam", que é o que a tela precisa mostrar.
    """
    reference = validate_reference(reference or current_reference())
    plan = active_fee_plan(organization)
    if plan is None:
        raise DomainError(
            "Nenhum plano de mensalidade ativo. Configure o plano antes de gerar as mensalidades."
        )

    alvos = list(players) if players is not None else list(mensalistas_of(organization))
    if not alvos:
        raise DomainError("Nenhum mensalista selecionado.")

    for player in alvos:
        if player.organization_id != organization.id:
            raise DomainError("A seleção contém jogador de outra organização.")

    ja_lancados = set(
        Charge.objects.filter(
            organization=organization, reference=reference, player__in=alvos
        ).values_list("player_id", flat=True)
    )

    criadas, pulados = [], []
    for player in alvos:
        if player.id in ja_lancados:
            pulados.append(_skip(player, "já possui mensalidade nesta competência"))
            continue
        amount = fee_amount_for(player, reference, plan=plan)
        if amount is None or amount <= 0:
            pulados.append(_skip(player, "sem valor de mensalidade definido"))
            continue

        charge = create_charge(
            organization=organization,
            player=player,
            reference=reference,
            amount=amount,
            late_fee_amount=plan.late_fee_amount,
            due_date=_due_date_for(reference, plan.due_day),
            plan=plan,
            performed_by=performed_by,
        )
        criadas.append(
            {
                "player_id": player.id,
                "player_name": player.name,
                "charge_id": charge.id,
                "amount": _money(charge.amount),
                "due_date": str(charge.due_date),
            }
        )

    if criadas:
        log_action(
            organization=organization,
            action=AuditLog.Action.CHARGES_GENERATED,
            user=performed_by,
            entity=ENTITY_CHARGE,
            after={
                "reference": reference,
                "created": len(criadas),
                "skipped": len(pulados),
                "plan_id": plan.id,
                "due_day": plan.due_day,
                "late_fee_amount": _money(plan.late_fee_amount),
                # Distingue "gerei o mês inteiro" de "gerei para estes cinco".
                "scope": "all" if players is None else "selection",
            },
        )

    return _mass_result(criadas, pulados, reference=reference)


def bulk_change_due_date(
    *,
    organization,
    due_day: int,
    charge_ids: list[int],
    reason: str = "",
    performed_by=None,
) -> dict:
    """Muda o dia de vencimento das mensalidades escolhidas.

    Recebe **cobranças**, não jogadores: é o que a tela seleciona, e evita a
    tradução "jogador → cobrança daquela competência" que só funcionaria
    enquanto a seleção não cruzasse competências.

    O pedido é "vencimento dia 10", mas `Charge.due_date` é uma **data**: o dia
    é resolvido contra a competência **de cada cobrança**, com o mesmo
    `_due_date_for` da geração — que já faz o dia 31 escorregar para o último
    dia em fevereiro. Uma seleção que misture julho e agosto sai com o dia 10
    de cada mês, não com uma data única.

    Cobrança **paga** e **cancelada** ficam de fora. Cobrança com baixa parcial
    é alterada: mudar a data não mexe em dinheiro nenhum já recebido, só no
    prazo do que falta.

    Efeito colateral relevante e **intencional**: adiar o vencimento de uma
    cobrança atrasada faz a multa deixar de incidir (`REGRAS_DE_NEGOCIO.md`
    §14.4.1). O resultado marca quais perderam a multa, para a tela avisar.
    """
    if not 1 <= due_day <= 31:
        raise DomainError("O dia do vencimento precisa estar entre 1 e 31.")
    if not charge_ids:
        raise DomainError("Nenhuma mensalidade selecionada.")

    alteradas, pulados = [], []
    charges = (
        Charge.objects.filter(organization=organization, id__in=charge_ids)
        .select_related("player")
        .prefetch_related("payments")
        .order_by("player__name")
    )

    for charge in charges:
        if charge.status == Charge.Status.PAID:
            pulados.append(_skip(charge.player, "já paga", charge_id=charge.id))
            continue
        if charge.status == Charge.Status.CANCELED:
            pulados.append(_skip(charge.player, "cancelada", charge_id=charge.id))
            continue

        nova_data = _due_date_for(charge.reference, due_day)
        if charge.due_date == nova_data:
            continue  # já está no dia pedido

        anterior = charge.due_date
        multa_antes = charge.late_fee_due
        update_charge(charge=charge, due_date=nova_data, performed_by=performed_by)
        charge.refresh_from_db()

        alteradas.append(
            {
                "player_id": charge.player_id,
                "player_name": charge.player.name,
                "charge_id": charge.id,
                "previous_due_date": str(anterior),
                "due_date": str(nova_data),
                "lost_late_fee": multa_antes > 0 and charge.late_fee_due == 0,
            }
        )

    if alteradas:
        log_action(
            organization=organization,
            action=AuditLog.Action.CHARGES_DUE_DATE_CHANGED,
            user=performed_by,
            entity=ENTITY_CHARGE,
            before={
                "due_dates": sorted({linha["previous_due_date"] for linha in alteradas}),
            },
            after={
                "due_day": due_day,
                # Datas no plural: uma seleção pode cruzar competências.
                "due_dates": sorted({linha["due_date"] for linha in alteradas}),
                "updated": len(alteradas),
                "skipped": len(pulados),
                "charge_ids": [linha["charge_id"] for linha in alteradas],
                # Quantas deixaram de ter multa por causa da nova data.
                "lost_late_fee": sum(1 for linha in alteradas if linha["lost_late_fee"]),
            },
            reason=reason,
        )

    return _mass_result(alteradas, pulados, due_day=due_day)


def bulk_register_payments(
    *,
    organization,
    charge_ids: list[int],
    paid_at: date | None = None,
    method: str = Payment.Method.CASH,
    notes: str = "",
    registered_by=None,
) -> dict:
    """Dá baixa em várias mensalidades de uma vez.

    Cada baixa é do **total devido daquela cobrança** — valor mais a multa que
    incidir na data informada, menos o que já tiver sido recebido. Não é um
    valor único aplicado a todas: numa pelada onde um paga 90 e outro 45,
    dividir igual estaria errado nos dois.

    Mensalidade já paga é **pulada**, não é erro: é o que torna impossível a
    baixa duplicada. Repetir o mesmo lote não cria pagamento nenhum.
    """
    if not charge_ids:
        raise DomainError("Nenhuma mensalidade selecionada.")

    data_do_pagamento = _as_date(paid_at) or timezone.localdate()
    charges = (
        Charge.objects.filter(organization=organization, id__in=charge_ids)
        .select_related("player")
        .prefetch_related("payments")
        .order_by("player__name")
    )

    baixadas, pulados = [], []
    for charge in charges:
        if charge.status == Charge.Status.PAID:
            pulados.append(_skip(charge.player, "já paga", charge_id=charge.id))
            continue
        if charge.status == Charge.Status.CANCELED:
            pulados.append(_skip(charge.player, "cancelada", charge_id=charge.id))
            continue

        multa = late_fee_for(charge, on=data_do_pagamento)
        falta = charge.amount + multa - charge.paid_amount
        if falta <= 0:
            pulados.append(_skip(charge.player, "nada a receber", charge_id=charge.id))
            continue

        try:
            payment = register_payment(
                charge=charge,
                amount=falta,
                paid_at=data_do_pagamento,
                method=method,
                notes=notes,
                registered_by=registered_by,
            )
        except DomainError as erro:
            # Uma cobrança problemática não pode derrubar as outras.
            pulados.append(_skip(charge.player, str(erro), charge_id=charge.id))
            continue

        baixadas.append(
            {
                "player_id": charge.player_id,
                "player_name": charge.player.name,
                "charge_id": charge.id,
                "payment_id": payment.id,
                "amount": _money(payment.amount),
                "late_fee": _money(multa),
            }
        )

    if baixadas:
        log_action(
            organization=organization,
            action=AuditLog.Action.PAYMENT_BULK_REGISTERED,
            user=registered_by,
            entity=ENTITY_PAYMENT,
            after={
                "registered": len(baixadas),
                "skipped": len(pulados),
                "paid_at": str(data_do_pagamento),
                "method": method,
                "charge_ids": [linha["charge_id"] for linha in baixadas],
                "total": _money(sum(Decimal(linha["amount"]) for linha in baixadas)),
                "late_fees": _money(sum(Decimal(linha["late_fee"]) for linha in baixadas)),
            },
            reason=notes,
        )

    return _mass_result(baixadas, pulados, paid_at=str(data_do_pagamento))


# ---------------------------------------------------------------------------
# Ressincronização das cobranças em aberto
# ---------------------------------------------------------------------------
#
# O elo que faltava entre "quanto o jogador paga" e "quanto está cobrado".
#
# A alteração de valor nunca foi retroativa, e isso está certo — mas o efeito
# colateral era que a competência **já lançada e ainda em aberto** ficava presa
# no valor antigo, sem nenhum caminho para corrigi-la em lote. O organizador via
# R$ 90,00 numa aba, R$ 45,00 na outra, e concluía que o sistema não tinha
# gravado a alteração.
#
# Isto **não** é uma exceção à imutabilidade do histórico: cobrança paga, com
# baixa parcial ou cancelada nunca entra. Só se mexe no que ninguém pagou ainda
# — que é corrigir antes de cobrar, não reescrever o passado.


def _resync_candidates(*, organization, reference: str, players: list[Player] | None):
    """Separa as cobranças da competência em "dá para atualizar" e "não dá".

    Devolve `(alvos, puladas, elegiveis)`, onde cada alvo é `(charge,
    valor_novo)`, cada pulada é `(charge, motivo)` e `elegiveis` é quantas
    cobranças **poderiam** ser atualizadas — incluindo as que já estão com o
    valor certo.

    Essa terceira contagem existe para a tela: quando o organizador ainda está
    digitando o novo valor, a vigência no banco é a **antiga**, então `alvos`
    vem vazio e prometer "0 mensalidades serão atualizadas" seria mentira. O
    que ele precisa saber é quantas estão em aberto e ao alcance.

    Uma função só porque a prévia e a execução **precisam** enxergar exatamente
    a mesma coisa: se divergirem, a tela promete um número e o servidor faz
    outro.
    """
    charges = (
        Charge.objects.filter(organization=organization, reference=reference)
        .select_related("player")
        .prefetch_related("payments")
        .order_by("player__name")
    )
    if players is not None:
        charges = charges.filter(player__in=players)

    alvos: list[tuple[Charge, Decimal]] = []
    puladas: list[tuple[Charge, str]] = []
    elegiveis = 0

    for charge in charges:
        if charge.status == Charge.Status.CANCELED:
            puladas.append((charge, "cancelada"))
            continue
        if charge.status == Charge.Status.PAID:
            puladas.append((charge, "já paga"))
            continue
        if charge.paid_amount > 0:
            # Pendente, mas com dinheiro já recebido: mudar o valor aqui
            # reescreveria o saldo de uma baixa que já existe.
            puladas.append((charge, "tem baixa parcial lançada"))
            continue

        novo_valor = fee_amount_for(charge.player, reference)
        if novo_valor is None or novo_valor <= 0:
            puladas.append((charge, "sem valor de mensalidade definido"))
            continue

        elegiveis += 1
        if novo_valor == charge.amount:
            continue  # já está correta — não é pulada nem alterada

        alvos.append((charge, novo_valor))

    return alvos, puladas, elegiveis


def _resync_row(charge: Charge, novo_valor: Decimal | None = None, motivo: str = "") -> dict:
    linha = {
        "charge_id": charge.id,
        "player_id": charge.player_id,
        "player_name": charge.player.name,
        "current_amount": str(charge.amount),
    }
    if novo_valor is not None:
        linha["new_amount"] = str(novo_valor)
    if motivo:
        linha["reason"] = motivo
    return linha


def resync_preview(*, organization, reference: str, players: list[Player] | None = None) -> dict:
    """O que a ressincronização faria, sem fazer nada.

    Alimenta tanto a caixa "aplicar às mensalidades em aberto" quanto a
    confirmação — é ela que permite dizer "19 mensalidades de Ago/2026, de
    R$ 45,00 para R$ 90,00" em vez de "tem certeza?"."""
    reference = validate_reference(reference or current_reference())
    alvos, puladas, elegiveis = _resync_candidates(
        organization=organization, reference=reference, players=players
    )
    return {
        "reference": reference,
        "to_update": [_resync_row(charge, valor) for charge, valor in alvos],
        "skipped": [_resync_row(charge, motivo=motivo) for charge, motivo in puladas],
        "to_update_count": len(alvos),
        "skipped_count": len(puladas),
        # Quantas estão **em aberto e ao alcance**, mesmo as que já batem com o
        # valor vigente. É este o número que a tela mostra antes de salvar.
        "eligible_count": elegiveis,
        # De quais valores se está saindo: um lote pode partir de vários.
        "current_amounts": sorted({str(charge.amount) for charge, _ in alvos}),
    }


@transaction.atomic
def resync_pending_charges(
    *,
    organization,
    reference: str,
    players: list[Player] | None = None,
    reason: str = "",
    performed_by=None,
) -> dict:
    """Aplica o valor vigente às cobranças **em aberto** de uma competência.

    Atômica de propósito, ao contrário da baixa em massa: aqui não há operação
    que possa falhar sozinha por situação individual — o que não pode ser
    atualizado já foi separado antes, e o que sobra é um `UPDATE` de valor.
    Metade da competência corrigida seria pior que nenhuma.
    """
    reference = validate_reference(reference or current_reference())
    alvos, puladas, elegiveis = _resync_candidates(
        organization=organization, reference=reference, players=players
    )

    atualizadas = []
    for charge, novo_valor in alvos:
        anterior = str(charge.amount)
        # Passa por `update_charge` em vez de `save()`: é ele que valida e
        # emite o `charge_updated` individual. O registro do lote é um resumo,
        # não um substituto — mesma relação de `fee_bulk_changed` com
        # `fee_changed`.
        update_charge(charge=charge, amount=novo_valor, performed_by=performed_by)
        linha = _resync_row(charge, novo_valor)
        linha["previous_amount"] = anterior
        atualizadas.append(linha)

    if atualizadas:
        log_action(
            organization=organization,
            action=AuditLog.Action.CHARGES_RESYNCED,
            user=performed_by,
            entity=ENTITY_CHARGE,
            before={
                "reference": reference,
                "amounts": sorted({linha["previous_amount"] for linha in atualizadas}),
            },
            after={
                "reference": reference,
                "updated": len(atualizadas),
                "skipped": len(puladas),
                "charge_ids": [linha["charge_id"] for linha in atualizadas],
            },
            reason=reason,
        )

    return {
        "reference": reference,
        "updated": atualizadas,
        "skipped": [_resync_row(charge, motivo=motivo) for charge, motivo in puladas],
        "updated_count": len(atualizadas),
        "skipped_count": len(puladas),
        "eligible_count": elegiveis,
    }


# ---------------------------------------------------------------------------
# Cobrança
# ---------------------------------------------------------------------------


def create_charge(
    *,
    organization,
    player: Player,
    reference: str,
    amount: Decimal,
    due_date: date,
    late_fee_amount: Decimal | None = None,
    plan=None,
    notes: str = "",
    performed_by=None,
) -> Charge:
    """Cria a mensalidade de um jogador numa competência.

    A duplicidade é barrada aqui **e** por constraint no banco: a mesma pessoa
    não pode ter duas mensalidades da mesma competência.

    O `amount` é **congelado** na cobrança: é o que garante que alterar a
    mensalidade do jogador no futuro não reescreva esta competência."""
    if player.organization_id != organization.id:
        raise DomainError("Este jogador não pertence a esta organização.")
    if amount is None or amount <= 0:
        raise DomainError("O valor da mensalidade precisa ser maior que zero.")
    reference = validate_reference(reference)
    if Charge.objects.filter(player=player, reference=reference).exists():
        raise DomainError(f"{player.name} já tem uma mensalidade lançada para {reference}.")

    charge = Charge.objects.create(
        organization=organization,
        player=player,
        plan=plan,
        reference=reference,
        amount=amount,
        # Congelada aqui, como o valor: a multa que vale para esta competência
        # é a que estava combinada quando ela foi lançada.
        late_fee_amount=late_fee_amount if late_fee_amount is not None else Decimal("0"),
        due_date=due_date,
        notes=notes,
    )
    log_action(
        organization=organization,
        action=AuditLog.Action.CHARGE_CREATED,
        player=player,
        user=performed_by,
        entity=ENTITY_CHARGE,
        entity_id=charge.id,
        after={
            "charge_id": charge.id,
            "reference": reference,
            "amount": str(amount),
            "late_fee_amount": str(charge.late_fee_amount),
            "due_date": str(due_date),
        },
    )
    return charge


@transaction.atomic
def update_charge(*, charge: Charge, amount=None, due_date=None, notes=None, performed_by=None):
    """Correção administrativa de uma cobrança (valor, vencimento, observação).

    Existe para o erro de digitação, não para reescrever o passado: a cobrança
    **paga** não aceita mudança de valor — para isso o caminho é cancelar a
    baixa e relançar, que deixa rastro. A alteração é auditada com o antes e o
    depois."""
    if charge.status == Charge.Status.CANCELED:
        raise DomainError("Esta mensalidade está cancelada e não aceita alteração.")

    before = {
        "amount": str(charge.amount),
        "due_date": str(charge.due_date),
        "notes": charge.notes,
    }

    if amount is not None and amount != charge.amount:
        if amount <= 0:
            raise DomainError("O valor da mensalidade precisa ser maior que zero.")
        if charge.paid_amount > 0:
            raise DomainError(
                "Esta mensalidade já tem baixa lançada — cancele a baixa antes de alterar o valor."
            )
        charge.amount = amount
    if due_date is not None:
        charge.due_date = due_date
    if notes is not None:
        charge.notes = notes

    charge.save(update_fields=["amount", "due_date", "notes", "updated_at"])
    _sync_charge_status(charge)

    log_action(
        organization=charge.organization,
        action=AuditLog.Action.CHARGE_UPDATED,
        player=charge.player,
        user=performed_by,
        entity=ENTITY_CHARGE,
        entity_id=charge.id,
        before=before,
        after={
            "amount": str(charge.amount),
            "due_date": str(charge.due_date),
            "notes": charge.notes,
        },
    )
    return charge


def cancel_charge(*, charge: Charge, reason: str = "", performed_by=None) -> Charge:
    """Cancela a cobrança sem apagá-la — o histórico financeiro é auditável."""
    if charge.payments.filter(status=Payment.Status.REGISTERED).exists():
        raise DomainError(
            "Esta mensalidade tem baixa ativa. Cancele a baixa antes de cancelar a mensalidade."
        )
    before = charge.effective_status
    charge.status = Charge.Status.CANCELED
    charge.save(update_fields=["status"])
    log_action(
        organization=charge.organization,
        action=AuditLog.Action.CHARGE_CANCELED,
        player=charge.player,
        user=performed_by,
        entity=ENTITY_CHARGE,
        entity_id=charge.id,
        before={"status": before},
        after={"status": charge.effective_status},
        reason=reason,
    )
    return charge


# ---------------------------------------------------------------------------
# Baixa e estorno
# ---------------------------------------------------------------------------


def late_fee_for(charge: Charge, *, on: date) -> Decimal:
    """A multa que incidiria se o pagamento acontecesse em `on`.

    Função única do cálculo. A regra é deliberadamente simples — valor fixo,
    passou do vencimento incide, não acumula por dia — porque é assim que a
    pelada combina: "passou do dia 8, são mais R$ 10".

    Existe separada de `Charge.late_fee_due` para o chamador poder perguntar
    por uma data **específica** (a do pagamento que está sendo lançado), em vez
    da que a cobrança deduz sozinha.
    """
    if charge.status == Charge.Status.CANCELED or not charge.late_fee_amount:
        return ZERO
    return charge.late_fee_amount if on > charge.due_date else ZERO


def _sync_charge_status(charge: Charge) -> None:
    """Reavalia `pending` x `paid` a partir das baixas **ativas**.

    Fica num lugar só porque duas operações mexem nisso em sentidos opostos
    (baixa e estorno) e a regra tem de ser a mesma nas duas. `overdue` continua
    fora daqui: é derivado, nunca gravado.

    O alvo é `total_due` (valor + multa), não `amount`: com multa devida, quem
    pagou só o valor **não** quitou. Sem multa configurada — o caso de todas as
    organizações até aqui — `total_due` é idêntico a `amount`, e este método se
    comporta exatamente como antes.
    """
    total_ativo = (
        charge.payments.filter(status=Payment.Status.REGISTERED).aggregate(total=Sum("amount"))[
            "total"
        ]
        or Decimal("0")
    )
    # `total_due` deduz a multa das datas das baixas ativas, então precisa ler
    # os pagamentos recém-gravados — não os que estavam em cache.
    charge.refresh_from_db()
    esperado = (
        Charge.Status.PAID if total_ativo >= charge.total_due else Charge.Status.PENDING
    )
    if charge.status != esperado and charge.status != Charge.Status.CANCELED:
        charge.status = esperado
        charge.save(update_fields=["status"])


@transaction.atomic
def register_payment(
    *,
    charge: Charge,
    amount: Decimal,
    paid_at: date | None = None,
    method: str = Payment.Method.CASH,
    notes: str = "",
    registered_by=None,
) -> Payment:
    """Dá baixa (total ou parcial) numa mensalidade.

    A cobrança só vira `paid` quando o acumulado alcança o valor — pagamento em
    partes é normal numa pelada, e marcar como pago no primeiro lançamento
    esconderia o que ainda falta.

    `paid_at` é a data em que o dinheiro entrou e **não** reclassifica a
    competência: a mensalidade de abril paga em 15/05 continua sendo de abril.
    """
    if charge.status == Charge.Status.CANCELED:
        raise DomainError("Esta mensalidade está cancelada e não aceita baixa.")
    if amount <= 0:
        raise DomainError("O valor recebido precisa ser maior que zero.")

    before_status = charge.effective_status
    data_do_pagamento = _as_date(paid_at) or timezone.localdate()
    # A multa é a do **dia em que o dinheiro entrou**, não a de hoje: lançar
    # hoje uma baixa de um pagamento feito em dia não cobra multa nenhuma.
    multa = late_fee_for(charge, on=data_do_pagamento)

    payment = Payment.objects.create(
        organization=charge.organization,
        charge=charge,
        amount=amount,
        paid_at=data_do_pagamento,
        method=method,
        notes=notes,
        registered_by=registered_by,
    )

    _sync_charge_status(charge)
    charge.refresh_from_db()
    total_pago = charge.paid_amount

    log_action(
        organization=charge.organization,
        action=AuditLog.Action.PAYMENT_REGISTERED,
        player=charge.player,
        user=registered_by,
        entity=ENTITY_PAYMENT,
        entity_id=payment.id,
        before={"status": before_status, "paid_amount": str(total_pago - amount)},
        after={
            "status": charge.effective_status,
            "paid_amount": str(total_pago),
            "payment_id": payment.id,
            "charge_id": charge.id,
            "reference": charge.reference,
            "method": method,
            "amount": str(amount),
            "paid_at": str(payment.paid_at),
            # A multa aplicada fica na trilha, não no registro: é o que permite
            # responder "por que este cobrou R$ 110?" sem gravar um estado que
            # poderia sair de sincronia com o cálculo.
            "late_fee": _money(multa),
            "total_due": _money(charge.total_due),
        },
        reason=notes,
    )
    return payment


@transaction.atomic
def cancel_payment(*, payment: Payment, reason: str, cancelled_by=None) -> Payment:
    """Cancela (estorna) uma baixa já lançada.

    O registro **não** é apagado: ele muda de estado e passa a guardar quem
    cancelou, quando e por quê. Apagar destruiria a evidência de que a baixa
    existiu — que é exatamente o que alguém auditando precisa ver.

    O motivo é obrigatório. Um estorno sem motivo é indistinguível de um erro
    operacional seis meses depois."""
    if payment.status == Payment.Status.CANCELED:
        raise DomainError("Esta baixa já está cancelada.")
    if not reason or not reason.strip():
        raise DomainError("Informe o motivo do cancelamento da baixa.")

    charge = payment.charge
    before_status = charge.effective_status
    before_paid = charge.paid_amount

    payment.status = Payment.Status.CANCELED
    payment.cancelled_at = timezone.now()
    payment.cancelled_by = cancelled_by
    payment.cancellation_reason = reason.strip()
    payment.save(
        update_fields=["status", "cancelled_at", "cancelled_by", "cancellation_reason", "updated_at"]
    )

    # A cobrança volta a ficar em aberto se o estorno derrubou o total abaixo do
    # valor devido — inclusive voltando a contar como atrasada, se for o caso.
    charge.refresh_from_db()
    _sync_charge_status(charge)
    charge.refresh_from_db()

    log_action(
        organization=charge.organization,
        action=AuditLog.Action.PAYMENT_CANCELED,
        player=charge.player,
        user=cancelled_by,
        entity=ENTITY_PAYMENT,
        entity_id=payment.id,
        before={
            "status": before_status,
            "paid_amount": str(before_paid),
            "payment_status": Payment.Status.REGISTERED,
        },
        after={
            "status": charge.effective_status,
            "paid_amount": str(charge.paid_amount),
            "payment_status": Payment.Status.CANCELED,
            "payment_id": payment.id,
            "charge_id": charge.id,
            "reference": charge.reference,
            "amount": str(payment.amount),
            "cancelled_at": payment.cancelled_at.isoformat(),
        },
        reason=payment.cancellation_reason,
    )
    return payment


# ---------------------------------------------------------------------------
# Histórico e painel
# ---------------------------------------------------------------------------


def charge_timeline(charge: Charge) -> list[dict]:
    """Linha do tempo de uma competência, montada a partir da **auditoria**.

    A trilha é append-only e já registra cada operação com usuário, data/hora,
    antes/depois e motivo — reconstruir a história a partir dela garante que o
    que a tela mostra é exatamente o que ficou registrado, em vez de uma segunda
    narrativa derivada dos estados atuais (que não sabem o que foi desfeito).
    """
    logs = (
        AuditLog.objects.filter(organization=charge.organization)
        .filter(_timeline_filter(charge))
        .select_related("user")
        .order_by("created_at")
    )
    return [
        {
            "id": log.id,
            "action": log.action,
            "action_display": log.get_action_display(),
            "user": log.user.username if log.user else None,
            "created_at": log.created_at,
            "entity": log.entity,
            "entity_id": log.entity_id,
            "before": log.before,
            "after": log.after,
            "reason": log.reason,
        }
        for log in logs
    ]


def _timeline_filter(charge: Charge) -> Q:
    """Auditoria da cobrança **e** das baixas dela.

    Separado em função para o filtro ficar legível: a linha do tempo de uma
    competência inclui os eventos do pagamento, que apontam para outra entidade.
    """
    payment_ids = list(charge.payments.values_list("id", flat=True))
    return Q(entity=ENTITY_CHARGE, entity_id=charge.id) | Q(
        entity=ENTITY_PAYMENT, entity_id__in=payment_ids
    )


# ---------------------------------------------------------------------------
# Despesas
# ---------------------------------------------------------------------------


def create_expense(
    *,
    organization,
    description: str,
    amount: Decimal,
    reference: str,
    incurred_on: date | None = None,
    due_date: date | None = None,
    kind: str = Expense.Kind.EXTRA,
    recurring: RecurringExpense | None = None,
    notes: str = "",
    performed_by=None,
) -> Expense:
    """Lança uma despesa numa competência.

    O valor fica **congelado** aqui: reajustar o custo fixo depois não reescreve
    o que já foi lançado, exatamente como do lado da receita."""
    if amount is None or amount <= 0:
        raise DomainError("O valor da despesa precisa ser maior que zero.")
    if not description or not description.strip():
        raise DomainError("Informe a descrição da despesa.")
    reference = validate_reference(reference)
    if recurring is not None and recurring.organization_id != organization.id:
        raise DomainError("Este custo fixo não pertence a esta organização.")

    expense = Expense.objects.create(
        organization=organization,
        kind=kind,
        recurring=recurring,
        description=description.strip(),
        amount=amount,
        reference=reference,
        due_date=_as_date(due_date),
        incurred_on=_as_date(incurred_on)
        or _due_date_for(reference, recurring.due_day if recurring else 10),
        notes=notes,
        registered_by=performed_by,
    )
    log_action(
        organization=organization,
        action=AuditLog.Action.EXPENSE_CREATED,
        user=performed_by,
        entity=ENTITY_EXPENSE,
        entity_id=expense.id,
        after={
            "expense_id": expense.id,
            "kind": kind,
            "description": expense.description,
            "amount": str(amount),
            "reference": reference,
            "due_date": str(expense.due_date) if expense.due_date else None,
            "incurred_on": str(expense.incurred_on),
        },
        reason=notes,
    )
    return expense


#: Campos que a edição de despesa alcança. Fora daqui, nada é tocado: `kind` e
#: `recurring` dizem de onde a despesa veio, e reescrevê-los transformaria um
#: custo fixo lançado em outra coisa sem rastro do que era.
EXPENSE_EDITABLE_FIELDS = ("description", "amount", "reference", "due_date", "incurred_on", "notes")


@transaction.atomic
def update_expense(*, expense: Expense, performed_by=None, **campos) -> Expense:
    """Corrige uma despesa já lançada.

    Existe para o erro de digitação — valor trocado, data errada, descrição
    incompleta. Passa a ser serviço porque o `ModelViewSet` gravava direto:
    alterar o valor de uma despesa **não deixava rastro nenhum**, num módulo
    cuja premissa é que toda operação relevante audita.

    Despesa **cancelada** não aceita alteração: ela é histórico do que foi
    lançado e desfeito. Corrigir uma cancelada apagaria o que se quis registrar.
    """
    if expense.status == Expense.Status.CANCELED:
        raise DomainError("Esta despesa está cancelada e não aceita alteração.")

    before = {campo: str(getattr(expense, campo)) for campo in EXPENSE_EDITABLE_FIELDS}

    for campo, valor in campos.items():
        if campo not in EXPENSE_EDITABLE_FIELDS or valor is None:
            continue
        if campo in ("due_date", "incurred_on"):
            valor = _as_date(valor)
        if campo == "reference":
            valor = validate_reference(valor)
        setattr(expense, campo, valor)

    if expense.amount is None or expense.amount <= 0:
        raise DomainError("O valor da despesa precisa ser maior que zero.")
    if not expense.description or not expense.description.strip():
        raise DomainError("Informe a descrição da despesa.")
    expense.description = expense.description.strip()

    expense.save()
    after = {campo: str(getattr(expense, campo)) for campo in EXPENSE_EDITABLE_FIELDS}

    if before != after:
        log_action(
            organization=expense.organization,
            action=AuditLog.Action.EXPENSE_UPDATED,
            user=performed_by,
            entity=ENTITY_EXPENSE,
            entity_id=expense.id,
            # Só o que mudou: cinco campos sempre obrigariam quem lê a trilha a
            # comparar coluna por coluna para achar a alteração.
            before={c: before[c] for c in before if before[c] != after[c]},
            after={c: after[c] for c in after if before[c] != after[c]},
        )
    return expense


@transaction.atomic
def cancel_expense(*, expense: Expense, reason: str, cancelled_by=None) -> Expense:
    """Cancela uma despesa **sem apagá-la**. Motivo obrigatório, mesma regra do
    estorno de baixa: a prestação de contas precisa mostrar o que foi lançado e
    depois desfeito, não um buraco."""
    if expense.status == Expense.Status.CANCELED:
        raise DomainError("Esta despesa já está cancelada.")
    if not reason or not reason.strip():
        raise DomainError("Informe o motivo do cancelamento da despesa.")

    expense.status = Expense.Status.CANCELED
    expense.cancelled_at = timezone.now()
    expense.cancelled_by = cancelled_by
    expense.cancellation_reason = reason.strip()
    expense.save(
        update_fields=["status", "cancelled_at", "cancelled_by", "cancellation_reason", "updated_at"]
    )

    log_action(
        organization=expense.organization,
        action=AuditLog.Action.EXPENSE_CANCELED,
        user=cancelled_by,
        entity=ENTITY_EXPENSE,
        entity_id=expense.id,
        before={"status": Expense.Status.REGISTERED, "amount": str(expense.amount)},
        after={
            "status": Expense.Status.CANCELED,
            "reference": expense.reference,
            "cancelled_at": expense.cancelled_at.isoformat(),
        },
        reason=expense.cancellation_reason,
    )
    return expense


def generate_fixed_expenses(
    *, organization=None, reference: str | None = None, performed_by=None
) -> int:
    """Lança os custos fixos ativos na competência.

    **Idempotente**, como a geração das mensalidades: a constraint
    `(recurring, reference)` impede duplicata no banco e o custo já lançado é
    pulado. Rodar duas vezes no mesmo mês não dobra o aluguel da quadra."""
    from apps.accounts.models import Organization

    reference = validate_reference(reference or current_reference())
    organizations = (
        [organization] if organization is not None else Organization.objects.filter(is_active=True)
    )

    criadas = 0
    for org in organizations:
        ja_lancados = set(
            Expense.objects.filter(
                organization=org, reference=reference, recurring__isnull=False
            ).values_list("recurring_id", flat=True)
        )
        criadas_na_org = 0
        for fixo in RecurringExpense.objects.filter(organization=org, is_active=True):
            if fixo.id in ja_lancados:
                continue
            create_expense(
                organization=org,
                description=fixo.description,
                amount=fixo.amount,
                reference=reference,
                kind=Expense.Kind.FIXED,
                recurring=fixo,
                notes=fixo.notes,
                performed_by=performed_by,
            )
            criadas_na_org += 1

        if criadas_na_org:
            log_action(
                organization=org,
                action=AuditLog.Action.EXPENSES_GENERATED,
                user=performed_by,
                entity=ENTITY_EXPENSE,
                after={"reference": reference, "created": criadas_na_org},
            )
        criadas += criadas_na_org
    return criadas


def expenses_summary(organization, *, reference: str | None = None) -> dict:
    """Total de despesas da competência, separado por tipo.

    Despesa cancelada **não** entra: ela existe no histórico, não no custo."""
    despesas = Expense.objects.filter(
        organization=organization, status=Expense.Status.REGISTERED
    )
    if reference:
        despesas = despesas.filter(reference=validate_reference(reference))

    por_tipo = {Expense.Kind.FIXED: Decimal("0"), Expense.Kind.EXTRA: Decimal("0")}
    contagem = {Expense.Kind.FIXED: 0, Expense.Kind.EXTRA: 0}
    for despesa in despesas:
        por_tipo[despesa.kind] += despesa.amount
        contagem[despesa.kind] += 1

    total = por_tipo[Expense.Kind.FIXED] + por_tipo[Expense.Kind.EXTRA]
    return {
        "fixed": {"count": contagem[Expense.Kind.FIXED], "amount": str(por_tipo[Expense.Kind.FIXED])},
        "extra": {"count": contagem[Expense.Kind.EXTRA], "amount": str(por_tipo[Expense.Kind.EXTRA])},
        "total": str(total),
    }


def financial_summary(organization, *, reference: str | None = None) -> dict:
    """Painel do financeiro.

    Tudo é derivado das cobranças reais — nenhum número é simulado. "Previsto"
    é o total lançado que não foi cancelado; "arrecadado" é a soma dos
    recebimentos de fato (baixas ativas: uma baixa estornada não é receita).

    `reference` restringe a uma competência — é o "Receita do mês" da tela. Sem
    ela, o painel considera toda a história da organização.
    """
    charges = Charge.objects.filter(organization=organization).prefetch_related("payments")
    if reference:
        charges = charges.filter(reference=validate_reference(reference))

    resumo = {
        "paid": {"count": 0, "amount": Decimal("0")},
        "pending": {"count": 0, "amount": Decimal("0")},
        "overdue": {"count": 0, "amount": Decimal("0")},
        "canceled": {"count": 0, "amount": Decimal("0")},
    }
    total_previsto = Decimal("0")
    total_arrecadado = Decimal("0")

    for charge in charges:
        status = charge.effective_status
        resumo[status]["count"] += 1
        resumo[status]["amount"] += charge.amount
        total_arrecadado += charge.paid_amount
        if status != "canceled":
            total_previsto += charge.amount

    despesas = expenses_summary(organization, reference=reference)

    return {
        "reference": reference or "",
        "by_status": {
            status: {"count": dados["count"], "amount": str(dados["amount"])}
            for status, dados in resumo.items()
        },
        "total_expected": str(total_previsto),
        "total_received": str(total_arrecadado),
        "total_outstanding": str(max(Decimal("0"), total_previsto - total_arrecadado)),
        # Saldo do caixa: o que **entrou** menos o que **saiu**. Usa o
        # arrecadado, não o previsto — caixa é dinheiro que existe, não promessa.
        "expenses": despesas,
        "balance": str(total_arrecadado - Decimal(despesas["total"])),
    }


# ---------------------------------------------------------------------------
# Geração da competência
# ---------------------------------------------------------------------------


def generate_recurring_charges(
    *, organization=None, reference: str | None = None, performed_by=None
) -> int:
    """Lança a mensalidade da competência para todos os mensalistas ativos.

    Mesmo padrão de `generate_upcoming_matches`: **idempotente**. A constraint
    `(player, reference)` já impede duplicata no banco, e aqui a competência já
    lançada é simplesmente pulada — rodar a task duas vezes no mesmo mês não
    cobra ninguém em dobro.

    Só entram **mensalistas ativos e não temporários**: convidado não tem
    mensalidade, e o convidado temporário da lista colada muito menos.

    O valor de cada cobrança é o **vigente do jogador naquela competência**
    (`fee_amount_for`), com o plano da organização como padrão para quem nunca
    teve valor próprio. É o que permite "João paga 120 desde maio, o resto paga
    100" sem tabela paralela nem cobrança na mão.
    """
    from apps.accounts.models import Organization

    reference = validate_reference(reference or current_reference())
    organizations = (
        [organization] if organization is not None else Organization.objects.filter(is_active=True)
    )

    criadas = 0
    for org in organizations:
        plan = active_fee_plan(org)
        if plan is None:
            continue

        ja_lancados = set(
            Charge.objects.filter(organization=org, reference=reference).values_list(
                "player_id", flat=True
            )
        )
        criadas_na_org = 0
        for player in mensalistas_of(org):
            if player.id in ja_lancados:
                continue
            amount = fee_amount_for(player, reference, plan=plan)
            if amount is None or amount <= 0:
                continue
            create_charge(
                organization=org,
                player=player,
                reference=reference,
                amount=amount,
                late_fee_amount=plan.late_fee_amount,
                due_date=_due_date_for(reference, plan.due_day),
                plan=plan,
                performed_by=performed_by,
            )
            criadas_na_org += 1

        if criadas_na_org:
            log_action(
                organization=org,
                action=AuditLog.Action.CHARGES_GENERATED,
                user=performed_by,
                entity=ENTITY_CHARGE,
                after={
                    "reference": reference,
                    "created": criadas_na_org,
                    "plan_id": plan.id,
                    "due_day": plan.due_day,
                    "late_fee_amount": str(plan.late_fee_amount),
                },
            )
        criadas += criadas_na_org
    return criadas
