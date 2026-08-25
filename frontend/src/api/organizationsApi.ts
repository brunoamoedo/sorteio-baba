import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type { Membership } from "../core/types/organization";

export const organizationsApi = {
  mine: (): Promise<Membership[]> =>
    fetchAllPages<Membership>(apiClient, "/auth/organizations/mine/"),
};
