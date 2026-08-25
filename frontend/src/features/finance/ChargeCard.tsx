import { Box, Button, Card, CardContent, Checkbox, Stack, Typography } from "@mui/material";

import { StatusChip } from "../../shared/components/StatusChip";
import { formatMatchDate } from "../../core/dateTime";
import { CHARGE_STATUS_LABELS, type Charge, type ChargeStatus } from "../../core/types/finance";
import { formatMoney, formatReference } from "./financeShared";

const STATUS_TONE: Record<ChargeStatus, "success" | "warning" | "error" | "default"> = {
  paid: "success",
  pending: "warning",
  overdue: "error",
  canceled: "default",
};

interface ChargeCardProps {
  charge: Charge;
  canRegisterPayment: boolean;
  onRegisterPayment: (charge: Charge) => void;
  onOpenMember: (charge: Charge) => void;
  /** No celular a lista é de cards, não de linhas: sem a caixa aqui a seleção
   * em massa simplesmente não existiria no telefone. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

/** Mensalidade como card. O valor é a informação principal e ganha o maior
 * peso tipográfico; a situação vira chip, que se lê sem procurar coluna. */
export function ChargeCard({
  charge,
  canRegisterPayment,
  onRegisterPayment,
  onOpenMember,
  selectable = false,
  selected = false,
  onToggleSelect,
}: ChargeCardProps) {
  const open = charge.effective_status !== "paid" && charge.effective_status !== "canceled";
  const temMulta = Number(charge.late_fee_due) > 0;

  return (
    <Card>
      <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
          {selectable && (
            <Checkbox
              size="small"
              checked={selected}
              onChange={onToggleSelect}
              slotProps={{ input: { "aria-label": `Selecionar mensalidade de ${charge.player_name}` } }}
              sx={{ mt: -0.5, ml: -1 }}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
              {charge.player_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatReference(charge.reference)} · vence {formatMatchDate(charge.due_date)}
            </Typography>
          </Box>
          <StatusChip
            label={CHARGE_STATUS_LABELS[charge.effective_status]}
            tone={STATUS_TONE[charge.effective_status]}
          />
        </Stack>

        <Stack direction="row" sx={{ alignItems: "baseline", gap: 1, mt: 1, flexWrap: "wrap" }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {/* Com multa, o número grande é o **total devido** — é ele que a
                pessoa precisa pagar. A composição vem logo abaixo: mostrar só
                "R$ 110,00" sem dizer de onde veio é o tipo de cobrança que
                gera discussão no grupo. */}
            {formatMoney(temMulta ? charge.total_due : charge.amount)}
          </Typography>
          {Number(charge.paid_amount) > 0 && Number(charge.outstanding) > 0 && (
            <Typography variant="caption" color="warning.main" sx={{ fontWeight: 700 }}>
              falta {formatMoney(charge.outstanding)}
            </Typography>
          )}
        </Stack>
        {temMulta && (
          <Typography variant="caption" color="error.main" sx={{ display: "block" }}>
            {formatMoney(charge.amount)} + {formatMoney(charge.late_fee_due)} de multa por atraso
          </Typography>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          {canRegisterPayment && open && (
            <Button size="small" variant="contained" onClick={() => onRegisterPayment(charge)}>
              Dar baixa
            </Button>
          )}
          <Button size="small" variant="outlined" onClick={() => onOpenMember(charge)}>
            Ver ficha
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
