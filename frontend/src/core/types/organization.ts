export interface Organization {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
}

/** Papéis **dentro** de uma organização. O Super Administrador não está aqui
 * de propósito: ele é transversal e mora em `User.is_superadmin`. */
export type MembershipRole = "admin" | "organizador" | "jogador" | "visualizador";

export const ROLE_LABELS: Record<MembershipRole, string> = {
  admin: "Administrador",
  organizador: "Gerente",
  jogador: "Jogador",
  visualizador: "Visualizador",
};

/** Quem administra a organização. */
export const MANAGER_ROLES: MembershipRole[] = ["admin", "organizador"];

export interface Membership {
  organization: Organization;
  role: MembershipRole;
  is_active: boolean;
  /** Presente quando o acesso vem de ser Super Admin, não de um vínculo real. */
  is_superadmin_access?: boolean;
}
