import { useState } from "react";
import { Box, Button, Stack, Typography, useTheme } from "@mui/material";

import { generateFormations, type Formation } from "../../core/formations";
import { PALETTE } from "../../shared/theme/tokens";
import { TOUCH } from "../../shared/theme/tokens";

interface FormationPickerProps {
  linePlayers: number;
  value: string;
  onChange: (formation: string) => void;
  /** Rótulo do grupo para leitor de tela. */
  label?: string;
}

/** Quantas opções aparecem antes do "ver todas". Com 7 jogadores de linha o
 * catálogo passa de 30 formações — despejar tudo de uma vez transforma uma
 * escolha simples em uma lista para rolar. */
const VISIBLE_BY_DEFAULT = 6;

/** Miniatura do campo com as bolinhas nas linhas da formação.
 *
 * É o que torna a escolha visual: "2-3-1" é uma abstração, o desenho é
 * imediato. Puro SVG, sem interação — o alvo de toque é o cartão inteiro. */
function FormationThumb({ lines, active }: { lines: number[]; active: boolean }) {
  const theme = useTheme();
  const colors = PALETTE[theme.palette.mode === "dark" ? "dark" : "light"];
  const dot = active ? "#ffffff" : colors.pitchLine;

  return (
    <Box
      component="svg"
      viewBox="0 0 60 76"
      aria-hidden
      sx={{ width: 52, height: 66, display: "block", borderRadius: 1 }}
    >
      <rect x="0" y="0" width="60" height="76" rx="3" fill={colors.pitchGrass} />
      <line x1="0" y1="8" x2="60" y2="8" stroke={colors.pitchLine} strokeWidth="0.6" opacity="0.6" />
      <rect x="18" y="66" width="24" height="10" fill="none" stroke={colors.pitchLine} strokeWidth="0.6" opacity="0.6" />

      {lines.map((size, lineIndex) =>
        Array.from({ length: size }).map((_, slot) => (
          <circle
            key={`${lineIndex}-${slot}`}
            cx={((slot + 1) / (size + 1)) * 60}
            cy={
              lines.length <= 1
                ? 38
                : 60 - (lineIndex / (lines.length - 1)) * 44
            }
            r="3.4"
            fill={dot}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth="0.5"
          />
        )),
      )}
    </Box>
  );
}

/**
 * Escolha da formação, em cartões visuais.
 *
 * `radiogroup` de verdade (não uma lista de botões): quem navega por teclado
 * anda entre as opções com as setas e o leitor de tela anuncia "opção 2 de 6".
 */
export function FormationPicker({
  linePlayers,
  value,
  onChange,
  label = "Formação",
}: FormationPickerProps) {
  const [showAll, setShowAll] = useState(false);
  const options = generateFormations(linePlayers);

  if (options.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Com {linePlayers} jogador(es) de linha por time não há formação a escolher.
      </Typography>
    );
  }

  // A formação escolhida sempre aparece, mesmo que esteja além do corte —
  // senão a seleção some da tela ao reabrir o painel.
  const selectedIndex = options.findIndex((option) => option.key === value);
  const visible: Formation[] = showAll
    ? options
    : [
        ...options.slice(0, VISIBLE_BY_DEFAULT),
        ...(selectedIndex >= VISIBLE_BY_DEFAULT ? [options[selectedIndex]] : []),
      ];

  return (
    <Box>
      <Box
        role="radiogroup"
        aria-label={label}
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(3, 1fr)", sm: "repeat(4, 1fr)" },
          gap: 1,
        }}
      >
        {visible.map((option) => {
          const active = option.key === value;
          return (
            <Box
              key={option.key}
              role="radio"
              aria-checked={active}
              tabIndex={active || (!value && option.balanced) ? 0 : -1}
              onClick={() => onChange(option.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChange(option.key);
                }
              }}
              sx={{
                cursor: "pointer",
                minHeight: TOUCH.comfortable,
                p: 0.75,
                borderRadius: 2,
                border: "2px solid",
                borderColor: active ? "primary.main" : "divider",
                bgcolor: active ? "action.selected" : "background.paper",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 0.5,
                transition: "border-color 120ms, background-color 120ms",
              }}
            >
              <FormationThumb lines={option.lines} active={active} />
              <Typography
                variant="caption"
                sx={{ fontWeight: active ? 800 : 600, color: active ? "primary.main" : undefined }}
              >
                {option.key}
              </Typography>
              {option.balanced && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1 }}>
                  sugerida
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>

      {options.length > VISIBLE_BY_DEFAULT && (
        <Stack direction="row" sx={{ mt: 1, justifyContent: "center" }}>
          <Button size="small" onClick={() => setShowAll((current) => !current)}>
            {showAll ? "Ver menos" : `Ver todas as ${options.length} formações`}
          </Button>
        </Stack>
      )}
    </Box>
  );
}
