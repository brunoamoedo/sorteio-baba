import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import { organizationsApi } from "../../api/organizationsApi";
import { getApiErrorMessage, useApiQuery } from "../../core/data";
import { webOrganizationStorage } from "../../platform/webOrganizationStorage";
import type { Membership } from "../../core/types/organization";
import { MEMBERSHIPS_QUERY_KEY, useAuth } from "../auth/AuthContext";

interface OrganizationContextValue {
  memberships: Membership[];
  isLoading: boolean;
  /** Mensagem de erro da consulta. Sem isso, uma falha de rede aparecia na tela
   * como "Nenhuma organização encontrada para o seu usuário" — um estado final
   * enganoso, sem opção de tentar de novo. */
  error: string | null;
  retry: () => void;
  currentMembership: Membership | null;
  selectOrganization: (organizationId: number) => void;
  /** Volta para a tela de seleção sem deslogar. Só faz sentido para quem
   * participa de mais de uma pelada — é o "Trocar organização" do menu. */
  clearOrganization: () => void;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [, bumpSelection] = useReducer((version: number) => version + 1, 0);

  /**
   * A organização corrente é **lida do storage a cada render**, não copiada
   * para o estado do React.
   *
   * Copiar era a origem de um 403 silencioso: o logout limpava o storage, mas o
   * estado do provider continuava apontando para a organização anterior. O
   * guard deixava a tela passar, e o cliente HTTP — que lê o storage — mandava a
   * requisição **sem** o cabeçalho `X-Organization-Id`. Com uma fonte só, os
   * dois nunca discordam.
   */
  const currentOrganizationId = webOrganizationStorage.getOrganizationId();

  const membershipsQuery = useApiQuery<Membership[]>(MEMBERSHIPS_QUERY_KEY, organizationsApi.mine, {
    enabled: isAuthenticated,
  });

  const memberships = useMemo(() => membershipsQuery.data ?? [], [membershipsQuery.data]);

  const selectOrganization = useCallback(
    (organizationId: number) => {
      webOrganizationStorage.setOrganizationId(organizationId);
      bumpSelection();
    },
    [bumpSelection],
  );

  const clearOrganization = useCallback(() => {
    webOrganizationStorage.clear();
    bumpSelection();
  }, [bumpSelection]);

  useEffect(() => {
    if (memberships.length === 0) return;
    const stillValid = memberships.some((m) => m.organization.id === currentOrganizationId);
    // Seleciona sozinho quando não há escolha a fazer — inclusive quando a
    // organização guardada no storage não pertence mais ao usuário.
    if (!stillValid && memberships.length === 1) {
      selectOrganization(memberships[0].organization.id);
    }
  }, [memberships, currentOrganizationId, selectOrganization]);

  const currentMembership = useMemo(
    () => memberships.find((m) => m.organization.id === currentOrganizationId) ?? null,
    [memberships, currentOrganizationId],
  );

  const {
    isLoading: isLoadingMemberships,
    isError: hasMembershipsError,
    error: membershipsError,
    refetch: refetchMemberships,
  } = membershipsQuery;

  const value = useMemo<OrganizationContextValue>(
    () => ({
      memberships,
      isLoading: isAuthenticated && isLoadingMemberships,
      error: hasMembershipsError
        ? getApiErrorMessage(membershipsError, "Não foi possível carregar suas organizações.")
        : null,
      retry: () => {
        void refetchMemberships();
      },
      currentMembership,
      selectOrganization,
      clearOrganization,
    }),
    [
      memberships,
      isAuthenticated,
      isLoadingMemberships,
      hasMembershipsError,
      membershipsError,
      refetchMemberships,
      currentMembership,
      selectOrganization,
      clearOrganization,
    ],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useOrganization deve ser usado dentro de um OrganizationProvider");
  }
  return context;
}
