from django_filters import rest_framework as filters
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.players.models import Player
from common.exceptions import DomainError
from common.mixins import OrganizationScopedViewSetMixin
from common.permissions import IsOrganizationParticipant

from .models import Charge, Expense, MembershipFeePlan, Payment, PlayerMonthlyFee, RecurringExpense
from .permissions import (
    CanCancelPayment,
    CanEditFee,
    CanManageFinancial,
    CanRegisterPayment,
    CanViewFinancial,
    CanViewFinancialAudit,
    capabilities_for,
)
from .serializers import (
    BulkPreviewSerializer,
    BulkSetMemberFeeSerializer,
    CancelExpenseSerializer,
    CancelPaymentSerializer,
    ChargeSerializer,
    ExpenseSerializer,
    FinancialSummarySerializer,
    MemberFeeSerializer,
    MembershipFeePlanSerializer,
    PaymentSerializer,
    PlayerMonthlyFeeSerializer,
    RecurringExpenseSerializer,
    RegisterPaymentSerializer,
    SetMemberFeeSerializer,
    TimelineEntrySerializer,
    UpdateChargeSerializer,
)
from .services import (
    active_fee_plan,
    bulk_change_due_date,
    bulk_change_preview,
    bulk_register_payments,
    bulk_set_player_fees,
    cancel_charge,
    cancel_expense,
    cancel_payment,
    charge_timeline,
    create_charge,
    create_expense,
    current_reference,
    fee_amount_for,
    fee_history,
    financial_summary,
    generate_charges_for,
    generate_fixed_expenses,
    generate_recurring_charges,
    mensalistas_of,
    register_payment,
    resync_pending_charges,
    resync_preview,
    set_player_fee,
    update_charge,
    update_expense,
    update_fee_plan,
)


class MembershipFeePlanViewSet(OrganizationScopedViewSetMixin, viewsets.ModelViewSet):
    """Contrato padrão da organização (valor base, dia de vencimento).

    Leitura exige a capacidade de ver o financeiro e escrita a de alterar
    valores — o Visualizador não enxerga o dinheiro da organização."""

    serializer_class = MembershipFeePlanSerializer
    queryset = MembershipFeePlan.objects.all()
    filterset_fields = ["is_active"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanViewFinancial()]
        return [CanEditFee()]

    def perform_update(self, serializer):
        """Passa pelo serviço: alterar vencimento ou multa precisa deixar
        rastro. Antes o `ModelViewSet` gravava direto e essas duas mudanças —
        justamente as que alguém confere quando uma cobrança vem diferente do
        esperado — não apareciam em lugar nenhum."""
        update_fee_plan(
            plan=serializer.instance,
            performed_by=self.request.user,
            **serializer.validated_data,
        )
        serializer.instance.refresh_from_db()


class ChargeFilter(filters.FilterSet):
    """Filtros da tela financeira.

    `status` filtra o campo **gravado**; "atrasado" não está no banco (é
    derivado) e continua sendo filtrado no cliente, que já tem a lista. O resto
    — competência, período de vencimento, faixa de valor e data de pagamento —
    é filtrado aqui, porque são colunas reais e a lista pode ser grande.
    """

    reference = filters.CharFilter(field_name="reference", lookup_expr="exact")
    reference_after = filters.CharFilter(field_name="reference", lookup_expr="gte")
    reference_before = filters.CharFilter(field_name="reference", lookup_expr="lte")
    due_after = filters.DateFilter(field_name="due_date", lookup_expr="gte")
    due_before = filters.DateFilter(field_name="due_date", lookup_expr="lte")
    amount_min = filters.NumberFilter(field_name="amount", lookup_expr="gte")
    amount_max = filters.NumberFilter(field_name="amount", lookup_expr="lte")
    # Data do pagamento: olha só as baixas **ativas**, senão uma baixa
    # cancelada continuaria fazendo a competência aparecer no período.
    paid_after = filters.DateFilter(method="_filter_paid_after")
    paid_before = filters.DateFilter(method="_filter_paid_before")

    class Meta:
        model = Charge
        fields = ["status", "player", "reference"]

    def _active_payments(self, queryset, value, lookup):
        return queryset.filter(
            payments__status=Payment.Status.REGISTERED, **{f"payments__paid_at__{lookup}": value}
        ).distinct()

    def _filter_paid_after(self, queryset, name, value):
        return self._active_payments(queryset, value, "gte")

    def _filter_paid_before(self, queryset, name, value):
        return self._active_payments(queryset, value, "lte")


class ChargeViewSet(OrganizationScopedViewSetMixin, viewsets.ModelViewSet):
    """Mensalidades da organização — só quem tem capacidade financeira.

    O jogador **não** entra aqui: ele vê as próprias cobranças em
    `/api/finance/charges/mine/`, que filtra pelo login dele."""

    serializer_class = ChargeSerializer
    queryset = (
        Charge.objects.select_related("player", "plan")
        .prefetch_related("payments__registered_by", "payments__cancelled_by")
        .all()
    )
    filterset_class = ChargeFilter
    permission_classes = [CanManageFinancial]

    #: Cada ação exige a sua capacidade. Manter o mapa aqui em cima deixa a
    #: resposta a "quem pode fazer o quê" visível sem ler todos os métodos.
    ACTION_PERMISSIONS = {
        "list": CanViewFinancial,
        "retrieve": CanViewFinancial,
        "mine": IsOrganizationParticipant,
        "register_payment_action": CanRegisterPayment,
        "timeline": CanViewFinancialAudit,
        # Ressincronizar é aplicar o valor da mensalidade, não operar caixa —
        # por isso cai em `edit_fee`, a mesma capacidade de quem definiu o valor.
        "resync_preview_action": CanEditFee,
        "resync": CanEditFee,
        # Baixa em massa é operar caixa; gerar e alterar vencimento é gestão da
        # cobrança. Cada uma cai na capacidade que já governa a versão
        # individual da mesma operação.
        "bulk_register_payment": CanRegisterPayment,
        "generate_for": CanManageFinancial,
        "bulk_due_date": CanManageFinancial,
    }

    def get_permissions(self):
        permission = self.ACTION_PERMISSIONS.get(self.action)
        if permission is not None:
            return [permission()]
        return super().get_permissions()

    def perform_create(self, serializer):
        """Passa pelo serviço em vez de salvar direto: é lá que moram a trava
        de duplicidade por competência e o registro de auditoria."""
        data = serializer.validated_data
        serializer.instance = create_charge(
            organization=self.request.organization,
            player=data["player"],
            reference=data["reference"],
            amount=data["amount"],
            due_date=data["due_date"],
            plan=data.get("plan"),
            notes=data.get("notes", ""),
            performed_by=self.request.user,
        )

    def update(self, request, *args, **kwargs):
        """Correção administrativa (valor/vencimento/observação) pelo serviço,
        que valida e audita. O `PATCH` cru do ModelViewSet reescreveria a linha
        sem deixar rastro — exatamente o que este módulo não pode permitir."""
        charge = self.get_object()
        serializer = UpdateChargeSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        update_charge(
            charge=charge,
            amount=serializer.validated_data.get("amount"),
            due_date=serializer.validated_data.get("due_date"),
            notes=serializer.validated_data.get("notes"),
            performed_by=request.user,
        )
        charge.refresh_from_db()
        return Response(self.get_serializer(charge).data)

    def destroy(self, request, *args, **kwargs):
        """Excluir mensalidade não existe: o caminho é cancelar, que preserva o
        registro e o motivo."""
        raise DomainError(
            "Mensalidade não é excluída — use o cancelamento, que preserva o histórico."
        )

    @action(detail=True, methods=["post"], url_path="register-payment")
    def register_payment_action(self, request, pk=None):
        charge = self.get_object()
        serializer = RegisterPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        register_payment(
            charge=charge,
            amount=serializer.validated_data["amount"],
            paid_at=serializer.validated_data.get("paid_at"),
            method=serializer.validated_data["method"],
            notes=serializer.validated_data.get("notes", ""),
            registered_by=request.user,
        )
        charge.refresh_from_db()
        return Response(self.get_serializer(charge).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        charge = cancel_charge(
            charge=self.get_object(),
            reason=request.data.get("reason", ""),
            performed_by=request.user,
        )
        return Response(self.get_serializer(charge).data)

    @action(detail=True, methods=["get"])
    def timeline(self, request, pk=None):
        """Histórico completo da competência: cada baixa, cada cancelamento,
        cada alteração — com usuário, data/hora e motivo."""
        entries = charge_timeline(self.get_object())
        return Response(TimelineEntrySerializer(entries, many=True).data)

    @action(detail=False, methods=["post"], url_path="generate-monthly")
    def generate_monthly(self, request):
        """Lança a mensalidade do mês para todos os mensalistas de uma vez.

        É a saída explícita para quem não quer esperar a task noturna — mesma
        função, mesma idempotência: rodar duas vezes no mesmo mês não cobra
        ninguém em dobro."""
        criadas = generate_recurring_charges(
            organization=request.organization,
            reference=request.data.get("reference") or None,
            performed_by=request.user,
        )
        return Response({"created": criadas})

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """As mensalidades de quem está logado.

        A ligação login → ficha de jogador é `Player.user`. Sem vínculo, a
        lista vem vazia — nunca "todas", que seria o vazamento clássico de uma
        rota de auto-serviço mal filtrada."""
        charges = self.get_queryset().filter(player__user=request.user)
        return Response(self.get_serializer(charges, many=True).data)

    # -- Operações em massa --------------------------------------------------
    #
    # Todas resolvem a lista contra `request.organization`: um id de outra
    # organização simplesmente não aparece, e o isolamento não depende de o
    # cliente mandar a coisa certa.

    def _players_from(self, request):
        """Recorte por jogador. Ausente significa **todos os mensalistas**."""
        ids = request.data.get("player_ids")
        if not ids:
            return None
        return list(Player.objects.filter(organization=request.organization, id__in=ids))

    @action(detail=False, methods=["post"], url_path="generate-for")
    def generate_for(self, request):
        """Lança a mensalidade da competência para os selecionados (ou todos).

        Idempotente: quem já tem é pulado, com motivo. É o que permite clicar
        duas vezes sem cobrar ninguém em dobro."""
        return Response(
            generate_charges_for(
                organization=request.organization,
                reference=request.data.get("reference") or None,
                players=self._players_from(request),
                performed_by=request.user,
            )
        )

    @action(detail=False, methods=["post"], url_path="bulk-due-date")
    def bulk_due_date(self, request):
        """Altera o dia de vencimento das mensalidades selecionadas.

        Recebe cobranças, não jogadores: é o que a tela seleciona. O dia é
        resolvido contra a competência de cada uma, então uma seleção que cruze
        meses sai com o dia certo em cada mês."""
        return Response(
            bulk_change_due_date(
                organization=request.organization,
                due_day=int(request.data.get("due_day", 0)),
                charge_ids=request.data.get("charge_ids") or [],
                reason=request.data.get("reason", ""),
                performed_by=request.user,
            )
        )

    @action(detail=False, methods=["post"], url_path="bulk-register-payment")
    def bulk_register_payment(self, request):
        """Dá baixa em várias mensalidades, cada uma pelo seu total devido."""
        return Response(
            bulk_register_payments(
                organization=request.organization,
                charge_ids=request.data.get("charge_ids") or [],
                paid_at=request.data.get("paid_at") or None,
                method=request.data.get("method") or Payment.Method.CASH,
                notes=request.data.get("notes", ""),
                registered_by=request.user,
            )
        )

    # -- Ressincronização ----------------------------------------------------
    #
    # Duas rotas para a mesma regra: a prévia responde "o que aconteceria" e a
    # execução faz. Ambas chamam o mesmo separador de candidatas, para a tela
    # nunca prometer um número diferente do que o servidor entrega.

    def _resync_players(self, request):
        """Restringe a operação a jogadores específicos, quando pedido.

        Ausente (ou vazio) significa **toda a competência**. A lista é
        resolvida contra `request.organization`, então um id de outra
        organização simplesmente não aparece — o isolamento não depende de o
        cliente mandar a coisa certa."""
        ids = request.data.get("player_ids") or request.query_params.getlist("player_ids")
        if not ids:
            return None
        return list(Player.objects.filter(organization=request.organization, id__in=ids))

    @action(detail=False, methods=["get"], url_path="resync-preview")
    def resync_preview_action(self, request):
        return Response(
            resync_preview(
                organization=request.organization,
                reference=request.query_params.get("reference") or None,
                players=self._resync_players(request),
            )
        )

    @action(detail=False, methods=["post"])
    def resync(self, request):
        """Aplica o valor vigente às mensalidades **em aberto** da competência.

        Cobrança paga, com baixa parcial ou cancelada é pulada com motivo — a
        imutabilidade do histórico continua valendo, e a resposta diz
        exatamente o que ficou de fora."""
        return Response(
            resync_pending_charges(
                organization=request.organization,
                reference=request.data.get("reference") or None,
                players=self._resync_players(request),
                reason=request.data.get("reason", ""),
                performed_by=request.user,
            )
        )


class PaymentViewSet(OrganizationScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Baixas da organização. Só leitura e cancelamento: lançar pagamento é
    sempre pela cobrança (`charges/{id}/register-payment/`), que é quem sabe
    decidir se a competência quitou."""

    serializer_class = PaymentSerializer
    queryset = Payment.objects.select_related(
        "charge", "charge__player", "registered_by", "cancelled_by"
    ).all()
    filterset_fields = ["status", "method", "charge", "paid_at"]
    permission_classes = [CanViewFinancial]

    def get_permissions(self):
        if self.action == "cancel":
            return [CanCancelPayment()]
        return super().get_permissions()

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancela a baixa **sem apagá-la**. Motivo obrigatório."""
        serializer = CancelPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payment = cancel_payment(
            payment=self.get_object(),
            reason=serializer.validated_data["reason"],
            cancelled_by=request.user,
        )
        return Response(self.get_serializer(payment).data)


class RecurringExpenseViewSet(OrganizationScopedViewSetMixin, viewsets.ModelViewSet):
    """Cadastro dos **custos fixos mensais** (quadra, arbitragem, colete).

    Não é o gasto: é o contrato do gasto. Cada competência ganha uma `Expense`
    gerada a partir daqui, com o valor congelado."""

    serializer_class = RecurringExpenseSerializer
    queryset = RecurringExpense.objects.all()
    filterset_fields = ["is_active"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanViewFinancial()]
        return [CanManageFinancial()]


class ExpenseFilter(filters.FilterSet):
    reference = filters.CharFilter(field_name="reference", lookup_expr="exact")
    reference_after = filters.CharFilter(field_name="reference", lookup_expr="gte")
    reference_before = filters.CharFilter(field_name="reference", lookup_expr="lte")
    incurred_after = filters.DateFilter(field_name="incurred_on", lookup_expr="gte")
    incurred_before = filters.DateFilter(field_name="incurred_on", lookup_expr="lte")
    amount_min = filters.NumberFilter(field_name="amount", lookup_expr="gte")
    amount_max = filters.NumberFilter(field_name="amount", lookup_expr="lte")

    class Meta:
        model = Expense
        fields = ["kind", "status", "reference", "recurring"]


class ExpenseViewSet(OrganizationScopedViewSetMixin, viewsets.ModelViewSet):
    """Despesas da pelada, separadas em custo fixo mensal e custo extra."""

    serializer_class = ExpenseSerializer
    queryset = Expense.objects.select_related(
        "recurring", "registered_by", "cancelled_by"
    ).all()
    filterset_class = ExpenseFilter
    permission_classes = [CanManageFinancial]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [CanViewFinancial()]
        return super().get_permissions()

    def perform_create(self, serializer):
        data = serializer.validated_data
        serializer.instance = create_expense(
            organization=self.request.organization,
            description=data["description"],
            amount=data["amount"],
            reference=data["reference"],
            incurred_on=data.get("incurred_on"),
            due_date=data.get("due_date"),
            kind=data.get("kind", Expense.Kind.EXTRA),
            recurring=data.get("recurring"),
            notes=data.get("notes", ""),
            performed_by=self.request.user,
        )

    def perform_update(self, serializer):
        """Correção pelo serviço, que valida e audita.

        O `PATCH` cru do `ModelViewSet` reescrevia a linha sem deixar rastro —
        num módulo cuja premissa é que toda operação relevante audita."""
        update_expense(
            expense=serializer.instance,
            performed_by=self.request.user,
            **serializer.validated_data,
        )
        serializer.instance.refresh_from_db()

    def destroy(self, request, *args, **kwargs):
        """Despesa não é excluída: o caminho é cancelar, que preserva o registro
        e o motivo — a prestação de contas não pode ter buracos."""
        raise DomainError(
            "Despesa não é excluída — use o cancelamento, que preserva o histórico."
        )

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        serializer = CancelExpenseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expense = cancel_expense(
            expense=self.get_object(),
            reason=serializer.validated_data["reason"],
            cancelled_by=request.user,
        )
        return Response(self.get_serializer(expense).data)

    @action(detail=False, methods=["post"], url_path="generate-fixed")
    def generate_fixed(self, request):
        """Lança os custos fixos da competência. Idempotente."""
        criadas = generate_fixed_expenses(
            organization=request.organization,
            reference=request.data.get("reference") or None,
            performed_by=request.user,
        )
        return Response({"created": criadas})


class MemberFeeView(APIView):
    """Mensalistas da organização com o valor **vigente** de cada um.

    É a tela "Mensalidades": quem paga quanto, desde quando, e como está a
    competência corrente de cada um."""

    permission_classes = [CanViewFinancial]

    def get(self, request):
        organization = request.organization
        reference = request.query_params.get("reference") or current_reference()
        plan = active_fee_plan(organization)
        players = list(mensalistas_of(organization))

        charges = {
            charge.player_id: charge
            for charge in Charge.objects.filter(
                organization=organization, reference=reference, player__in=players
            ).prefetch_related("payments")
        }
        # Uma consulta só para todas as vigências: como vêm ordenadas por
        # competência decrescente, o `setdefault` guarda a primeira de cada
        # jogador — que é justamente a vigente. Perguntar jogador a jogador
        # seria uma query por linha da tela.
        vigencias: dict[int, PlayerMonthlyFee] = {}
        for fee in PlayerMonthlyFee.objects.filter(
            organization=organization, player__in=players, effective_from__lte=reference
        ).order_by("player_id", "-effective_from"):
            vigencias.setdefault(fee.player_id, fee)

        linhas = []
        for player in players:
            vigencia = vigencias.get(player.id)
            charge = charges.get(player.id)
            amount = vigencia.amount if vigencia else (plan.amount if plan else None)
            linhas.append(
                {
                    "player_id": player.id,
                    "player_name": player.name,
                    "player_nickname": player.nickname,
                    "current_amount": str(amount) if amount is not None else None,
                    "from_plan": vigencia is None,
                    "effective_from": vigencia.effective_from if vigencia else None,
                    "current_reference": reference,
                    "current_charge_status": charge.effective_status if charge else None,
                    "current_charge_id": charge.id if charge else None,
                }
            )
        return Response(MemberFeeSerializer(linhas, many=True).data)


class SetMemberFeeView(APIView):
    permission_classes = [CanEditFee]

    def post(self, request):
        serializer = SetMemberFeeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        player = Player.objects.filter(
            id=data["player"], organization=request.organization
        ).first()
        if player is None:
            raise DomainError("Este jogador não pertence a esta organização.")

        fee = set_player_fee(
            organization=request.organization,
            player=player,
            amount=data["amount"],
            effective_from=data["effective_from"],
            reason=data.get("reason", ""),
            performed_by=request.user,
        )
        return Response(PlayerMonthlyFeeSerializer(fee).data, status=201)


class BulkSetMemberFeeView(APIView):
    """Alteração em massa.

    `GET` (preview) é o que alimenta a confirmação explícita da tela: quantos
    mensalistas, valores atuais, competência inicial e quantas competências já
    lançadas **não** serão tocadas. `POST` executa e devolve o identificador do
    lote."""

    permission_classes = [CanEditFee]

    def _players_from(self, request, ids):
        if not ids:
            return None
        players = list(Player.objects.filter(id__in=ids, organization=request.organization))
        if len(players) != len(set(ids)):
            raise DomainError("A seleção contém jogador que não pertence a esta organização.")
        return players

    def get(self, request):
        serializer = BulkPreviewSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data.get("players") or []
        return Response(
            bulk_change_preview(
                organization=request.organization,
                players=self._players_from(request, ids),
                effective_from=serializer.validated_data["effective_from"],
            )
        )

    def post(self, request):
        serializer = BulkSetMemberFeeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        resultado = bulk_set_player_fees(
            organization=request.organization,
            players=self._players_from(request, data.get("players") or []),
            amount=data["amount"],
            effective_from=data["effective_from"],
            reason=data.get("reason", ""),
            performed_by=request.user,
        )
        return Response(resultado, status=201)


class MemberFeeHistoryView(APIView):
    """Histórico de valores de um mensalista — "qual era o valor vigente em
    determinado período"."""

    permission_classes = [CanViewFinancial]

    def get(self, request, player_id: int):
        player = Player.objects.filter(id=player_id, organization=request.organization).first()
        if player is None:
            raise DomainError("Este jogador não pertence a esta organização.")
        return Response(
            {
                "player_id": player.id,
                "player_name": player.name,
                "current_amount": (
                    str(valor)
                    if (valor := fee_amount_for(player, current_reference())) is not None
                    else None
                ),
                "history": PlayerMonthlyFeeSerializer(fee_history(player), many=True).data,
            }
        )


class FinancialSummaryView(APIView):
    permission_classes = [CanViewFinancial]

    def get(self, request):
        resumo = financial_summary(
            request.organization, reference=request.query_params.get("reference") or None
        )
        return Response(FinancialSummarySerializer(resumo).data)


class FinancialCapabilitiesView(APIView):
    """O que **este** usuário pode fazer no financeiro.

    A tela lê daqui em vez de deduzir do papel: quando a tabela de capacidades
    mudar, a interface acompanha sem uma segunda cópia da regra no frontend."""

    permission_classes = [IsOrganizationParticipant]

    def get(self, request):
        return Response({"capabilities": sorted(capabilities_for(request.membership.role))})
