import type { ComponentType, ReactNode } from "react";
import { Box, Card, CardActionArea, CardContent, Skeleton, Stack, Typography } from "@mui/material";

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Complemento abaixo do número ("de 18 vagas", "2 na espera"). */
  hint?: ReactNode;
  icon?: ComponentType<{ fontSize?: "small" | "medium" | "large" }>;
  loading?: boolean;
  onClick?: () => void;
  /** Destaque semântico do número — o saldo negativo do financeiro precisa
   * gritar, e um contador comum não. */
  tone?: "default" | "success" | "warning" | "danger";
  /** Métrica principal da tela: número maior. */
  emphasis?: boolean;
}

const TONE_COLOR = {
  default: undefined,
  success: "success.main",
  warning: "warning.main",
  danger: "error.main",
} as const;

/** Bloco de métrica. Padroniza os cartões que o dashboard e o financeiro
 * montavam à mão, cada um com uma tipografia diferente. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  loading = false,
  onClick,
  tone = "default",
  emphasis = false,
}: StatTileProps) {
  const body = (
    <CardContent sx={{ py: 2 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, mb: 0.5 }}>
        {Icon && (
          <Box sx={{ display: "flex", color: "text.secondary" }} aria-hidden>
            <Icon fontSize="small" />
          </Box>
        )}
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.3 }}>
          {label}
        </Typography>
      </Stack>

      {loading ? (
        <Skeleton variant="text" width="60%" height={emphasis ? 44 : 34} />
      ) : (
        <Typography
          variant={emphasis ? "h4" : "h5"}
          sx={{ fontWeight: 700, color: TONE_COLOR[tone], lineHeight: 1.15 }}
        >
          {value}
        </Typography>
      )}

      {hint && !loading && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
          {hint}
        </Typography>
      )}
    </CardContent>
  );

  return (
    <Card sx={{ height: "100%" }}>
      {onClick ? (
        <CardActionArea onClick={onClick} sx={{ height: "100%", alignItems: "stretch" }}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
}
