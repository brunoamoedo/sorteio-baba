import { useState } from "react";
import { Autocomplete, TextField } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

import type { Player } from "../../core/types/player";

interface MensalistaSearchAutocompleteProps {
  /** Quem pode ser escolhido. Quem chama já filtrou — o componente não decide
   * elegibilidade, só apresenta. */
  options: Player[];
  onPick: (player: Player) => void;
  placeholder: string;
  noOptionsText: string;
  loading?: boolean;
  disabled?: boolean;
  /** Limpa a seleção depois de escolher. É o que permite usar o mesmo campo
   * várias vezes seguidas para **montar** uma lista; quem usa o campo para
   * corrigir uma linha específica deixa em `false`. */
  clearOnPick?: boolean;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
}

/** O nome pelo qual a pessoa é conhecida na pelada — é o que o organizador
 * digita para procurar. */
export function mensalistaLabel(player: Player): string {
  return player.nickname || player.name;
}

/**
 * Busca de mensalista por nome.
 *
 * Nasceu dentro do `QuickConfirmDialog` (corrigir a linha que o reconhecimento
 * errou) e o Sorteio Avulso precisava do mesmo campo para o caso oposto —
 * **acrescentar** alguém à lista. As duas telas compartilham o componente
 * porque a regra de exibição é a mesma (apelido na frente do nome) e porque a
 * mensagem de lista vazia é a única pista que o organizador tem de que não
 * sobrou ninguém para escolher.
 */
export function MensalistaSearchAutocomplete({
  options,
  onPick,
  placeholder,
  noOptionsText,
  loading = false,
  disabled = false,
  clearOnPick = false,
  size = "small",
  sx,
}: MensalistaSearchAutocompleteProps) {
  // Controlado para poder esvaziar sozinho: sem isso o campo fica com o último
  // nome escolhido e escolher a mesma pessoa de novo não dispara nada — o que
  // parece um clique perdido.
  const [value, setValue] = useState<Player | null>(null);

  return (
    <Autocomplete
      size={size}
      options={options}
      getOptionLabel={mensalistaLabel}
      loading={loading}
      disabled={disabled}
      noOptionsText={noOptionsText}
      value={value}
      onChange={(_, picked) => {
        if (!picked) return;
        onPick(picked);
        setValue(clearOnPick ? null : picked);
      }}
      renderInput={(params) => <TextField {...params} placeholder={placeholder} sx={sx} />}
    />
  );
}
