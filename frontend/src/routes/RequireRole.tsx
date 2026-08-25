import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../features/auth/AuthContext";
import { useOrganization } from "../features/organization/OrganizationContext";
import { canAccessPath, landingPathFor } from "../shared/layout/navItems";

/**
 * Manda o usuário para a primeira tela **que o papel dele pode ver**.
 *
 * O problema que isto resolve: o login levava todo mundo para `/`, e o
 * Dashboard não é de todo mundo. O Jogador é auto-serviço — o backend recusa
 * o papel dele em `IsOrganizationMember` de propósito — então ele caía numa
 * tela com "Você não tem permissão para esta ação" e com botões de criar jogo
 * recorrente e partida avulsa, que ele não pode executar. O mesmo valia para
 * o `*` (rota desconhecida), que redirecionava para `/`.
 *
 * Esconder item de menu nunca foi permissão: a permissão de verdade é do
 * servidor. Isto só evita mandar a pessoa para uma porta fechada.
 */
export function RequireRole({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { currentMembership } = useOrganization();
  const location = useLocation();

  const role = currentMembership?.role;
  const isSuperadmin = user?.is_superadmin;

  // Sem papel resolvido ainda: deixa passar. O `RequireOrganization` acima já
  // segura o carregamento, e adivinhar aqui causaria um redirecionamento que
  // precisaria ser desfeito.
  if (!role && !isSuperadmin) return <>{children}</>;

  if (!canAccessPath(location.pathname, role, isSuperadmin)) {
    return <Navigate to={landingPathFor(role, isSuperadmin)} replace />;
  }

  return <>{children}</>;
}
