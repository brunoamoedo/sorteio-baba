import { useEffect, useState } from "react";
import {
  Alert,
  AlertTitle,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { todayIso } from "../../core/dateTime";
import {
  PAYMENT_METHOD_LABELS,
  type BulkResult,
  type BulkRow,
  type Charge,
  type PaymentMethod,
} from "../../core/types/finance";
import { formatMoney, formatReference, referenceOptions, currentReference } from "./financeShared";

/**
 * Confirmação e resultado das ações em massa.
 *
 * Três diálogos com a mesma forma: dizem **exatamente** o que vai acontecer com
 * quantos registros antes de qualquer alteração, e depois mostram o que entrou
 * e o que ficou de fora, com motivo. Um "pronto!" genérico esconderia
 * justamente o que precisa de atenção.
 */

function resumoDosMotivos(linhas: BulkRow[]): string {
  const contagem = new Map<string, number>();
  for (const linha of linhas) {
    const motivo = linha.reason ?? "não processada";
    contagem.set(motivo, (contagem.get(motivo) ?? 0) + 1);
  }
  return [...contagem.entries()].map(([motivo, n]) => `${n} ${motivo}`).join(" · ");
}

// ---------------------------------------------------------------------------

interface GenerateDialogProps {
  open: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  onConfirm: (reference: string) => void;
}

/** Gerar a competência. Não opera sobre a seleção: seleciona-se o que já
 * existe, e gerar é justamente para quem **não** tem mensalidade. */
export function GenerateChargesDialog({
  open,
  onClose,
  isSubmitting,
  onConfirm,
}: GenerateDialogProps) {
  const [reference, setReference] = useState(currentReference);

  useEffect(() => {
    if (open) setReference(currentReference());
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Gerar mensalidades</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Competência"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          >
            {referenceOptions().map((option) => (
              <MenuItem key={option} value={option}>
                {formatReference(option)}
              </MenuItem>
            ))}
          </TextField>
          <Alert severity="info">
            A mensalidade é lançada para <strong>todos os mensalistas ativos</strong> que ainda não
            têm cobrança em {formatReference(reference)}, com o valor vigente de cada um. Quem já
            tem é pulado — clicar duas vezes não cobra ninguém em dobro.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" disabled={isSubmitting} onClick={() => onConfirm(reference)}>
          {isSubmitting ? "Gerando..." : "Gerar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface DueDateDialogProps {
  open: boolean;
  charges: Charge[];
  onClose: () => void;
  isSubmitting: boolean;
  onConfirm: (dueDay: number) => void;
}

export function BulkDueDateDialog({
  open,
  charges,
  onClose,
  isSubmitting,
  onConfirm,
}: DueDateDialogProps) {
  const [dueDay, setDueDay] = useState("10");

  useEffect(() => {
    if (open) setDueDay("10");
  }, [open]);

  const dia = Number(dueDay);
  const invalido = !dueDay || dia < 1 || dia > 31;

  const pagas = charges.filter((c) => c.effective_status === "paid").length;
  const canceladas = charges.filter((c) => c.effective_status === "canceled").length;
  const alteraveis = charges.length - pagas - canceladas;

  // Adiar o vencimento de uma cobrança atrasada faz a multa deixar de incidir.
  // É consequência correta da regra, mas o organizador precisa saber antes de
  // confirmar — não descobrir depois que o total caiu.
  const perdemMulta = charges.filter(
    (c) => Number(c.late_fee_due) > 0 && c.effective_status !== "paid",
  ).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Alterar vencimento</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Novo dia do vencimento"
            type="number"
            value={dueDay}
            autoFocus
            slotProps={{ htmlInput: { min: 1, max: 31 } }}
            helperText="Em mês curto, o dia 31 escorrega para o último dia."
            onChange={(event) => setDueDay(event.target.value)}
          />

          <Alert severity="warning" icon={false} data-testid="due-date-confirmation">
            <AlertTitle sx={{ fontWeight: 800 }}>Confirme a alteração</AlertTitle>
            <Typography variant="body2">
              Você está alterando o vencimento de <strong>{alteraveis}</strong>{" "}
              mensalidade(s) para o dia <strong>{invalido ? "—" : dia}</strong>.
            </Typography>
            {(pagas > 0 || canceladas > 0) && (
              <Typography variant="body2" sx={{ mt: 1 }} color="text.secondary">
                {[pagas && `${pagas} já paga(s)`, canceladas && `${canceladas} cancelada(s)`]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                não {pagas + canceladas === 1 ? "será alterada" : "serão alteradas"}.
              </Typography>
            )}
            {perdemMulta > 0 && (
              <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>
                ⚠️ {perdemMulta} está(ão) em atraso: adiar o vencimento faz a multa deixar de
                incidir.
              </Typography>
            )}
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={invalido || isSubmitting || alteraveis === 0}
          onClick={() => onConfirm(dia)}
        >
          {isSubmitting ? "Alterando..." : "Confirmar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface BulkPaymentDialogProps {
  open: boolean;
  charges: Charge[];
  onClose: () => void;
  isSubmitting: boolean;
  onConfirm: (payload: { paid_at: string; method: PaymentMethod; notes: string }) => void;
}

export function BulkPaymentDialog({
  open,
  charges,
  onClose,
  isSubmitting,
  onConfirm,
}: BulkPaymentDialogProps) {
  const [paidAt, setPaidAt] = useState(todayIso);
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setPaidAt(todayIso());
    setMethod("pix");
    setNotes("");
  }, [open]);

  const jaPagas = charges.filter((c) => c.effective_status === "paid").length;
  const canceladas = charges.filter((c) => c.effective_status === "canceled").length;
  const aBaixar = charges.filter(
    (c) => c.effective_status !== "paid" && c.effective_status !== "canceled",
  );

  // Cada cobrança é baixada pelo **seu** total devido, com a multa da data
  // informada — não por um valor único dividido igualmente.
  const total = aBaixar.reduce((soma, charge) => {
    const multa = paidAt > charge.due_date ? Number(charge.late_fee_amount) : 0;
    return soma + Math.max(0, Number(charge.amount) + multa - Number(charge.paid_amount));
  }, 0);
  const comMulta = aBaixar.filter(
    (c) => paidAt > c.due_date && Number(c.late_fee_amount) > 0,
  ).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Dar baixa em massa</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Data do pagamento"
            type="date"
            value={paidAt}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="É ela que decide se a multa incide — não a data de hoje."
            onChange={(event) => setPaidAt(event.target.value)}
          />
          <TextField
            select
            label="Forma"
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((option) => (
              <MenuItem key={option} value={option}>
                {PAYMENT_METHOD_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Observação"
            value={notes}
            multiline
            minRows={2}
            onChange={(event) => setNotes(event.target.value)}
          />

          <Alert severity="warning" icon={false} data-testid="bulk-payment-confirmation">
            <AlertTitle sx={{ fontWeight: 800 }}>Confirme a baixa</AlertTitle>
            <Typography variant="body2">
              <strong>{aBaixar.length}</strong> mensalidade(s), total de{" "}
              <strong>{formatMoney(String(total))}</strong>.
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              Cada uma é baixada pelo próprio valor devido.
            </Typography>
            {comMulta > 0 && (
              <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>
                ⚠️ {comMulta} com multa por atraso, já incluída no total.
              </Typography>
            )}
            {(jaPagas > 0 || canceladas > 0) && (
              <Typography variant="body2" sx={{ mt: 1 }} color="text.secondary">
                {[jaPagas && `${jaPagas} já paga(s)`, canceladas && `${canceladas} cancelada(s)`]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                será(ão) pulada(s).
              </Typography>
            )}
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={isSubmitting || aBaixar.length === 0}
          onClick={() => onConfirm({ paid_at: paidAt, method, notes })}
        >
          {isSubmitting ? "Registrando..." : "Confirmar baixa"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface BulkResultDialogProps {
  title: string;
  result: BulkResult | null;
  onClose: () => void;
}

/** O que aconteceu de fato. Aparece só quando houve algo a explicar — se tudo
 * entrou, o toast já disse. */
export function BulkResultDialog({ title, result, onClose }: BulkResultDialogProps) {
  if (!result || result.skipped_count === 0) return null;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Processadas: <strong>{result.processed_count}</strong> de {result.total} ·{" "}
          {result.skipped_count} não processada(s).
        </Typography>
        <Alert severity="info" sx={{ mb: 1 }}>
          {resumoDosMotivos(result.skipped)}
        </Alert>
        <List dense disablePadding>
          {result.skipped.map((linha) => (
            <ListItem key={`${linha.player_id}-${linha.charge_id ?? ""}`} disableGutters>
              <ListItemText primary={linha.player_name} secondary={linha.reason} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Entendi
        </Button>
      </DialogActions>
    </Dialog>
  );
}
