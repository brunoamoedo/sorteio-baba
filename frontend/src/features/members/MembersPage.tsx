import { useState } from "react";
import { Alert, Button, MenuItem, TextField, Typography } from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";

import { membersApi, type AddMemberPayload, type OrganizationMember } from "../../api/membersApi";
import { getApiErrorMessage, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import { ROLE_LABELS, type MembershipRole } from "../../core/types/organization";
import { AppLayout } from "../../shared/layout/AppLayout";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip } from "../../shared/components/StatusChip";
import { useToast } from "../../shared/components/ToastProvider";
import { AddMemberDrawer } from "./AddMemberDrawer";
import { MemberCard } from "./MemberCard";

const membersKey = ["organization", "members"];

/** Quem participa desta organização e com qual perfil.
 *
 * É a tela do Gerente — escopada à organização corrente. A visão que cruza
 * organizações é a de Super Admin, em "⚙️ Sistema". */
export function MembersPage() {
  const { showToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [toRemove, setToRemove] = useState<OrganizationMember | null>(null);

  const membersQuery = useApiQuery<OrganizationMember[]>(membersKey, membersApi.list);
  const invalidate = () => {
    queryStore.invalidate(membersKey);
    queryStore.invalidate(["players"]);
  };

  const addMutation = useApiMutation((payload: AddMemberPayload) => membersApi.add(payload), {
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      showToast("Pessoa adicionada à organização.");
    },
  });

  const roleMutation = useApiMutation(
    ({ id, role }: { id: number; role: MembershipRole }) => membersApi.update(id, { role }),
    {
      onSuccess: () => {
        invalidate();
        showToast("Perfil atualizado.");
      },
      onError: (error) =>
        showToast(getApiErrorMessage(error, "Não foi possível alterar o perfil."), "error"),
    },
  );

  const removeMutation = useApiMutation((id: number) => membersApi.remove(id), {
    onSuccess: () => {
      invalidate();
      setToRemove(null);
      showToast("Pessoa removida da organização.");
    },
    onError: (error) =>
      showToast(getApiErrorMessage(error, "Não foi possível remover."), "error"),
  });

  const columns: DataTableColumn<OrganizationMember>[] = [
    {
      key: "user",
      label: "Pessoa",
      sortValue: (member) => member.username,
      render: (member) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {member.username}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {member.email}
          </Typography>
        </>
      ),
    },
    {
      key: "player",
      label: "Ficha de jogador",
      render: (member) =>
        member.linked_player_name ? (
          <Typography variant="body2">{member.linked_player_name}</Typography>
        ) : (
          // Sem ficha, a pessoa não confirma a própria presença — vale avisar
          // aqui, que é onde o gerente está pensando em acessos.
          <Typography variant="caption" color="warning.main">
            sem ficha vinculada
          </Typography>
        ),
    },
    {
      key: "role",
      label: "Perfil",
      render: (member) => (
        <TextField
          select
          size="small"
          value={member.role}
          disabled={roleMutation.isPending || !member.is_active}
          onChange={(event) =>
            roleMutation.mutate({ id: member.id, role: event.target.value as MembershipRole })
          }
          sx={{ minWidth: 160 }}
        >
          {(Object.keys(ROLE_LABELS) as MembershipRole[]).map((role) => (
            <MenuItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </MenuItem>
          ))}
        </TextField>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (member) => (
        <StatusChip
          label={member.is_active ? "Ativo" : "Removido"}
          tone={member.is_active ? "success" : "default"}
        />
      ),
    },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      render: (member) =>
        member.is_active ? (
          <Button size="small" color="error" onClick={() => setToRemove(member)}>
            Remover
          </Button>
        ) : null,
    },
  ];

  return (
    <AppLayout>
      <PageHeader
        title="Pessoas e Perfis"
        action={
          <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setAddOpen(true)}>
            Adicionar pessoa
          </Button>
        }
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        O perfil vale <strong>só nesta organização</strong> — a mesma pessoa pode ser Gerente aqui e
        Jogador em outra pelada, com um login só. Para o Jogador confirmar a própria presença, a
        ficha dele precisa estar vinculada (em <strong>Jogadores</strong>).
      </Alert>

      <DataTable
        columns={columns}
        rows={membersQuery.data}
        getRowKey={(member) => member.id}
        loading={membersQuery.isLoading}
        error={
          membersQuery.isError
            ? getApiErrorMessage(membersQuery.error, "Não foi possível carregar as pessoas.")
            : null
        }
        onRetry={() => membersQuery.refetch()}
        emptyMessage="Ninguém por aqui ainda."
        renderCard={(member) => (
          <MemberCard
            member={member}
            isBusy={roleMutation.isPending}
            onChangeRole={(target, role) => roleMutation.mutate({ id: target.id, role })}
            onRemove={setToRemove}
          />
        )}
      />

      <AddMemberDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        isSubmitting={addMutation.isPending}
        error={
          addMutation.isError
            ? getApiErrorMessage(addMutation.error, "Não foi possível adicionar.")
            : null
        }
        onSubmit={(payload) => addMutation.mutateAsync(payload)}
      />

      <ConfirmDialog
        open={!!toRemove}
        title="Remover da organização"
        description={`${toRemove?.username} perde o acesso a esta organização. O histórico dele (presenças, sorteios, mensalidades) é preservado, e o login continua valendo nas outras peladas.`}
        confirmLabel="Remover"
        isConfirming={removeMutation.isPending}
        onConfirm={() => toRemove && removeMutation.mutate(toRemove.id)}
        onClose={() => setToRemove(null)}
      />
    </AppLayout>
  );
}
