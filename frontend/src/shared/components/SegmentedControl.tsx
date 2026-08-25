import { Box, ToggleButton, ToggleButtonGroup } from "@mui/material";

import { TOUCH } from "../theme/tokens";

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Contador ao lado do rótulo ("Confirmados 14"). */
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  segments: Segment<T>[];
  /** Rótulo do grupo para leitor de tela. */
  label: string;
  fullWidth?: boolean;
}

/**
 * Alternância entre poucas opções mutuamente exclusivas.
 *
 * Preferível a `Tabs` quando as opções são um filtro (e não seções de
 * conteúdo): ocupa menos altura, cabe inteiro em 320px e o estado selecionado
 * é lido por leitor de tela como `aria-pressed`, que é o que de fato acontece.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  segments,
  label,
  fullWidth = true,
}: SegmentedControlProps<T>) {
  return (
    // Rola na horizontal quando não cabe. Com 4 segmentos e contadores
    // ("Todos (27) · Confirmados (18) · Pendentes (4) · Espera (5)") o grupo
    // passa de 375px e estourava a página inteira. Rolar o filtro é o
    // comportamento esperado; empurrar o documento não é.
    <Box
      sx={{
        maxWidth: "100%",
        overflowX: "auto",
        // A barra de rolagem sobre um controle de 44px rouba área de toque.
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      <ToggleButtonGroup
        value={value}
        exclusive
        // `next` é nulo quando a pessoa toca no segmento que já está ativo —
        // ignorar mantém sempre uma opção selecionada, que é a semântica de filtro.
        onChange={(_, next: T | null) => next && onChange(next)}
        aria-label={label}
        fullWidth={fullWidth}
        size="small"
        sx={{
          // `min-content` deixa o grupo crescer além do container e rolar, em
          // vez de espremer os rótulos.
          minWidth: "min-content",
          "& .MuiToggleButton-root": {
            minHeight: TOUCH.min,
            textTransform: "none",
            fontWeight: 600,
            px: 1.5,
            whiteSpace: "nowrap",
          },
        }}
      >
        {segments.map((segment) => (
          <ToggleButton key={segment.value} value={segment.value}>
            {segment.label}
            {segment.count !== undefined && ` (${segment.count})`}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
