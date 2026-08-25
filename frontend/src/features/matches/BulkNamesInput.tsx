import type { ReactNode } from "react";
import { TextField, Typography } from "@mui/material";

/**
 * Quebra o texto colado em nomes, um por linha.
 *
 * Só remove linhas vazias e espaço em volta — **não** interpreta numeração,
 * emoji ou anotação. Essa parte é do servidor (`parse_roster_line`), e é de
 * propósito: duas implementações do mesmo reconhecimento divergiriam na
 * primeira lista fora do padrão.
 */
export function splitNames(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const DEFAULT_HELPER = (
  <>
    Cole a lista do grupo, um nome por linha —{" "}
    <strong>pode colar com numeração, emojis e anotações</strong> (“3 - Zango ♟️(Sacra) PAGO” é
    lido como “Zango”). Quem for reconhecido como mensalista já é confirmado; quem não for
    encontrado entra como convidado (e dá pra corrigir depois). Linhas marcadas com 👋 ou ❌ são
    listadas como <strong>fora da lista</strong> e não são confirmadas.
  </>
);

interface BulkNamesInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Texto explicativo acima do campo. O padrão descreve o formato aceito. */
  helper?: ReactNode;
  minRows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * O campo de lista de nomes colada.
 *
 * Vive fora do `QuickConfirmDialog` porque o Sorteio Avulso monta a lista do
 * mesmo jeito — e o formato aceito (numeração, emoji, 👋/❌) é regra de
 * negócio: explicá-lo em dois lugares diferentes é como as duas telas passam a
 * dizer coisas diferentes sobre a mesma coisa.
 */
export function BulkNamesInput({
  value,
  onChange,
  helper = DEFAULT_HELPER,
  minRows = 8,
  autoFocus = false,
  disabled = false,
}: BulkNamesInputProps) {
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {helper}
      </Typography>
      <TextField
        multiline
        minRows={minRows}
        fullWidth
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={"1 - João Busquets\n2 - Sacra\n3 - Barba\n👋 - Vitor"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}
