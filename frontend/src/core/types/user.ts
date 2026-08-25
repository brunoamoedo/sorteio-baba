export interface User {
  id: number;
  /** Pode ser nulo: o login gerado a partir do telefone não tem e-mail. */
  email: string | null;
  username: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  /** Super Administrador: administra o sistema e acessa qualquer organização.
   * Serve **só** para decidir o que mostrar no menu — a permissão de verdade é
   * checada no servidor (`IsSuperAdmin`). */
  is_superadmin: boolean;
  /** A senha ainda é a temporária. Enquanto for `true`, o servidor recusa
   * todas as rotas exceto a troca de senha e `/me/`. */
  must_change_password: boolean;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}
