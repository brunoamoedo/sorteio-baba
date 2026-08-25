import { Box, Typography } from "@mui/material";

import { formatTimestamp } from "../../core/dateTime";
import { PAYMENT_METHOD_LABELS, type PaymentMethod, type TimelineEntry } from "../../core/types/finance";
import { formatMoney } from "./financeShared";

interface ChargeTimelineProps {
  entries: TimelineEntry[];
  isLoading?: boolean;
}

/** Detalhe legível de um evento, montado a partir do `after` da auditoria.
 *
 * A trilha guarda os dados em JSON de propósito (cada ação tem os seus campos);
 * traduzir aqui é o que evita um `AuditLog` com uma coluna por tipo de evento. */
function describe(entry: TimelineEntry): string[] {
  const after = entry.after as Record<string, string | undefined>;
  const linhas: string[] = [];

  if (after.amount) linhas.push(`Valor: ${formatMoney(after.amount)}`);
  if (after.method) {
    linhas.push(`Forma: ${PAYMENT_METHOD_LABELS[after.method as PaymentMethod] ?? after.method}`);
  }
  if (after.paid_at) linhas.push(`Pago em: ${after.paid_at.split("-").reverse().join("/")}`);
  if (after.due_date) linhas.push(`Vencimento: ${after.due_date.split("-").reverse().join("/")}`);
  if (after.paid_amount) linhas.push(`Total recebido: ${formatMoney(after.paid_amount)}`);
  return linhas;
}

/**
 * Histórico completo da movimentação de uma competência.
 *
 * Vem da auditoria, não dos estados atuais: é a única fonte que sabe o que foi
 * desfeito. Um pagamento cancelado e relançado aparece como três eventos, na
 * ordem em que aconteceram — que é exatamente o que alguém conferindo precisa
 * ver.
 */
export function ChargeTimeline({ entries, isLoading }: ChargeTimelineProps) {
  if (isLoading) {
    return (
      <Typography variant="body2" color="text.secondary">
        Carregando histórico...
      </Typography>
    );
  }
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nenhuma movimentação registrada.
      </Typography>
    );
  }

  return (
    <Box data-testid="charge-timeline" sx={{ position: "relative", pl: 2 }}>
      {entries.map((entry, index) => (
        <Box
          key={entry.id}
          sx={{
            position: "relative",
            pb: index === entries.length - 1 ? 0 : 2,
            borderLeft: index === entries.length - 1 ? "none" : "2px solid",
            borderColor: "divider",
            pl: 2,
            ml: 0.5,
          }}
        >
          <Box
            sx={{
              position: "absolute",
              left: -6,
              top: 4,
              width: 10,
              height: 10,
              borderRadius: "50%",
              bgcolor: entry.action === "payment_canceled" ? "error.main" : "primary.main",
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {formatTimestamp(entry.created_at)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {entry.action_display}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Usuário: {entry.user ?? "sistema"}
          </Typography>
          {describe(entry).map((linha) => (
            <Typography key={linha} variant="body2" color="text.secondary">
              {linha}
            </Typography>
          ))}
          {entry.reason && (
            <Typography variant="body2" sx={{ mt: 0.5, fontStyle: "italic" }}>
              Motivo: {entry.reason}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
