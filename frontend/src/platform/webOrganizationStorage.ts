import type { OrganizationStorage } from "../core/auth/organizationStorage";

const STORAGE_KEY = "pelada.organization.id";

export const webOrganizationStorage: OrganizationStorage = {
  getOrganizationId(): number | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) : null;
  },
  setOrganizationId(id: number): void {
    localStorage.setItem(STORAGE_KEY, String(id));
  },
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  },
};
