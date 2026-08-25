from common.permissions import IsOrganizationMember, IsOrganizationOrganizerOrAdmin


class OrganizationScopedViewSetMixin:
    """Aplica em todo ViewSet de model tenant-scoped: filtra pela organização
    corrente (resolvida pela permission class) e injeta essa organização
    automaticamente na criação de novos registros."""

    def get_queryset(self):
        return super().get_queryset().filter(organization=self.request.organization)

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization)


class ReadForMembersWriteForStaffMixin:
    """Leitura liberada para qualquer papel (inclusive Visualizador);
    escrita restrita a Organizador/Admin."""

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsOrganizationMember()]
        return [IsOrganizationOrganizerOrAdmin()]
