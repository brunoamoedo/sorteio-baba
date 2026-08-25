import { emitSessionExpired } from "../core/auth/sessionEvents";
import { createHttpClient } from "../core/httpClient";
import { webOrganizationStorage } from "../platform/webOrganizationStorage";
import { webTokenStorage } from "../platform/webTokenStorage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";

export const apiClient = createHttpClient({
  baseURL: API_BASE_URL,
  tokenStorage: webTokenStorage,
  organizationStorage: webOrganizationStorage,
  // Sem `window.location`: o AuthProvider escuta este evento e faz um logout
  // normal, deixando o React Router levar o usuário ao login.
  onUnauthorized: emitSessionExpired,
});
