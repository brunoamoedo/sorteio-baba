from decimal import Decimal

from rest_framework import serializers

from apps.players.models import Player

from .models import (
    Charge,
    Expense,
    MembershipFeePlan,
    Payment,
    PlayerMonthlyFee,
    RecurringExpense,
)


class MembershipFeePlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = MembershipFeePlan
        fields = ["id", "name", "amount", "period", "due_day", "late_fee_amount", "is_active"]


class PaymentSerializer(serializers.ModelSerializer):
    registered_by_name = serializers.CharField(
        source="registered_by.username", read_only=True, default=None
    )
    cancelled_by_name = serializers.CharField(
        source="cancelled_by.username", read_only=True, default=None
    )

    class Meta:
        model = Payment
        fields = [
            "id",
            "amount",
            "paid_at",
            "method",
            "notes",
            # Baixa cancelada continua na lista, marcada — sumir com ela seria
            # esconder do usuário exatamente o que a auditoria preserva.
            "status",
            "registered_by_name",
            "cancelled_at",
            "cancelled_by_name",
            "cancellation_reason",
            "created_at",
        ]
        read_only_fields = fields


class ChargeSerializer(serializers.ModelSerializer):
    player_name = serializers.CharField(source="player.name", read_only=True)
    player_nickname = serializers.CharField(source="player.nickname", read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    # `status` cru vale pouco para a tela: "atrasado" é derivado de vencimento
    # + pagamentos e nunca fica gravado no banco.
    effective_status = serializers.CharField(read_only=True)
    paid_amount = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    outstanding = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    # Multa e total vão **separados** do valor: a tela mostra
    # "R$ 100,00 + R$ 10,00 de multa", nunca um R$ 110,00 sem explicação.
    late_fee_due = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    total_due = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = Charge
        fields = [
            "id",
            "player",
            "player_name",
            "player_nickname",
            "plan",
            "reference",
            "amount",
            "late_fee_amount",
            "late_fee_due",
            "total_due",
            "due_date",
            "status",
            "effective_status",
            "paid_amount",
            "outstanding",
            "notes",
            "payments",
            "created_at",
        ]
        read_only_fields = ["status", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Isolamento multi-tenant: sem isto daria para lançar mensalidade no
        # nome de um jogador de outra organização informando o id.
        request = self.context.get("request")
        organization = getattr(request, "organization", None)
        if organization is not None:
            self.fields["player"].queryset = Player.objects.filter(organization=organization)
            self.fields["plan"].queryset = MembershipFeePlan.objects.filter(
                organization=organization
            )


class RegisterPaymentSerializer(serializers.Serializer):
    # `Decimal` e não `0.01`: com float o DRF avisa que a comparação de mínimo
    # sai do domínio decimal, que é onde dinheiro precisa ficar.
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    paid_at = serializers.DateField(required=False)
    method = serializers.ChoiceField(choices=Payment.Method.choices, default=Payment.Method.CASH)
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class CancelPaymentSerializer(serializers.Serializer):
    """O motivo é obrigatório — um estorno sem motivo é indistinguível de um
    erro operacional seis meses depois. `allow_blank=False` é o padrão, e é
    justamente ele que rejeita `""`."""

    reason = serializers.CharField(max_length=500)


class UpdateChargeSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0.01"), required=False
    )
    due_date = serializers.DateField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)


class FinancialSummarySerializer(serializers.Serializer):
    reference = serializers.CharField(allow_blank=True)
    by_status = serializers.DictField()
    total_expected = serializers.CharField()
    total_received = serializers.CharField()
    total_outstanding = serializers.CharField()
    expenses = serializers.DictField()
    balance = serializers.CharField()


# ---------------------------------------------------------------------------
# Despesas
# ---------------------------------------------------------------------------


class RecurringExpenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringExpense
        fields = ["id", "description", "amount", "due_day", "notes", "is_active"]


class ExpenseSerializer(serializers.ModelSerializer):
    registered_by_name = serializers.CharField(
        source="registered_by.username", read_only=True, default=None
    )
    cancelled_by_name = serializers.CharField(
        source="cancelled_by.username", read_only=True, default=None
    )
    recurring_description = serializers.CharField(
        source="recurring.description", read_only=True, default=None
    )

    class Meta:
        model = Expense
        fields = [
            "id",
            "kind",
            "recurring",
            "recurring_description",
            "description",
            "amount",
            "reference",
            "due_date",
            "incurred_on",
            "notes",
            "status",
            "registered_by_name",
            "cancelled_at",
            "cancelled_by_name",
            "cancellation_reason",
            "created_at",
        ]
        read_only_fields = ["status", "cancelled_at", "created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Isolamento multi-tenant, mesma trava da cobrança: sem isto daria para
        # apontar a despesa para um custo fixo de outra organização.
        request = self.context.get("request")
        organization = getattr(request, "organization", None)
        if organization is not None:
            self.fields["recurring"].queryset = RecurringExpense.objects.filter(
                organization=organization
            )


class CancelExpenseSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500)


# ---------------------------------------------------------------------------
# Mensalidade por jogador
# ---------------------------------------------------------------------------


class PlayerMonthlyFeeSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(
        source="created_by.username", read_only=True, default=None
    )

    class Meta:
        model = PlayerMonthlyFee
        fields = [
            "id",
            "player",
            "amount",
            "effective_from",
            "reason",
            "batch",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = fields


class MemberFeeSerializer(serializers.Serializer):
    """Uma linha da tela "Mensalistas": quem é, quanto paga hoje e como está a
    competência corrente. Não é um model — é a junção de jogador + vigência +
    cobrança, montada no serviço."""

    player_id = serializers.IntegerField()
    player_name = serializers.CharField()
    player_nickname = serializers.CharField(allow_blank=True)
    current_amount = serializers.CharField(allow_null=True)
    #: `true` quando o valor vem do plano da organização (o jogador nunca teve
    #: valor próprio) — a tela distingue "padrão" de "personalizado".
    from_plan = serializers.BooleanField()
    effective_from = serializers.CharField(allow_null=True)
    current_reference = serializers.CharField()
    current_charge_status = serializers.CharField(allow_null=True)
    current_charge_id = serializers.IntegerField(allow_null=True)


class SetMemberFeeSerializer(serializers.Serializer):
    player = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    effective_from = serializers.CharField(max_length=7)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class BulkSetMemberFeeSerializer(serializers.Serializer):
    """`players` vazio/ausente significa **todos os mensalistas ativos**, e a
    lista é resolvida no servidor — a operação não pode depender de o navegador
    ter carregado a página inteira."""

    players = serializers.ListField(child=serializers.IntegerField(), required=False, default=list)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    effective_from = serializers.CharField(max_length=7)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class BulkPreviewSerializer(serializers.Serializer):
    players = serializers.ListField(child=serializers.IntegerField(), required=False, default=list)
    effective_from = serializers.CharField(max_length=7)


class TimelineEntrySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    action = serializers.CharField()
    action_display = serializers.CharField()
    user = serializers.CharField(allow_null=True)
    created_at = serializers.DateTimeField()
    entity = serializers.CharField(allow_blank=True)
    entity_id = serializers.IntegerField(allow_null=True)
    before = serializers.DictField()
    after = serializers.DictField()
    reason = serializers.CharField(allow_blank=True)
