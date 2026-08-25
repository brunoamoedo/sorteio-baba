import type { ReactNode } from "react";
import { Badge, Button, Chip, Stack } from "@mui/material";

import { FilterIcon } from "../icons";
import { BottomSheet } from "./BottomSheet";

export interface ActiveFilterChip {
  /** Identidade do chip — usado como chave e no rótulo acessível. */
  key: string;
  label: string;
  onClear: () => void;
}

interface FilterSheetProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Os campos de filtro, montados por quem chama. */
  children: ReactNode;
  /** O que está filtrado agora, em chips removíveis. */
  active: ActiveFilterChip[];
  onClearAll: () => void;
  /** Quantidade de resultados, anunciada para leitor de tela ao mudar. */
  resultCount?: number;
}

/**
 * Filtros em painel, com o que está ativo em chips.
 *
 * A tela do financeiro tinha **nove** campos de filtro sempre visíveis num
 * `Stack` com quebra de linha: no celular eles ocupavam mais de uma tela
 * inteira antes de o primeiro dado aparecer. Aqui a tela mostra só um botão e
 * os chips do que realmente está filtrado; o resto mora no painel.
 */
export function FilterSheet({
  open,
  onOpen,
  onClose,
  children,
  active,
  onClearAll,
  resultCount,
}: FilterSheetProps) {
  return (
    <>
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1, flexWrap: "wrap", rowGap: 1, mb: 2 }}
      >
        <Badge badgeContent={active.length} color="primary" overlap="circular">
          <Button variant="outlined" startIcon={<FilterIcon />} onClick={onOpen}>
            Filtros
          </Button>
        </Badge>

        {active.map((chip) => (
          <Chip
            key={chip.key}
            label={chip.label}
            onDelete={chip.onClear}
            size="small"
            aria-label={`Remover filtro ${chip.label}`}
          />
        ))}

        {active.length > 1 && (
          <Button size="small" onClick={onClearAll}>
            Limpar tudo
          </Button>
        )}
      </Stack>

      {/* Anuncia a mudança de resultado para quem usa leitor de tela — sem
          isto, filtrar é uma ação sem retorno audível. */}
      {resultCount !== undefined && (
        <output aria-live="polite" style={{ position: "absolute", left: -9999 }}>
          {resultCount} resultado{resultCount === 1 ? "" : "s"}
        </output>
      )}

      <BottomSheet
        open={open}
        onClose={onClose}
        title="Filtros"
        actions={
          <Stack direction="row" spacing={1}>
            <Button variant="contained" fullWidth onClick={onClose}>
              Ver resultados
            </Button>
            <Button variant="outlined" fullWidth onClick={onClearAll}>
              Limpar
            </Button>
          </Stack>
        }
      >
        <Stack spacing={2}>{children}</Stack>
      </BottomSheet>
    </>
  );
}
