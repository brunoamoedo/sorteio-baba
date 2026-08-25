import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type { MembershipRole, Organization } from "../core/types/organization";

/** Organização na visão do Super Admin — traz contadores que a rota comum não tem. */
export interface AdminOrganization extends Organization {
  members_count: number;
  players_count: number;
}

export interface AdminUserMembership {
  id: number;
  organization: number;
  organization_name: string;
  role: MembershipRole;
  is_active: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_superadmin: boolean;
  /** Um vínculo por organização — é isto que permite a mesma pessoa ser
   * Gerente numa pelada e Jogador em outra. */
  memberships: AdminUserMembership[];
}

export const adminApi = {
  listOrganizations: (): Promise<AdminOrganization[]> =>
    fetchAllPages<AdminOrganization>(apiClient, "/admin/organizations/"),
  createOrganization: async (name: string): Promise<AdminOrganization> => {
    const { data } = await apiClient.post<AdminOrganization>("/admin/organizations/", { name });
    return data;
  },
  updateOrganization: async (
    id: number,
    payload: Partial<Pick<AdminOrganization, "name" | "is_active">>,
  ): Promise<AdminOrganization> => {
    const { data } = await apiClient.patch<AdminOrganization>(`/admin/organizations/${id}/`, payload);
    return data;
  },
  listUsers: (): Promise<AdminUser[]> => fetchAllPages<AdminUser>(apiClient, "/admin/users/"),
  createMembership: async (payload: {
    user: number;
    organization: number;
    role: MembershipRole;
  }): Promise<AdminUserMembership> => {
    const { data } = await apiClient.post("/admin/memberships/", payload);
    return data;
  },
  updateMembership: async (
    id: number,
    payload: { role?: MembershipRole; is_active?: boolean },
  ): Promise<AdminUserMembership> => {
    const { data } = await apiClient.patch(`/admin/memberships/${id}/`, payload);
    return data;
  },
};
