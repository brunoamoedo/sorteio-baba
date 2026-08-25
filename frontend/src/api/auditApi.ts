import { apiClient } from "./client";
import { fetchAllPages } from "./fetchAllPages";
import type { AuditLogEntry } from "../core/types/audit";

export interface AuditLogFilters {
  action?: string;
  match?: number;
  draw?: number;
}

export const auditApi = {
  list: (filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> =>
    fetchAllPages<AuditLogEntry>(apiClient, "/audit-logs/", filters),
};
