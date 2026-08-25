import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  Skeleton,
  Typography,
} from "@mui/material";

import { matchesApi } from "../../api/matchesApi";
import { getApiErrorMessage, useApiQuery } from "../../core/data";
import type { ConfirmedList } from "../../core/types/match";
import { ExpandIcon } from "../../shared/icons";
import { TOUCH } from "../../shared/theme/tokens";

/**
 * Quem confirmou presença, na tela do jogador.
 *
 * **Fechado por padrão.** O cartão da partida já foi encurtado uma vez porque
 * ocupava 53% da tela a 375px (ver `PLANO_MOBILE_UX_SORTEIO.md`, P-24); abrir
 * uma lista de dezoito nomes dentro dele desfaria isso. Quem quer saber toca e
 * vê; quem só quer confirmar presença não paga o espaço.
 *
 * A busca só acontece quando a seção abre — dezoito cartões na tela não podem
 * disparar dezoito consultas de uma vez.
 */
export function ConfirmedPlayersList({
  matchId,
  confirmedCount,
  maxPlayers,
}: {
  matchId: number;
  confirmedCount: number;
  maxPlayers: number;
}) {
  const [aberto, setAberto] = useState(false);

  const query = useApiQuery<ConfirmedList>(
    ["matches", matchId, "confirmed"],
    () => matchesApi.confirmed(matchId),
    { enabled: aberto },
  );

  const lista = query.data?.confirmed ?? [];

  return (
    <Accordion
      expanded={aberto}
      onChange={(_event, expandido) => setAberto(expandido)}
      disableGutters
      elevation={0}
      sx={{ bgcolor: "transparent", "&::before": { display: "none" } }}
    >
      <AccordionSummary
        expandIcon={<ExpandIcon />}
        sx={{ minHeight: TOUCH.min, px: 0, "& .MuiAccordionSummary-content": { my: 0.5 } }}
      >
        <Typography variant="body2" color="text.secondary">
          👥 {confirmedCount} de {maxPlayers} confirmados
        </Typography>
      </AccordionSummary>

      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        {query.isLoading && <Skeleton variant="rounded" height={64} />}

        {query.isError && (
          <Alert severity="warning">
            {getApiErrorMessage(query.error, "Não foi possível carregar a lista.")}
          </Alert>
        )}

        {!query.isLoading && !query.isError && lista.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Nenhum jogador confirmou presença ainda.
          </Typography>
        )}

        {lista.length > 0 && (
          // Chips que quebram em várias linhas: a 375px uma lista vertical de
          // dezoito nomes empurraria o resto do cartão para fora da tela.
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {lista.map((jogador) => (
              <Chip
                key={jogador.id}
                size="small"
                label={`✓ ${jogador.nickname || jogador.name}`}
                variant="outlined"
              />
            ))}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
