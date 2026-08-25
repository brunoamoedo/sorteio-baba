import type { ReactNode } from "react";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";

import { BOTTOM_NAV_HEIGHT } from "../layout/BottomNav";
import { TOUCH } from "../theme/tokens";

export interface BulkAction {
  key: string;
  label: string;
  /** Rótulo curto para o celular — a 375px, três ações com texto completo não
   * cabem em uma linha. */
  shortLabel?: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  color?: "primary" | "error";
}

interface BulkActionBarProps {
  count: number;
  /** Substantivo do que está selecionado: "mensalista", "mensalidade". */
  noun: string;
  nounPlural?: string;
  actions: BulkAction[];
  onClear: () => void;
}

/**
 * Barra de ações do que está selecionado.
 *
 * Recebe as ações como lista para acrescentar uma nova não exigir tocar neste
 * componente — foi o pedido explícito de "estrutura reutilizável".
 *
 * **Fixa no rodapé, acima da navegação inferior.** No celular, uma barra que
 * rola junto com a lista desaparece assim que o organizador desce para marcar
 * o décimo mensalista, e ele precisa subir de volta para agir. Fixá-la no
 * fundo sem reservar a altura da `BottomNav` seria pior: cobriria a navegação.
 */
export function BulkActionBar({
  count,
  noun,
  nounPlural,
  actions,
  onClear,
}: BulkActionBarProps) {
  if (count === 0) return null;

  const substantivo = count === 1 ? noun : (nounPlural ?? `${noun}s`);

  return (
    <Paper
      elevation={8}
      className="safe-bottom"
      role="region"
      aria-label="Ações em massa"
      sx={{
        position: "fixed",
        left: 0,
        right: 0,
        // No celular a barra inferior de navegação continua existindo: a de
        // ações senta em cima dela, não por cima.
        bottom: { xs: `${BOTTOM_NAV_HEIGHT}px`, md: 0 },
        zIndex: (t) => t.zIndex.appBar + 1,
        borderTop: "1px solid",
        borderColor: "divider",
        px: { xs: 1.5, sm: 3 },
        py: 1,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", maxWidth: 1152, mx: "auto" }}
      >
        <Box sx={{ minWidth: 0, flexShrink: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            {count}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {substantivo}
          </Typography>
        </Box>

        {/* As ações rolam quando não cabem, em vez de empurrar a largura da
            página — o erro que já apareceu no `SegmentedControl` a 375px. */}
        <Stack
          direction="row"
          spacing={1}
          sx={{ flex: 1, overflowX: "auto", minWidth: 0, py: 0.5 }}
        >
          {actions.map((action) => (
            <Button
              key={action.key}
              size="small"
              variant="contained"
              color={action.color ?? "primary"}
              startIcon={action.icon}
              disabled={action.disabled}
              onClick={action.onClick}
              sx={{ minHeight: TOUCH.min, flexShrink: 0, whiteSpace: "nowrap" }}
            >
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                {action.label}
              </Box>
              <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
                {action.shortLabel ?? action.label}
              </Box>
            </Button>
          ))}
        </Stack>

        <Button
          size="small"
          onClick={onClear}
          sx={{ minHeight: TOUCH.min, flexShrink: 0 }}
        >
          Limpar
        </Button>
      </Stack>
    </Paper>
  );
}
