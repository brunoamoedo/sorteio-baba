import { useEffect, useState } from "react";
import { Box, Card, CardContent, LinearProgress, Stack, Typography } from "@mui/material";

const TICK_MS = 90;
const SLOTS = 6;

/** Animação exibida enquanto o sorteio roda: os nomes dos confirmados
 * embaralham em alta velocidade antes de os times serem revelados, para dar a
 * sensação de sorteio ao vivo em vez de um "spinner" genérico. */
export function DrawShuffleOverlay({ names }: { names: string[] }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((current) => current + 1), TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const pool = names.length > 0 ? names : ["…"];
  // Passos primos diferentes por slot para os nomes não girarem em bloco.
  const slots = Array.from({ length: Math.min(SLOTS, Math.max(pool.length, 2)) }, (_, index) => {
    return pool[(tick * 3 + index * 7) % pool.length];
  });

  return (
    <Card sx={{ mb: 3, overflow: "hidden" }}>
      <LinearProgress />
      <CardContent>
        <Typography variant="h6" align="center" sx={{ fontWeight: 800, mb: 2 }}>
          🎲 Sorteando os times...
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: "wrap", gap: 1, justifyContent: "center" }}
          aria-live="polite"
        >
          {slots.map((name, index) => (
            <Box
              key={index}
              sx={{
                px: 1.5,
                py: 0.75,
                borderRadius: 2,
                bgcolor: "action.hover",
                minWidth: 96,
                textAlign: "center",
                fontWeight: 600,
                fontSize: 14,
                opacity: 0.9,
              }}
            >
              {name}
            </Box>
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2 }}>
          Equilibrando estrelas, posições e quem já jogou junto nas últimas semanas…
        </Typography>
      </CardContent>
    </Card>
  );
}
