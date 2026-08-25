import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type { MembershipRole } from "../core/types/organization";

/** Membro da organização **corrente**. Distinto de `AdminUser`, que é a visão
 * do Super Admin e cruza organizações. */
export interface OrganizationMember {
  id: number;
  user: number;
  username: string;
  email: string;
  role: MembershipRole;
  is_active: boolean;
  /** Ficha de jogador vinculada nesta organização, quando houver. Sem ela a
   * pessoa não consegue confirmar a própria presença. */
  linked_player_name: string | null;
}

export interface AddMemberPayload {
  email: string;
  role: MembershipRole;
  /** Só necessária quando ainda não existe login com esse e-mail. */
  password?: string;
  username?: string;
}

export const membersApi = {
  list: (): Promise<OrganizationMember[]> =>
    fetchAllPages<OrganizationMember>(apiClient, "/auth/members/"),
  add: async (payload: AddMemberPayload): Promise<OrganizationMember> => {
    const { data } = await apiClient.post<OrganizationMember>("/auth/members/", payload);
    return data;
  },
  update: async (
    id: number,
    payload: { role?: MembershipRole; is_active?: boolean },
  ): Promise<OrganizationMember> => {
    const { data } = await apiClient.patch<OrganizationMember>(`/auth/members/${id}/`, payload);
    return data;
  },
  remove: async (id: number): Promise<OrganizationMember> => {
    const { data } = await apiClient.delete<OrganizationMember>(`/auth/members/${id}/`);
    return data;
  },
};
