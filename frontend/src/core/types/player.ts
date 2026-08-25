export interface Position {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export type PlayerType = "mensalista" | "convidado";
export type PlayerStatus = "ativo" | "inativo";

export interface Player {
  id: number;
  /** Login vinculado a esta ficha. É a ponte com a identidade global: a mesma
   * pessoa tem um login só e uma ficha por organização. Nulo = sem vínculo, e
   * aí o perfil Jogador não encontra nada em "Minhas Partidas". */
  user: number | null;
  user_name: string | null;
  user_email: string | null;
  name: string;
  nickname: string;
  photo: string | null;
  /** Miniatura (96px) para listagens. A `photo` original só é necessária no
   * formulário de edição — baixá-la em cada linha da lista custava megabytes. */
  photo_thumb: string | null;
  phone: string;
  notes: string;
  player_type: PlayerType;
  status: PlayerStatus;
  skill_level: number;
  primary_position: number;
  secondary_position: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerFormValues {
  /** `""` significa "sem vínculo" — o `<select>` do MUI não aceita `null`. */
  user: number | "";
  name: string;
  nickname: string;
  phone: string;
  notes: string;
  player_type: PlayerType;
  status: PlayerStatus;
  skill_level: number;
  primary_position: number | "";
  secondary_position: number | "";
  photo?: FileList;
}


/** Membro da organização que pode receber uma ficha de jogador. */
export interface LinkableUser {
  id: number;
  username: string;
  email: string;
  role: string;
  /** Nome da ficha já vinculada a este login, quando houver. */
  linked_player_name: string | null;
}

/** Uma linha da aba "Gerar Logins".
 *
 * Traz **só** o que uma tela de acesso precisa: nome, telefone e situação.
 * Nível técnico e observações ficam de fora — isto não é o cadastro. */
export interface LoginStatusRow {
  player_id: number;
  player_name: string;
  player_nickname: string;
  phone: string;
  phone_digits: string;
  has_login: boolean;
  username: string | null;
  /** `null` quando a pessoa ainda não tem login. */
  must_change_password: boolean | null;
  /** Por que esta ficha **não** pode receber login. `null` quando pode. */
  blocked_reason: string | null;
}

/** Resultado de uma operação em massa: o que entrou, o que ficou de fora e
 * por quê. Mesmo formato das operações do financeiro. */
export interface BulkResult {
  processed: { player_id: number; player_name: string; username?: string }[];
  skipped: { player_id: number; player_name: string; reason: string }[];
  processed_count: number;
  skipped_count: number;
  total: number;
}
