import { describe, expect, it } from "vitest";

import {
  NAV_ITEMS,
  canAccessPath,
  landingPathFor,
  resolveActivePath,
  visibleNavItems,
} from "./navItems";

describe("resolveActivePath", () => {
  const paths = NAV_ITEMS.map((item) => item.path);

  it("marca o item em uma sub-rota", () => {
    // Era o bug: o drawer comparava por igualdade e, em `/partidas/123`,
    // nenhum item ficava marcado — enquanto as abas, que usavam prefixo,
    // marcavam. As duas navegações discordavam na mesma tela.
    expect(resolveActivePath(paths, "/partidas/123")).toBe("/partidas");
  });

  it('"/" só casa com a raiz, nunca como prefixo de outra rota', () => {
    expect(resolveActivePath(paths, "/")).toBe("/");
    expect(resolveActivePath(paths, "/jogadores")).toBe("/jogadores");
  });

  it("prefere o item mais específico quando dois prefixam", () => {
    expect(resolveActivePath(["/partidas", "/partidas/novas"], "/partidas/novas/1")).toBe(
      "/partidas/novas",
    );
  });

  it("devolve indefinido em rota desconhecida, em vez de marcar algo errado", () => {
    expect(resolveActivePath(paths, "/rota-que-nao-existe")).toBeUndefined();
  });

  it("não confunde prefixo de string com prefixo de caminho", () => {
    // `/minhas-partidas` começa com `/minhas-partidas`, mas nunca deve casar
    // com `/partidas`.
    expect(resolveActivePath(paths, "/minhas-partidas")).toBe("/minhas-partidas");
  });
});

describe("visibleNavItems", () => {
  it("o jogador vê apenas o que é dele", () => {
    const labels = visibleNavItems("jogador", false).map((item) => item.label);

    expect(labels).toEqual(["Minhas Partidas", "Minhas Mensalidades"]);
  });

  it("o visualizador não vê financeiro nem pessoas", () => {
    const labels = visibleNavItems("visualizador", false).map((item) => item.label);

    expect(labels).not.toContain("Financeiro");
    expect(labels).not.toContain("Pessoas");
    expect(labels).toContain("Partidas");
    expect(labels).toContain("Auditoria");
  });

  it("o organizador vê a operação e o financeiro", () => {
    const labels = visibleNavItems("organizador", false).map((item) => item.label);

    expect(labels).toContain("Financeiro");
    expect(labels).toContain("Jogadores");
    expect(labels).not.toContain("Minhas Partidas");
  });

  it("Sistema só aparece para o super administrador", () => {
    expect(visibleNavItems("admin", false).map((i) => i.label)).not.toContain("Sistema");
    expect(visibleNavItems("admin", true).map((i) => i.label)).toContain("Sistema");
  });

  it("a barra inferior nunca passa de 4 itens por papel", () => {
    for (const role of ["admin", "organizador", "visualizador", "jogador"] as const) {
      const naBarra = visibleNavItems(role, true).filter((item) => item.inBottomBar);
      expect(naBarra.length).toBeLessThanOrEqual(4);
    }
  });

  it("todo item tem ícone — o menu não pode ter linha sem identidade visual", () => {
    for (const item of visibleNavItems("admin", true)) {
      // Os ícones do MUI vêm de `React.memo`, que é um objeto com `$$typeof` —
      // não uma função. O que importa aqui é que exista algo renderizável.
      expect(item.icon).toBeDefined();
      expect(["function", "object"]).toContain(typeof item.icon);
    }
  });
});

describe("landingPathFor", () => {
  it("o jogador cai em Minhas Partidas, não no Dashboard", () => {
    // O Dashboard não é dele: o backend recusa o papel Jogador em
    // `IsOrganizationMember`. Mandá-lo para `/` produzia uma tela com erro de
    // permissão e com botões que ele não pode executar.
    expect(landingPathFor("jogador", false)).toBe("/minhas-partidas");
  });

  it.each(["admin", "organizador", "visualizador"] as const)("%s cai no início", (role) => {
    expect(landingPathFor(role, false)).toBe("/");
  });

  it("sem papel resolvido, cai na raiz — o guard cuida do resto", () => {
    expect(landingPathFor(undefined, false)).toBe("/");
  });
});

describe("canAccessPath", () => {
  it.each(["/", "/jogadores", "/financeiro", "/auditoria", "/estatisticas", "/pessoas"])(
    "o jogador não acessa %s",
    (rota) => {
      expect(canAccessPath(rota, "jogador", false)).toBe(false);
    },
  );

  it.each(["/minhas-partidas", "/minhas-mensalidades"])("o jogador acessa %s", (rota) => {
    expect(canAccessPath(rota, "jogador", false)).toBe(true);
  });

  it("o visualizador não acessa o financeiro", () => {
    expect(canAccessPath("/financeiro", "visualizador", false)).toBe(false);
    expect(canAccessPath("/partidas", "visualizador", false)).toBe(true);
  });

  it("Sistema é só do super administrador", () => {
    expect(canAccessPath("/sistema", "admin", false)).toBe(false);
    expect(canAccessPath("/sistema", "admin", true)).toBe(true);
  });

  it("rota fora do menu passa — quem decide é o servidor", () => {
    // `/partidas/25` não está no menu, mas é legítima para quem vê partidas.
    expect(canAccessPath("/partidas/25", "organizador", false)).toBe(true);
  });
});
