import { Alert, AlertTitle, Box, Chip, Stack, Typography } from "@mui/material";

import type { MatchDivergence } from "../../core/types/match";

interface DivergenceWarningProps {
  divergences: MatchDivergence[];
  recurringGameName: string | null;
  /** Versão curta, para caber numa célula de tabela. */
  compact?: boolean;
}

/**
 * Aviso de que a partida está diferente do jogo recorrente que a gerou.
 *
 * Alterar um jogo recorrente **não** reescreve a partida já gerada — ela pode
 * ter confirmações e sorteio, e mudá-la por baixo seria destrutivo e
 * silencioso. Em vez disso o organizador é avisado, em vermelho, e decide:
 * edita a partida para acompanhar, ou mantém a exceção desta semana.
 */
export function DivergenceWarning({
  divergences,
  recurringGameName,
  compact = false,
}: DivergenceWarningProps) {
  if (divergences.length === 0) return null;

  if (compact) {
    return (
      <Chip
        size="small"
        color="error"
        variant="outlined"
        label={`⚠️ ${divergences.length === 1 ? "1 diferença" : `${divergences.length} diferenças`} do jogo recorrente`}
        sx={{ mt: 0.5, fontWeight: 600 }}
        title={divergences
          .map((d) => `${d.label}: partida ${d.match_value} · jogo recorrente ${d.recurring_game_value}`)
          .join("\n")}
      />
    );
  }

  return (
    <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
      <AlertTitle sx={{ fontWeight: 700 }}>
        ⚠️ Esta partida está diferente do jogo recorrente
      </AlertTitle>
      <Typography variant="body2" sx={{ mb: 1.5 }}>
        {recurringGameName ? <strong>{recurringGameName}</strong> : "O jogo recorrente"} foi alterado
        depois que esta partida foi criada. A partida <strong>não</strong> é alterada
        automaticamente para não afetar as confirmações e o sorteio que já existem. Edite a partida
        se quiser que ela acompanhe a nova configuração.
      </Typography>
      <Stack spacing={0.75}>
        {divergences.map((divergence) => (
          <Box
            key={divergence.field}
            sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 170 }}>
              {divergence.label}
            </Typography>
            <Chip size="small" color="error" label={`Esta partida: ${divergence.match_value}`} />
            <Typography variant="body2" color="text.secondary" aria-hidden>
              →
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label={`Jogo recorrente: ${divergence.recurring_game_value}`}
            />
          </Box>
        ))}
      </Stack>
    </Alert>
  );
}
