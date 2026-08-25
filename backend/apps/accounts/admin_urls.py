from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .admin_views import (
    AdminMembershipViewSet,
    AdminOrganizationViewSet,
    AdminUserViewSet,
    GlobalAuditLogView,
)

router = DefaultRouter()
router.register("organizations", AdminOrganizationViewSet, basename="admin-organization")
router.register("users", AdminUserViewSet, basename="admin-user")
router.register("memberships", AdminMembershipViewSet, basename="admin-membership")

urlpatterns = [
    path("audit-logs/", GlobalAuditLogView.as_view(), name="admin-audit-logs"),
    path("", include(router.urls)),
]
