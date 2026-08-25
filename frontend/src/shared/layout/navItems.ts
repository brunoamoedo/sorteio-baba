import type { ComponentType } from "react";

import {
  AuditIcon,
  DrawIcon,
  FinanceIcon,
  HomeIcon,
  MatchesIcon,
  OrganizationIcon,
  PersonAddIcon,
  PlayersIcon,
  RecurringGameIcon,
  SettingsIcon,
  StatisticsIcon,
} from "../icons";

import type { MembershipRole } from "../../core/types/organization";

export interface NavItem {
  label: string;
  /** Rótulo curto para a barra inferior, onde só cabem ~10 caracteres. */
  shortLabel?: string;
  path: string;
  icon: ComponentType<{ fontSize?: "small" | "medium" | "large" }>;
  /** Quem **enxerga** o item. Esconder é conveniência: a permissão de verdade é
   * checada no servidor, e acessar a rota por URL direta continua dando 403. */
  roles: MembershipRole[];
  /** Entra na barra inferior de navegação do celular. No máximo 4 por papel —
   * o quinto lugar é sempre o botão "Menu". */
  inBottomBar?: boolean;
}

/**
 * Itens de navegação do sistema — **fonte única** para as abas do desktop, o
 * menu hamburger e a barra inferior do celular.
 *
 * Antes a lista vivia dentro de `AppLayout.tsx` e o drawer marcava o item ativo
 * por igualdade exata enquanto as abas usavam prefixo: em `/partidas/123` as
 * duas discordavam.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Início",
    path: "/",
    icon: HomeIcon,
    roles: ["admin", "organizador", "visualizador"],
    inBottomBar: true,
  },
  {
    label: "Partidas",
    path: "/partidas",
    icon: MatchesIcon,
    roles: ["admin", "organizador", "visualizador"],
    inBottomBar: true,
  },
  {
    label: "Minhas Partidas",
    shortLabel: "Partidas",
    path: "/minhas-partidas",
    icon: MatchesIcon,
    roles: ["jogador"],
    inBottomBar: true,
  },
  {
    label: "Sorteio Avulso",
    shortLabel: "Sorteio",
    path: "/sorteio-avulso",
    icon: DrawIcon,
    // Cria partida e sorteia — o visualizador não faz nem uma coisa nem outra.
    roles: ["admin", "organizador"],
  },
  {
    label: "Jogadores",
    path: "/jogadores",
    icon: PlayersIcon,
    roles: ["admin", "organizador", "visualizador"],
    inBottomBar: true,
  },
  {
    label: "Jogos Recorrentes",
    shortLabel: "Agenda",
    path: "/jogos-recorrentes",
    icon: RecurringGameIcon,
    roles: ["admin", "organizador", "visualizador"],
  },
  {
    label: "Financeiro",
    path: "/financeiro",
    icon: FinanceIcon,
    roles: ["admin", "organizador"],
    inBottomBar: true,
  },
  {
    label: "Minhas Mensalidades",
    shortLabel: "Mensalidades",
    path: "/minhas-mensalidades",
    icon: FinanceIcon,
    roles: ["jogador"],
    inBottomBar: true,
  },
  {
    label: "Gerar Logins",
    shortLabel: "Logins",
    path: "/logins",
    icon: PersonAddIcon,
    roles: ["admin", "organizador"],
  },
  {
    label: "Pessoas",
    path: "/pessoas",
    icon: OrganizationIcon,
    roles: ["admin", "organizador"],
  },
  {
    label: "Estatísticas",
    path: "/estatisticas",
    icon: StatisticsIcon,
    roles: ["admin", "organizador", "visualizador"],
  },
  {
    label: "Auditoria",
    path: "/auditoria",
    icon: AuditIcon,
    roles: ["admin", "organizador", "visualizador"],
  },
];

/** Item exclusivo do Super Administrador — transversal, não depende de papel
 * dentro da organização. */
export const ADMIN_NAV_ITEM: NavItem = {
  label: "Sistema",
  path: "/sistema",
  icon: SettingsIcon,
  roles: [],
};

/** Itens que este usuário enxerga, na ordem em que aparecem no menu. */
export function visibleNavItems(
  role: MembershipRole | undefined,
  isSuperadmin: boolean | undefined,
): NavItem[] {
  return [
    ...NAV_ITEMS.filter((item) => !role || item.roles.includes(role)),
    ...(isSuperadmin ? [ADMIN_NAV_ITEM] : []),
  ];
}

/**
 * A primeira tela que este papel pode ver — o destino natural depois do login.
 *
 * Existe porque `/` **não é de todo mundo**: o Dashboard mostra o elenco e a
 * operação da pelada, e o Jogador é auto-serviço (`IsOrganizationMember` no
 * backend recusa o papel dele de propósito). Mandar todo mundo para `/` fazia
 * o jogador cair numa tela com erro de permissão e com ações que ele não pode
 * executar.
 *
 * Cai em `/` quando o papel ainda não foi resolvido — é o comportamento
 * anterior, e o guard de rota cuida do resto.
 */
export function landingPathFor(
  role: MembershipRole | undefined,
  isSuperadmin: boolean | undefined,
): string {
  return visibleNavItems(role, isSuperadmin)[0]?.path ?? "/";
}

/** Este papel pode abrir esta rota? Só responde sobre as rotas que estão no
 * menu — o resto é decidido pelo servidor, como sempre. */
export function canAccessPath(
  path: string,
  role: MembershipRole | undefined,
  isSuperadmin: boolean | undefined,
): boolean {
  const known = [...NAV_ITEMS, ADMIN_NAV_ITEM].some((item) => item.path === path);
  if (!known) return true;
  return visibleNavItems(role, isSuperadmin).some((item) => item.path === path);
}

/**
 * Qual item do menu representa a rota atual: o mais específico que **prefixa**
 * o caminho. `/` só casa com ele mesmo, senão prefixaria tudo.
 *
 * Existe como função porque abas, drawer e barra inferior precisam da **mesma**
 * resposta — o drawer usava igualdade exata e, em `/partidas/123`, não marcava
 * nada.
 */
export function resolveActivePath(paths: string[], pathname: string): string | undefined {
  return paths
    .filter((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)))
    .sort((a, b) => b.length - a.length)[0];
}
