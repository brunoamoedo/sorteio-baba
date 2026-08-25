import { describe, expect, it } from "vitest";

import {
  defaultFormation,
  formatFormation,
  generateFormations,
  isValidFormation,
  mapLinesToPositions,
  parseFormation,
} from "./formations";

/**
 * Estes casos são **os mesmos** de `backend/tests/test_formations.py`, de
 * propósito: o módulo é um espelho do domínio Python, e é aqui que uma
 * divergência entre os dois aparece.
 */
describe("formations", () => {
  describe("parse", () => {
    it("lê a notação do usuário", () => {
      expect(parseFormation("2-2-2")).toEqual([2, 2, 2]);
    });

    it("faz ida e volta", () => {
      expect(formatFormation(parseFormation("3-1-2-1")!)).toBe("3-1-2-1");
    });

    it.each(["", "abc", "2", "2-x", "2-0-2", "0-2"])("recusa %s", (invalida) => {
      expect(parseFormation(invalida)).toBeNull();
    });
  });

  describe("catálogo", () => {
    it.each([
      [5, ["2-1-2", "1-2-2", "2-2-1", "1-3-1"]],
      [6, ["2-2-2", "3-1-2", "2-3-1", "3-2-1", "1-3-2"]],
      [7, ["3-2-1-1", "2-3-1-1", "3-1-2-1", "2-2-2-1"]],
    ] as const)("cobre os exemplos do pedido para %i jogadores", (linePlayers, esperadas) => {
      const geradas = generateFormations(linePlayers).map((f) => f.key);
      for (const key of esperadas) {
        expect(geradas).toContain(key);
      }
    });

    it("toda formação distribui exatamente o elenco", () => {
      for (let n = 2; n <= 12; n += 1) {
        for (const formation of generateFormations(n)) {
          expect(formation.linePlayers).toBe(n);
          expect(formation.lines.reduce((a, b) => a + b, 0)).toBe(n);
        }
      }
    });

    it("nenhuma linha vazia nem superlotada", () => {
      for (let n = 2; n <= 12; n += 1) {
        for (const formation of generateFormations(n)) {
          expect(Math.min(...formation.lines)).toBeGreaterThanOrEqual(1);
          expect(Math.max(...formation.lines)).toBeLessThanOrEqual(4);
        }
      }
    });

    it("quatro linhas só a partir de sete jogadores", () => {
      expect(generateFormations(6).every((f) => f.lineCount <= 3)).toBe(true);
      expect(generateFormations(7).some((f) => f.lineCount === 4)).toBe(true);
    });

    it("a mais equilibrada vem primeiro e é marcada", () => {
      expect(generateFormations(6)[0].key).toBe("2-2-2");
      expect(generateFormations(6)[0].balanced).toBe(true);
      expect(generateFormations(8)[0].key).toBe("2-2-2-2");
      expect(defaultFormation(6)?.key).toBe("2-2-2");
    });

    it("no empate de equilíbrio vence quem tem meio-campo", () => {
      const opcoes = generateFormations(6).map((f) => f.key);
      expect(opcoes.indexOf("2-2-2")).toBeLessThan(opcoes.indexOf("3-3"));
    });

    it("elenco pequeno demais não tem formação", () => {
      expect(generateFormations(1)).toEqual([]);
      expect(defaultFormation(1)).toBeNull();
    });

    it("é estável entre chamadas — a tela guarda a escolha pela chave", () => {
      expect(generateFormations(7).map((f) => f.key)).toEqual(
        generateFormations(7).map((f) => f.key),
      );
    });

    it("só a primeira é marcada como sugerida", () => {
      const marcadas = generateFormations(7).filter((f) => f.balanced);
      expect(marcadas).toHaveLength(1);
    });
  });

  describe("validação", () => {
    it("aceita o que fecha a conta", () => {
      expect(isValidFormation([2, 2, 2], 6)).toBe(true);
    });

    it("recusa o que não fecha", () => {
      expect(isValidFormation([2, 2, 2], 7)).toBe(false);
    });

    it("aceita arranjo fora do catálogo que seja possível", () => {
      expect(isValidFormation([1, 1, 1, 1, 2], 6)).toBe(true);
    });
  });

  describe("mapeamento de linhas para posições", () => {
    const ZAG = "ZAG";
    const ME = "ME";
    const AT = "AT";

    it("uma posição por linha quando a conta bate", () => {
      expect(mapLinesToPositions(3, [ZAG, ME, AT])).toEqual([ZAG, ME, AT]);
    });

    it("quatro linhas em três posições repete a do meio", () => {
      expect(mapLinesToPositions(4, [ZAG, ME, AT])).toEqual([ZAG, ME, ME, AT]);
    });

    it("duas linhas usam os extremos", () => {
      expect(mapLinesToPositions(2, [ZAG, ME, AT])).toEqual([ZAG, AT]);
    });

    it("organização com posições extras é atendida pela mesma regra", () => {
      expect(mapLinesToPositions(3, [1, 2, 3, 4, 5])).toEqual([1, 3, 5]);
    });

    it("sem posições cadastradas não quebra", () => {
      expect(mapLinesToPositions(3, [])).toEqual([]);
    });
  });
});
