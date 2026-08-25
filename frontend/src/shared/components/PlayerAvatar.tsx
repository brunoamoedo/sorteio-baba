import { Avatar, type SxProps, type Theme } from "@mui/material";

interface PlayerAvatarProps {
  name: string;
  photo?: string | null;
  size?: number;
  sx?: SxProps<Theme>;
}

/** Iniciais a partir do nome: duas letras quando há sobrenome, uma quando não.
 * É o que aparece enquanto (ou no lugar de) a foto. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** Cor derivada do nome — a mesma pessoa tem sempre a mesma cor, o que ajuda a
 * reconhecê-la na lista sem depender da foto. */
function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/**
 * Avatar do jogador, padronizado.
 *
 * As três telas que mostram jogador (Jogadores, roster da partida, fila de
 * espera) montavam o `Avatar` de um jeito diferente cada uma. Aqui, além da
 * aparência única: `loading="lazy"` — uma lista de 30 jogadores baixava 30
 * fotos em tamanho original de uma vez, no 4G, antes de a tela aparecer.
 */
export function PlayerAvatar({ name, photo, size = 40, sx }: PlayerAvatarProps) {
  return (
    <Avatar
      src={photo ?? undefined}
      alt=""
      slotProps={{ img: { loading: "lazy", decoding: "async" } }}
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        fontWeight: 700,
        bgcolor: photo ? undefined : `hsl(${hueFor(name)}, 45%, 42%)`,
        color: "#fff",
        ...sx,
      }}
    >
      {initials(name)}
    </Avatar>
  );
}
