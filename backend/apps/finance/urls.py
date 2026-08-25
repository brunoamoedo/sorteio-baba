from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BulkSetMemberFeeView,
    ChargeViewSet,
    ExpenseViewSet,
    FinancialCapabilitiesView,
    FinancialSummaryView,
    MemberFeeHistoryView,
    MemberFeeView,
    MembershipFeePlanViewSet,
    PaymentViewSet,
    RecurringExpenseViewSet,
    SetMemberFeeView,
)

router = DefaultRouter()
router.register("charges", ChargeViewSet, basename="charge")
router.register("payments", PaymentViewSet, basename="payment")
router.register("fee-plans", MembershipFeePlanViewSet, basename="fee-plan")
# Despesas: o cadastro do custo fixo mensal e o gasto concreto da competência.
router.register("recurring-expenses", RecurringExpenseViewSet, basename="recurring-expense")
router.register("expenses", ExpenseViewSet, basename="expense")

urlpatterns = [
    path("summary/", FinancialSummaryView.as_view(), name="finance-summary"),
    path("capabilities/", FinancialCapabilitiesView.as_view(), name="finance-capabilities"),
    # Mensalidade por jogador: valor vigente, alteração individual, alteração em
    # massa (com prévia no GET) e histórico de valores.
    path("member-fees/", MemberFeeView.as_view(), name="member-fees"),
    path("member-fees/set/", SetMemberFeeView.as_view(), name="member-fee-set"),
    path("member-fees/bulk-set/", BulkSetMemberFeeView.as_view(), name="member-fee-bulk-set"),
    path(
        "member-fees/<int:player_id>/history/",
        MemberFeeHistoryView.as_view(),
        name="member-fee-history",
    ),
    path("", include(router.urls)),
]
