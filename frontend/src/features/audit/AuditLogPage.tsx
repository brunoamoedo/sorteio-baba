import { useState } from "react";
import { Box, MenuItem, TextField, Typography } from "@mui/material";

import { auditApi } from "../../api/auditApi";
import { formatTimestamp } from "../../core/dateTime";
import { getApiErrorMessage, useApiQuery } from "../../core/data";
import { AUDIT_ACTION_LABELS, type AuditAction, type AuditLogEntry } from "../../core/types/audit";
import { AppLayout } from "../../shared/layout/AppLayout";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip, auditActionTone } from "../../shared/components/StatusChip";
import { matchKeys } from "../matches/matchQueries";
import { AuditEntryCard } from "./AuditEntryCard";
import { changedFacts, describeAuditPayload } from "./auditFormat";

/** Derivado de `AUDIT_ACTION_LABELS`: acrescentar uma ação nova passa a ser
 * um lugar só, e o filtro nunca fica defasado em relação ao que o backend
 * registra. */
const ACTION_OPTIONS = [
  { value: "", label: "Todas" },
  ...(Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((value) => ({
    value,
    label: AUDIT_ACTION_LABELS[value],
  })),
];

export function AuditLogPage() {
  const [action, setAction] = useState<string>("");

  const logsQuery = useApiQuery<AuditLogEntry[]>([...matchKeys.auditLogs(), action], () =>
    auditApi.list(action ? { action } : {}),
  );

  const columns: DataTableColumn<AuditLogEntry>[] = [
    {
      key: "created_at",
      label: "Data/Hora",
      sortValue: (entry) => entry.created_at,
      render: (entry) => formatTimestamp(entry.created_at),
    },
    {
      key: "action",
      label: "Ação",
      render: (entry) => <StatusChip label={entry.action_display} tone={auditActionTone(entry.action)} />,
    },
    { key: "player", label: "Jogador", render: (entry) => entry.player_name ?? "—" },
    {
      key: "teams",
      label: "Time origem → destino",
      render: (entry) =>
        entry.team_from_name && entry.team_to_name ? `${entry.team_from_name} → ${entry.team_to_name}` : "—",
    },
    {
      // O conteúdo real da auditoria — `before`/`after` — não era exibido em
      // lugar nenhum. Numa movimentação manual, era exatamente a informação
      // que faltava para conferir o que mudou.
      key: "changes",
      label: "Alterações",
      render: (entry) => {
        const facts = changedFacts(describeAuditPayload(entry.before, entry.after));
        if (facts.length === 0) return "—";
        return (
          <Box sx={{ display: "grid", gap: 0.25, minWidth: 180 }}>
            {facts.slice(0, 4).map((fact) => (
              <Typography key={fact.label} variant="caption" sx={{ lineHeight: 1.4 }}>
                <Box component="span" color="text.secondary">
                  {fact.label}:{" "}
                </Box>
                {fact.value !== undefined ? (
                  <strong>{fact.value}</strong>
                ) : (
                  <>
                    <Box component="span" sx={{ textDecoration: "line-through", opacity: 0.7 }}>
                      {fact.before}
                    </Box>{" "}
                    → <strong>{fact.after}</strong>
                  </>
                )}
              </Typography>
            ))}
            {facts.length > 4 && (
              <Typography variant="caption" color="text.secondary">
                +{facts.length - 4} campo(s)
              </Typography>
            )}
          </Box>
        );
      },
    },
    { key: "user", label: "Usuário", render: (entry) => entry.user_username ?? "Automático" },
    { key: "ip", label: "IP", render: (entry) => entry.ip_address ?? "—" },
    { key: "reason", label: "Motivo", render: (entry) => entry.reason || "—" },
  ];

  return (
    <AppLayout>
      <PageHeader title="Auditoria" description="Registro append-only — nada aqui é editado ou apagado." />

      <TextField
        select
        label="Ação"
        sx={{ minWidth: 260, mb: 2 }}
        value={action}
        onChange={(e) => setAction(e.target.value)}
      >
        {ACTION_OPTIONS.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>

      <DataTable
        columns={columns}
        rows={logsQuery.data}
        getRowKey={(entry) => entry.id}
        loading={logsQuery.isLoading}
        error={
          logsQuery.isError
            ? getApiErrorMessage(logsQuery.error, "Não foi possível carregar a auditoria.")
            : null
        }
        onRetry={() => logsQuery.refetch()}
        size="small"
        emptyMessage="Nenhum registro de auditoria encontrado."
        defaultSortKey="created_at"
        renderCard={(entry) => <AuditEntryCard entry={entry} />}
      />
    </AppLayout>
  );
}
