import { useState } from "react";
import { Box, Card, CardContent, Collapse, Divider, Stack, Typography } from "@mui/material";

import { ExpandIcon } from "../../shared/icons";
import { StatusChip, auditActionTone } from "../../shared/components/StatusChip";
import { formatTimestamp } from "../../core/dateTime";
import { changedFacts, describeAuditPayload } from "./auditFormat";

import type { AuditLogEntry } from "../../core/types/audit";

interface AuditEntryCardProps {
  entry: AuditLogEntry;
}

/**
 * Registro de auditoria como card, com o antes/depois legível.
 *
 * A tela anterior tinha sete colunas (incluindo IP) e **não mostrava
 * `before`/`after` em lugar nenhum** — ou seja, o conteúdo real da auditoria
 * era invisível. Para a movimentação manual de um jogador, que é o caso em que
 * a trilha mais importa, a linha dizia apenas "Jogador movido entre times".
 */
export function AuditEntryCard({ entry }: AuditEntryCardProps) {
  const [open, setOpen] = useState(false);

  const facts = changedFacts(describeAuditPayload(entry.before, entry.after));
  const hasDetails = facts.length > 0 || !!entry.reason || !!entry.ip_address;

  return (
    <Card>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1, flexWrap: "wrap", rowGap: 0.5 }}>
          <StatusChip label={entry.action_display} tone={auditActionTone(entry.action)} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {formatTimestamp(entry.created_at)}
          </Typography>
        </Stack>

        {entry.player_name && (
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 0.75, lineHeight: 1.3 }}>
            {entry.player_name}
          </Typography>
        )}

        {/* A transição de time tem FK própria na auditoria e é o caso mais
            frequente — sai destacada, sem precisar expandir. */}
        {entry.team_from_name && entry.team_to_name && (
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            {entry.team_from_name} <Box component="span" aria-label="para">→</Box>{" "}
            <Box component="strong">{entry.team_to_name}</Box>
          </Typography>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          por {entry.user_username ?? "Automático"}
        </Typography>

        {hasDetails && (
          <>
            <Box
              component="button"
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              sx={{
                mt: 1,
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                border: 0,
                background: "none",
                px: 0.5,
                // Alvo mínimo de toque, como nos `Button` do tema — um "botão
                // de texto" montado à mão não herda o override.
                minHeight: 44,
                color: "primary.main",
                font: "inherit",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {open ? "Ocultar detalhes" : "Ver detalhes"}
              <ExpandIcon
                fontSize="small"
                sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
              />
            </Box>

            <Collapse in={open} unmountOnExit>
              <Divider sx={{ my: 1 }} />
              <Stack spacing={0.75}>
                {facts.map((fact) => (
                  <Stack
                    key={fact.label}
                    direction="row"
                    sx={{ gap: 1, alignItems: "baseline", flexWrap: "wrap" }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 92 }}>
                      {fact.label}
                    </Typography>
                    {fact.value !== undefined ? (
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {fact.value}
                      </Typography>
                    ) : (
                      <Typography variant="body2">
                        <Box component="span" sx={{ textDecoration: "line-through", opacity: 0.7 }}>
                          {fact.before}
                        </Box>{" "}
                        → <Box component="strong">{fact.after}</Box>
                      </Typography>
                    )}
                  </Stack>
                ))}

                {entry.reason && (
                  <Stack direction="row" sx={{ gap: 1, alignItems: "baseline", flexWrap: "wrap" }}>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 92 }}>
                      Motivo
                    </Typography>
                    <Typography variant="body2">{entry.reason}</Typography>
                  </Stack>
                )}

                {entry.ip_address && (
                  <Stack direction="row" sx={{ gap: 1, alignItems: "baseline" }}>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 92 }}>
                      IP
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {entry.ip_address}
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </Collapse>
          </>
        )}
      </CardContent>
    </Card>
  );
}
