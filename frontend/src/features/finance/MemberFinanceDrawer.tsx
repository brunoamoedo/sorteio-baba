import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { financeApi } from "../../api/financeApi";
import { formatMatchDate, formatTimestamp } from "../../core/dateTime";
import { getApiErrorMessage, useApiQuery } from "../../core/data";
import {
  CHARGE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type Charge,
  type ChargeStatus,
  type MemberFee,
  type MemberFeeHistory,
  type Payment,
  type TimelineEntry,
} from "../../core/types/finance";
import { StatusChip } from "../../shared/components/StatusChip";
import { ChargeTimeline } from "./ChargeTimeline";
import { financeKeys, formatMoney, formatReference } from "./financeShared";

const STATUS_TONE: Record<ChargeStatus, "success" | "warning" | "error" | "default"> = {
  paid: "success",
  pending: "warning",
  overdue: "error",
  canceled: "default",
};

interface MemberFinanceDrawerProps {
  member: MemberFee | null;
  /** Todas as competências do mensalista, já filtradas pelo chamador. */
  charges: Charge[];
  canEditFee: boolean;
  canRegisterPayment: boolean;
  canCancelPayment: boolean;
  onClose: () => void;
  onChangeFee: (member: MemberFee) => void;
  onRegisterPayment: (charge: Charge) => void;
  onCancelPayment: (payment: Payment, charge: Charge) => void;
}

/**
 * Ficha financeira de um mensalista: dados → mensalidade atual → histórico de
 * valores → competências → pagamentos → auditoria.
 *
 * A ordem não é decorativa: é a sequência em que a dúvida aparece ("quanto ele
 * paga? desde quando? o que já foi cobrado? o que ele pagou? quem mexeu
 * nisso?"). Cada competência abre a própria linha do tempo, porque a pergunta
 * "por que esta competência está em aberto se ele pagou?" só se responde
 * olhando o histórico daquela competência.
 */
export function MemberFinanceDrawer({
  member,
  charges,
  canEditFee,
  canRegisterPayment,
  canCancelPayment,
  onClose,
  onChangeFee,
  onRegisterPayment,
  onCancelPayment,
}: MemberFinanceDrawerProps) {
  const [openTimeline, setOpenTimeline] = useState<number | null>(null);

  const historyQuery = useApiQuery<MemberFeeHistory>(
    financeKeys.feeHistory(member?.player_id ?? 0),
    () => financeApi.feeHistory(member!.player_id),
    { enabled: !!member },
  );

  const timelineQuery = useApiQuery<TimelineEntry[]>(
    financeKeys.timeline(openTimeline ?? 0),
    () => financeApi.timeline(openTimeline!),
    { enabled: openTimeline !== null },
  );

  if (!member) return null;

  return (
    <Drawer anchor="right" open onClose={onClose} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520 } } } }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {member.player_name}
            </Typography>
            {member.player_nickname && (
              <Typography variant="body2" color="text.secondary">
                {member.player_nickname}
              </Typography>
            )}
          </Box>
          <IconButton onClick={onClose} aria-label="Fechar">
            <CloseIcon />
          </IconButton>
        </Stack>

        {/* 1. Mensalidade atual */}
        <Box sx={{ my: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Mensalidade atual
          </Typography>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              {formatMoney(member.current_amount)}
            </Typography>
            {member.from_plan ? (
              <Chip size="small" label="Valor do plano" variant="outlined" />
            ) : (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`Desde ${formatReference(member.effective_from)}`}
              />
            )}
            {canEditFee && (
              <Button size="small" onClick={() => onChangeFee(member)}>
                Alterar
              </Button>
            )}
          </Stack>
        </Box>

        <Divider />

        {/* 2. Histórico de valores */}
        <Box sx={{ my: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Histórico de valores
          </Typography>
          {historyQuery.isError && (
            <Alert severity="warning">
              {getApiErrorMessage(historyQuery.error, "Não foi possível carregar o histórico.")}
            </Alert>
          )}
          {(historyQuery.data?.history.length ?? 0) === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Sempre usou o valor do plano da organização.
            </Typography>
          ) : (
            <Stack spacing={0.5} data-testid="fee-history">
              {historyQuery.data?.history.map((vigencia) => (
                <Box key={vigencia.id} sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 96 }}>
                    {formatMoney(vigencia.amount)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    a partir de {formatReference(vigencia.effective_from)}
                    {vigencia.created_by_name ? ` · ${vigencia.created_by_name}` : ""}
                    {vigencia.batch ? " · alteração em massa" : ""}
                    {vigencia.reason ? ` · ${vigencia.reason}` : ""}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Box>

        <Divider />

        {/* 3. Competências, com pagamentos e auditoria de cada uma */}
        <Box sx={{ my: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Competências
          </Typography>
          {charges.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nenhuma mensalidade lançada para este mensalista.
            </Typography>
          ) : (
            charges.map((charge) => (
              <Accordion
                key={charge.id}
                disableGutters
                data-testid={`charge-${charge.id}`}
                onChange={(_event, expanded) => setOpenTimeline(expanded ? charge.id : null)}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: "center", gap: 1, flexWrap: "wrap", width: "100%" }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 84 }}>
                      {formatReference(charge.reference)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      venc. {formatMatchDate(charge.due_date)}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatMoney(charge.amount)}
                    </Typography>
                    <StatusChip
                      label={CHARGE_STATUS_LABELS[charge.effective_status]}
                      tone={STATUS_TONE[charge.effective_status]}
                    />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="overline" color="text.secondary">
                    Pagamentos
                  </Typography>
                  {charge.payments.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Nenhuma baixa lançada.
                    </Typography>
                  ) : (
                    <Stack spacing={1} sx={{ mb: 2 }}>
                      {charge.payments.map((payment) => (
                        <Box
                          key={payment.id}
                          data-testid={`payment-${payment.id}`}
                          sx={{
                            p: 1,
                            borderRadius: 1,
                            border: "1px solid",
                            borderColor: "divider",
                            opacity: payment.status === "canceled" ? 0.7 : 1,
                          }}
                        >
                          <Stack
                            direction="row"
                            sx={{ justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {formatMoney(payment.amount)} ·{" "}
                              {PAYMENT_METHOD_LABELS[payment.method]} ·{" "}
                              {formatMatchDate(payment.paid_at)}
                            </Typography>
                            {payment.status === "canceled" ? (
                              <StatusChip label="Baixa cancelada" tone="error" />
                            ) : (
                              canCancelPayment && (
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => onCancelPayment(payment, charge)}
                                >
                                  Cancelar baixa
                                </Button>
                              )
                            )}
                          </Stack>
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                            Registrado por {payment.registered_by_name ?? "—"} em{" "}
                            {formatTimestamp(payment.created_at)}
                          </Typography>
                          {payment.status === "canceled" && (
                            <Typography variant="caption" color="error.main" sx={{ display: "block" }}>
                              Cancelada por {payment.cancelled_by_name ?? "—"}
                              {payment.cancelled_at ? ` em ${formatTimestamp(payment.cancelled_at)}` : ""}
                              {payment.cancellation_reason
                                ? ` · motivo: ${payment.cancellation_reason}`
                                : ""}
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Stack>
                  )}

                  {canRegisterPayment &&
                    charge.effective_status !== "paid" &&
                    charge.effective_status !== "canceled" && (
                      <Button
                        size="small"
                        variant="outlined"
                        sx={{ mb: 2 }}
                        onClick={() => onRegisterPayment(charge)}
                      >
                        💰 Dar baixa
                      </Button>
                    )}

                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    Histórico e auditoria
                  </Typography>
                  <ChargeTimeline
                    entries={openTimeline === charge.id ? (timelineQuery.data ?? []) : []}
                    isLoading={openTimeline === charge.id && timelineQuery.isLoading}
                  />
                </AccordionDetails>
              </Accordion>
            ))
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
