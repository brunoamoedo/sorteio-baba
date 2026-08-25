import { useEffect, useState } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { financeApi } from "../../api/financeApi";
import { getApiErrorMessage, useApiQuery } from "../../core/data";
import type { BulkFeePreview, MemberFee, ResyncPreview, ResyncRow } from "../../core/types/finance";
import {
  currentReference,
  financeKeys,
  formatMoney,
  formatReference,
  referenceOptions,
} from "./financeShared";

/** "2 já pagas · 1 cancelada" — agrupa os motivos em vez de listar nome por
 * nome, que numa pelada de 30 mensalistas viraria um parágrafo. */
function resumoDosMotivos(linhas: ResyncRow[]): string {
  const contagem = new Map<string, number>();
  for (const linha of linhas) {
    const motivo = linha.reason ?? "fora do alcance";
    contagem.set(motivo, (contagem.get(motivo) ?? 0) + 1);
  }
  return [...contagem.entries()].map(([motivo, quantas]) => `${quantas} ${motivo}`).join(" · ");
}

interface ChangeFeeDialogProps {
  open: boolean;
  /** Alvo da alteração. Um mensalista = alteração individual; vários (ou
   * `null`, que significa "todos") = alteração em massa. */
  targets: MemberFee[] | null;
  onClose: () => void;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (payload: {
    amount: string;
    effectiveFrom: string;
    reason: string;
    playerIds: number[] | null;
    /** Aplicar o novo valor às mensalidades **em aberto** da competência. */
    resync: boolean;
  }) => Promise<unknown>;
}

/**
 * Alteração do valor da mensalidade — individual ou em massa, na mesma caixa.
 *
 * São o mesmo ato ("estes mensalistas passam a pagar X a partir da competência
 * Y"), e separá-los em duas telas duplicaria o campo de competência, o aviso de
 * não-retroatividade e a confirmação. O que muda é a **confirmação**: em massa,
 * ela é explícita e mostra o impacto antes de qualquer alteração acontecer.
 */
export function ChangeFeeDialog({
  open,
  targets,
  onClose,
  isSubmitting,
  error,
  onSubmit,
}: ChangeFeeDialogProps) {
  const isBulk = targets === null || targets.length > 1;
  const [amount, setAmount] = useState("");
  // O padrão é a **competência corrente**, não a seguinte. Com "mês que vem" o
  // organizador alterava o valor e não via nada mudar — a aba de mensalidades
  // mostra a competência atual, e uma vigência futura é invisível nela. Pior:
  // o aviso de "já lançadas" também não aparecia, porque o mês seguinte nunca
  // tem cobrança. Quem quiser agendar um reajuste continua podendo escolher.
  const [effectiveFrom, setEffectiveFrom] = useState(currentReference);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [resync, setResync] = useState(false);

  const playerIds = targets === null ? null : targets.map((target) => target.player_id);

  useEffect(() => {
    if (!open) return;
    setAmount(targets?.length === 1 ? (targets[0].current_amount ?? "") : "");
    setEffectiveFrom(currentReference());
    setReason("");
    setConfirming(false);
    setResync(false);
  }, [open, targets]);

  /** A prévia vem do servidor e **não altera nada** — é ela que permite dizer
   * "87 mensalistas, de R$ 100,00 para R$ 120,00" em vez de "tem certeza?". */
  const previewQuery = useApiQuery<BulkFeePreview>(
    [...financeKeys.memberFees(), "preview", effectiveFrom, playerIds ?? "all"],
    () => financeApi.bulkPreview(effectiveFrom, playerIds ?? undefined),
    { enabled: open && isBulk },
  );
  const preview = previewQuery.data;

  /** Quantas mensalidades **em aberto** daquela competência o novo valor pode
   * alcançar. Vale para alteração individual também, por isso é uma consulta
   * separada da prévia em massa. */
  const resyncQuery = useApiQuery<ResyncPreview>(
    [...financeKeys.charges(), "resync-preview", effectiveFrom, playerIds ?? "all"],
    () => financeApi.resyncPreview(effectiveFrom, playerIds ?? undefined),
    { enabled: open },
  );
  // `eligible_count`, não `to_update_count`: enquanto o organizador digita, a
  // vigência no banco ainda é a antiga, e "0 serão atualizadas" seria mentira.
  // O que ele precisa saber é quantas estão em aberto e ao alcance.
  const emAberto = resyncQuery.data?.eligible_count ?? 0;
  const forasDoAlcance = resyncQuery.data?.skipped ?? [];

  const valorInvalido = !amount || Number(amount) <= 0;

  const submit = async () => {
    try {
      await onSubmit({ amount, effectiveFrom, reason, playerIds, resync });
    } catch {
      /* o erro aparece no Alert acima, vindo do chamador */
    }
  };

  const titulo = isBulk
    ? "Alterar mensalidade em massa"
    : `Alterar mensalidade — ${targets?.[0]?.player_name ?? ""}`;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{titulo}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {confirming ? (
          // Passo de confirmação: nada foi alterado ainda.
          <Alert severity="warning" icon={false} data-testid="fee-change-confirmation">
            <AlertTitle sx={{ fontWeight: 800 }}>Confirme a alteração</AlertTitle>
            <Typography variant="body2">
              Você está alterando a mensalidade de{" "}
              <strong>
                {isBulk
                  ? `${preview?.players_count ?? playerIds?.length ?? 0} mensalistas`
                  : targets?.[0]?.player_name}
              </strong>
              .
            </Typography>
            <Box component="dl" sx={{ my: 1, display: "grid", gridTemplateColumns: "auto 1fr", gap: 0.5 }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                Valor atual:
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 700 }}>
                {isBulk
                  ? (preview?.current_amounts ?? []).map(formatMoney).join(" · ") || "—"
                  : formatMoney(targets?.[0]?.current_amount)}
              </Typography>
              <Typography component="dt" variant="body2" color="text.secondary">
                Novo valor:
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 700 }}>
                {formatMoney(amount)}
              </Typography>
              <Typography component="dt" variant="body2" color="text.secondary">
                A partir da competência:
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 700 }}>
                {formatReference(effectiveFrom)}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              As competências anteriores não serão alteradas.
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {emAberto > 0 && resync ? (
                <>
                  ✅ {emAberto} mensalidade(s) em aberto de {formatReference(effectiveFrom)}{" "}
                  <strong>também serão atualizadas</strong> para {formatMoney(amount)}.
                </>
              ) : emAberto > 0 ? (
                <>
                  ⚠️ {emAberto} mensalidade(s) de {formatReference(effectiveFrom)} já foram lançadas
                  e <strong>continuam com o valor atual</strong> — o novo valor vale para as
                  próximas gerações.
                </>
              ) : (
                <>
                  Nenhuma mensalidade de {formatReference(effectiveFrom)} foi lançada ainda — o novo
                  valor já vale para a geração dela.
                </>
              )}
            </Typography>
            {resync && forasDoAlcance.length > 0 && (
              <Typography variant="body2" sx={{ mt: 1 }} color="text.secondary">
                {forasDoAlcance.length} não {forasDoAlcance.length === 1 ? "será" : "serão"}{" "}
                atualizada(s): {resumoDosMotivos(forasDoAlcance)}.
              </Typography>
            )}
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {isBulk
                ? `Quantidade selecionada: ${preview?.players_count ?? playerIds?.length ?? "…"} mensalistas`
                : `Valor atual: ${formatMoney(targets?.[0]?.current_amount)}`}
            </Typography>

            <TextField
              label="Novo valor (R$)"
              type="number"
              value={amount}
              autoFocus
              slotProps={{ htmlInput: { step: "0.01", min: "0.01" } }}
              onChange={(event) => setAmount(event.target.value)}
            />

            <TextField
              select
              label="Aplicar a partir da competência"
              value={effectiveFrom}
              helperText="As competências anteriores a esta não são alteradas."
              onChange={(event) => setEffectiveFrom(event.target.value)}
            >
              {referenceOptions().map((option) => (
                <MenuItem key={option} value={option}>
                  {formatReference(option)}
                </MenuItem>
              ))}
            </TextField>

            {/* Desmarcada por padrão: aplicar o valor a uma competência já
                lançada é uma decisão, não um efeito colateral de salvar. */}
            {emAberto > 0 && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={resync}
                    onChange={(event) => setResync(event.target.checked)}
                  />
                }
                label={
                  <>
                    <Typography variant="body2">
                      Aplicar também às <strong>{emAberto}</strong> mensalidade(s) em aberto de{" "}
                      {formatReference(effectiveFrom)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Mensalidades pagas nunca são alteradas.
                    </Typography>
                  </>
                }
                sx={{ alignItems: "flex-start", ml: 0, "& .MuiCheckbox-root": { pt: 0 } }}
              />
            )}

            <TextField
              label="Motivo (opcional)"
              placeholder="Ex.: reajuste anual"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />

            {previewQuery.isError && (
              <Alert severity="warning">
                {getApiErrorMessage(previewQuery.error, "Não foi possível calcular o impacto.")}
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={confirming ? () => setConfirming(false) : onClose}>
          {confirming ? "Voltar" : "Cancelar"}
        </Button>
        {confirming ? (
          <Button variant="contained" disabled={isSubmitting} onClick={submit}>
            {isSubmitting ? "Alterando..." : "Confirmar alteração"}
          </Button>
        ) : (
          <Button variant="contained" disabled={valorInvalido} onClick={() => setConfirming(true)}>
            Continuar
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
