import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

import { adminApi, type AdminOrganization, type AdminUser } from "../../api/adminApi";
import { formatMatchDate } from "../../core/dateTime";
import { getApiErrorMessage, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import { ROLE_LABELS, type MembershipRole } from "../../core/types/organization";
import { AppLayout } from "../../shared/layout/AppLayout";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip } from "../../shared/components/StatusChip";
import { useToast } from "../../shared/components/ToastProvider";
import { useAuth } from "../auth/AuthContext";

const adminKeys = {
  organizations: (): string[] => ["admin", "organizations"],
  users: (): string[] => ["admin", "users"],
};

/** Administração do sistema — só Super Administrador.
 *
 * A tela é escondida do menu para os demais, mas isso é só conveniência: as
 * rotas `/api/admin/*` recusam qualquer outro perfil com 403, então entrar pela
 * URL não adianta. */
export function SystemAdminPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<"organizations" | "users">("organizations");
  const [newOrgName, setNewOrgName] = useState("");

  const orgsQuery = useApiQuery<AdminOrganization[]>(
    adminKeys.organizations(),
    adminApi.listOrganizations,
    { enabled: !!user?.is_superadmin },
  );
  const usersQuery = useApiQuery<AdminUser[]>(adminKeys.users(), adminApi.listUsers, {
    enabled: !!user?.is_superadmin,
  });

  const createOrgMutation = useApiMutation(adminApi.createOrganization, {
    onSuccess: () => {
      queryStore.invalidate(["admin"]);
      setNewOrgName("");
      showToast("Organização criada — já com as posições padrão.");
    },
    onError: (error) =>
      showToast(getApiErrorMessage(error, "Não foi possível criar a organização."), "error"),
  });

  const toggleOrgMutation = useApiMutation(
    ({ id, is_active }: { id: number; is_active: boolean }) =>
      adminApi.updateOrganization(id, { is_active }),
    {
      onSuccess: () => {
        queryStore.invalidate(["admin"]);
        showToast("Organização atualizada.");
      },
    },
  );

  const roleMutation = useApiMutation(
    ({ id, role }: { id: number; role: MembershipRole }) => adminApi.updateMembership(id, { role }),
    {
      onSuccess: () => {
        queryStore.invalidate(["admin"]);
        showToast("Perfil atualizado.");
      },
      onError: (error) =>
        showToast(getApiErrorMessage(error, "Não foi possível alterar o perfil."), "error"),
    },
  );

  if (!user?.is_superadmin) {
    return (
      <AppLayout>
        <Alert severity="error">Esta área é exclusiva do Super Administrador.</Alert>
      </AppLayout>
    );
  }

  const orgColumns: DataTableColumn<AdminOrganization>[] = [
    {
      key: "name",
      label: "Organização",
      sortValue: (o) => o.name,
      render: (org) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {org.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {org.slug}
          </Typography>
        </>
      ),
    },
    { key: "members", label: "Membros", sortValue: (o) => o.members_count, render: (o) => o.members_count },
    { key: "players", label: "Jogadores", sortValue: (o) => o.players_count, render: (o) => o.players_count },
    { key: "created", label: "Criada em", render: (o) => formatMatchDate(o.created_at.slice(0, 10)) },
    {
      key: "status",
      label: "Status",
      render: (org) => (
        <StatusChip label={org.is_active ? "Ativa" : "Inativa"} tone={org.is_active ? "success" : "default"} />
      ),
    },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      render: (org) => (
        <Button
          size="small"
          color={org.is_active ? "inherit" : "primary"}
          disabled={toggleOrgMutation.isPending}
          onClick={() => toggleOrgMutation.mutate({ id: org.id, is_active: !org.is_active })}
        >
          {org.is_active ? "Desativar" : "Reativar"}
        </Button>
      ),
    },
  ];

  const userColumns: DataTableColumn<AdminUser>[] = [
    {
      key: "user",
      label: "Usuário",
      sortValue: (u) => u.username,
      render: (adminUser) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {adminUser.username}
            {adminUser.is_superadmin && (
              <Chip label="Super Admin" size="small" color="secondary" sx={{ ml: 1 }} />
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {adminUser.email}
          </Typography>
        </>
      ),
    },
    {
      key: "memberships",
      label: "Organizações e perfis",
      render: (adminUser) =>
        adminUser.memberships.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {adminUser.is_superadmin ? "Acesso a todas (Super Admin)" : "Nenhuma"}
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {adminUser.memberships.map((membership) => (
              <Stack key={membership.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="caption" sx={{ minWidth: 140 }}>
                  {membership.organization_name}
                </Typography>
                {/* O papel é editável direto na linha: é a operação mais
                    frequente do super admin, e abrir um formulário para trocar
                    um enum seria atrito puro. */}
                <TextField
                  select
                  size="small"
                  value={membership.role}
                  disabled={roleMutation.isPending}
                  onChange={(event) =>
                    roleMutation.mutate({
                      id: membership.id,
                      role: event.target.value as MembershipRole,
                    })
                  }
                  sx={{ minWidth: 150 }}
                >
                  {(Object.keys(ROLE_LABELS) as MembershipRole[]).map((role) => (
                    <MenuItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            ))}
          </Stack>
        ),
    },
  ];

  return (
    <AppLayout>
      <PageHeader title="Administração do Sistema" />

      <Alert severity="info" sx={{ mb: 2 }}>
        Você é <strong>Super Administrador</strong>: acessa qualquer organização pelo seletor do
        topo, sem precisar de vínculo. Os dados continuam isolados — você escolhe uma organização
        por vez.
      </Alert>

      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="Organizações" value="organizations" />
        <Tab label="Usuários e perfis" value="users" />
      </Tabs>

      {tab === "organizations" && (
        <>
          <Stack
            component="form"
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ mb: 2 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (newOrgName.trim()) createOrgMutation.mutate(newOrgName.trim());
            }}
          >
            <TextField
              size="small"
              label="Nome da nova organização"
              placeholder="Ex.: Arena Norte"
              value={newOrgName}
              onChange={(event) => setNewOrgName(event.target.value)}
              sx={{ minWidth: 280 }}
            />
            <Button
              type="submit"
              variant="contained"
              startIcon={<AddIcon />}
              disabled={!newOrgName.trim() || createOrgMutation.isPending}
            >
              Criar
            </Button>
          </Stack>

          <DataTable
            columns={orgColumns}
            rows={orgsQuery.data}
            getRowKey={(org) => org.id}
            loading={orgsQuery.isLoading}
            error={
              orgsQuery.isError
                ? getApiErrorMessage(orgsQuery.error, "Não foi possível carregar as organizações.")
                : null
            }
            onRetry={() => orgsQuery.refetch()}
            emptyMessage="Nenhuma organização cadastrada."
          />
        </>
      )}

      {tab === "users" && (
        <DataTable
          columns={userColumns}
          rows={usersQuery.data}
          getRowKey={(adminUser) => adminUser.id}
          loading={usersQuery.isLoading}
          error={
            usersQuery.isError
              ? getApiErrorMessage(usersQuery.error, "Não foi possível carregar os usuários.")
              : null
          }
          onRetry={() => usersQuery.refetch()}
          emptyMessage="Nenhum usuário cadastrado."
        />
      )}
    </AppLayout>
  );
}
