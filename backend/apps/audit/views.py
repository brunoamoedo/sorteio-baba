from rest_framework import viewsets

from common.mixins import OrganizationScopedViewSetMixin
from common.permissions import IsOrganizationMember

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogViewSet(OrganizationScopedViewSetMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related("user", "player", "team_from", "team_to").all()
    filterset_fields = ["action", "match", "draw", "player"]
    ordering_fields = ["created_at"]
    permission_classes = [IsOrganizationMember]
