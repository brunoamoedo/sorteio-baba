import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";

import { financeApi } from "../../api/financeApi";
import { formatMatchDate } from "../../core/dateTime";
import { getApiErrorMessage, useApiQuery } from "../../core/data";
import { CHARGE_STATUS_LABELS, type Charge, type ChargeStatus } from "../../core/types/finance";
import { AppLayout } from "../../shared/layout/AppLayout";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip } from "../../shared/components/StatusChip";
import { formatMoney } from "./financeShared";

const STATUS_TONE: Record<ChargeStatus, "success" | "warning" | "error" | "default"> = {
  paid: "success",
  pending: "warning",
  overdue: "error",
  canceled: "default",
};

/** Auto-serviço do jogador: as **próprias** mensalidades.
 *
 * A rota do backend (`/finance/charges/mine/`) filtra pelo login — sem ficha
 * vinculada, a resposta vem vazia, nunca "todas". Esta tela é só leitura: dar
 * baixa é do gerente. */
export function MyChargesPage() {
  const query = useApiQuery<Charge[]>(["finance", "mine"], financeApi.mine);
  const charges = query.data ?? [];
  const emAberto = charges.filter((c) => c.effective_status !== "paid" && c.effective_status !== "canceled");

  return (
    <AppLayout>
      <PageHeader title="Minhas Mensalidades" />

      {query.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {getApiErrorMessage(query.error, "Não foi possível carregar suas mensalidades.")}
        </Alert>
      )}

      {!query.isLoading && charges.length === 0 && (
        <Alert severity="info">
          Você não tem mensalidades lançadas nesta organização. Se acha que deveria ter, peça ao
          gerente para vincular o seu login à sua ficha de jogador.
        </Alert>
      )}

      {emAberto.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Você tem <strong>{emAberto.length}</strong> mensalidade(s) em aberto, somando{" "}
          <strong>
            {formatMoney(
              emAberto.reduce((total, c) => total + Number(c.outstanding), 0).toFixed(2),
            )}
          </strong>
          .
        </Alert>
      )}

      <Stack spacing={1.5}>
        {charges.map((charge) => (
          <Card key={charge.id}>
            <CardContent>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
              >
                <div>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    {charge.reference} · {formatMoney(charge.amount)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Vencimento {formatMatchDate(charge.due_date)}
                    {Number(charge.paid_amount) > 0 &&
                      ` · já pago ${formatMoney(charge.paid_amount)}`}
                  </Typography>
                </div>
                <StatusChip
                  label={CHARGE_STATUS_LABELS[charge.effective_status]}
                  tone={STATUS_TONE[charge.effective_status]}
                />
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </AppLayout>
  );
}
