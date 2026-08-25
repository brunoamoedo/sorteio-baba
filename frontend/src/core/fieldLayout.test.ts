import { describe, expect, it } from "vitest";

import {
  computeFieldLayout,
  maxCharsFor,
  nameSizeFor,
  type FieldPlayer,
} from "./fieldLayout";

/** Largura aproximada de um nome, em unidades do viewBox.
 *
 * A fonte é ~0,55 unidade de largura por unidade de tamanho — é a proporção da
 * Inter em caixa mista. Serve para responder a pergunta que interessa: **os
 * nomes se sobrepõem?** */
function nameWidth(nameSize: number, maxChars: number): number {
  return nameSize * 0.55 * maxChars;
}

/** Largura do viewBox do campo, em unidades. */
const FIELD_WIDTH = 120;

function makePlayers(count: number, lineIndex: number): FieldPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    positionSortOrder: 2,
    lineIndex,
    slotIndex: index,
  }));
}

describe("computeFieldLayout", () => {
  describe("com formação", () => {
    it("respeita as linhas da formação", () => {
      const players: FieldPlayer[] = [
        { id: 1, positionSortOrder: 2, lineIndex: 0, slotIndex: 0 },
        { id: 2, positionSortOrder: 2, lineIndex: 0, slotIndex: 1 },
        { id: 3, positionSortOrder: 3, lineIndex: 1, slotIndex: 0 },
        { id: 4, positionSortOrder: 3, lineIndex: 1, slotIndex: 1 },
        { id: 5, positionSortOrder: 4, lineIndex: 2, slotIndex: 0 },
        { id: 6, positionSortOrder: 4, lineIndex: 2, slotIndex: 1 },
      ];

      const layout = computeFieldLayout(players, { lines: [2, 2, 2] });

      // Três alturas distintas — uma por linha.
      const alturas = new Set(layout.map((entry) => entry.y));
      expect(alturas.size).toBe(3);
    });

    it("a defesa fica embaixo e o ataque em cima", () => {
      const players: FieldPlayer[] = [
        { id: 1, positionSortOrder: 2, lineIndex: 0, slotIndex: 0 },
        { id: 2, positionSortOrder: 4, lineIndex: 2, slotIndex: 0 },
      ];

      const [defesa, ataque] = computeFieldLayout(players, { lines: [1, 1, 1] });

      expect(defesa.y).toBeGreaterThan(ataque.y);
    });

    it("desenha quatro faixas mesmo com só três posições cadastradas", () => {
      // `3-1-2-1` com ZAG/ME/AT: duas linhas compartilham a posição de meio,
      // e o campo ainda precisa mostrar quatro faixas.
      const players: FieldPlayer[] = [
        ...makePlayers(3, 0),
        { id: 10, positionSortOrder: 3, lineIndex: 1, slotIndex: 0 },
        { id: 11, positionSortOrder: 3, lineIndex: 2, slotIndex: 0 },
        { id: 12, positionSortOrder: 3, lineIndex: 2, slotIndex: 1 },
        { id: 13, positionSortOrder: 4, lineIndex: 3, slotIndex: 0 },
      ];

      const layout = computeFieldLayout(players, { lines: [3, 1, 2, 1] });
      const alturasBase = new Set(layout.map((entry) => Math.round(entry.y / 5)));

      expect(alturasBase.size).toBe(4);
    });

    it("o goleiro ganha faixa própria, abaixo de todo mundo", () => {
      const players: FieldPlayer[] = [
        { id: 99, positionSortOrder: 1, lineIndex: null, slotIndex: null },
        ...makePlayers(2, 0),
      ];

      const layout = computeFieldLayout(players, { lines: [2, 2, 2], hasGoalkeeperLine: true });
      const goleiro = layout.find((entry) => entry.id === 99)!;
      const maisBaixo = Math.max(...layout.filter((e) => e.id !== 99).map((e) => e.y));

      expect(goleiro.y).toBeGreaterThan(maisBaixo);
    });

    it("jogador excedente é desenhado, não some", () => {
      // Time com um a mais que a formação comporta (regra §6.3).
      const players: FieldPlayer[] = [
        ...makePlayers(2, 0),
        { id: 50, positionSortOrder: 3, lineIndex: null, slotIndex: null },
      ];

      const layout = computeFieldLayout(players, { lines: [2, 2, 2] });

      expect(layout).toHaveLength(3);
      expect(layout.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y))).toBe(true);
    });
  });

  describe("sem formação (comportamento preservado)", () => {
    it("agrupa pelo sort_order da posição", () => {
      const players: FieldPlayer[] = [
        { id: 1, positionSortOrder: 2 },
        { id: 2, positionSortOrder: 2 },
        { id: 3, positionSortOrder: 4 },
      ];

      const layout = computeFieldLayout(players);

      expect(layout[0].y).toBe(layout[1].y);
      expect(layout[2].y).not.toBe(layout[0].y);
    });

    it("uma posição só centraliza a linha", () => {
      const layout = computeFieldLayout([
        { id: 1, positionSortOrder: 3 },
        { id: 2, positionSortOrder: 3 },
      ]);

      expect(layout[0].y).toBe(layout[1].y);
    });
  });

  describe("legibilidade — os nomes não podem se sobrepor", () => {
    it.each([2, 3, 4, 5, 6])("linha de %i jogadores", (count) => {
      const players = makePlayers(count, 0);
      const layout = computeFieldLayout(players, { lines: [count] });

      const xs = layout.map((entry) => (entry.x / 100) * FIELD_WIDTH).sort((a, b) => a - b);
      const largura = nameWidth(layout[0].nameSize, layout[0].maxChars);

      for (let i = 1; i < xs.length; i += 1) {
        const espacamento = xs[i] - xs[i - 1];
        const mesmaAltura = layout[i].y === layout[i - 1].y;
        // Vizinhos na mesma altura precisam de espaçamento maior que a largura
        // do nome. A partir de 4, o deslocamento vertical alternado resolve os
        // pares que ficariam apertados.
        if (mesmaAltura) {
          expect(espacamento).toBeGreaterThanOrEqual(largura * 0.92);
        }
      }
    });

    it("a fonte encolhe conforme a linha lota", () => {
      expect(nameSizeFor(2)).toBeGreaterThan(nameSizeFor(4));
      expect(nameSizeFor(4)).toBeGreaterThan(nameSizeFor(6));
    });

    it("a fonte nunca fica pequena demais para ler no celular", () => {
      // A conta que este teste guardava estava errada: dizia que 2,8 unidades
      // davam "~11px efetivos". **Medido no navegador a 375px**, davam 7,9px —
      // e as estrelas, 6,5px. Abaixo de 10px já é apertar o olho.
      //
      // O número real: o campo ocupa 341px de largura num aparelho de 375, e o
      // viewBox tem 120 de largura, logo cada unidade vale 341/120 = 2,84px. O
      // piso de legibilidade em 10px pede 10 / 2,84 = 3,52 unidades.
      const ESCALA_NO_CELULAR = 341 / 120;
      const MINIMO_LEGIVEL_PX = 10;

      for (let count = 2; count <= 8; count += 1) {
        const px = nameSizeFor(count) * ESCALA_NO_CELULAR;
        expect(px).toBeGreaterThanOrEqual(MINIMO_LEGIVEL_PX);
      }
    });

    it("as estrelas, que são menores que o nome, também sobrevivem", () => {
      // `PlayerToken` desenha as estrelas a 75% do tamanho do nome. Era esse o
      // texto realmente ilegível: 6,5px no pior caso.
      const ESCALA_NO_CELULAR = 341 / 120;
      const PROPORCAO_DAS_ESTRELAS = 0.75;

      for (let count = 2; count <= 8; count += 1) {
        const px = nameSizeFor(count) * PROPORCAO_DAS_ESTRELAS * ESCALA_NO_CELULAR;
        expect(px).toBeGreaterThanOrEqual(8);
      }
    });

    it("o truncamento acompanha a lotação", () => {
      expect(maxCharsFor(2)).toBeGreaterThan(maxCharsFor(4));
      expect(maxCharsFor(6)).toBeGreaterThanOrEqual(7);
    });

    it("o goleiro cabe dentro do campo, com nome e estrelas", () => {
      // Abaixo do círculo do jogador ainda vêm o nome e as estrelas — cerca de
      // 14 unidades no total (`PlayerToken`: nome em `raio + 4,2`, estrelas em
      // `raio + 8`, mais o raio e a descida das letras). Com o goleiro em 93%
      // de um viewBox de 170, o rodapé caía em ~173 e as estrelas apareciam
      // cortadas pela borda do campo.
      const VIEWBOX_ALTURA = 170;
      const ESPACO_ABAIXO_DO_CENTRO = 14.5;

      const layout = computeFieldLayout(makePlayers(1, 0), {
        lines: [1],
        hasGoalkeeperLine: true,
      });
      const goleiro = layout[0];
      const rodape = (goleiro.y / 100) * VIEWBOX_ALTURA + ESPACO_ABAIXO_DO_CENTRO;

      expect(rodape).toBeLessThanOrEqual(VIEWBOX_ALTURA);
    });

    it("linhas cheias recebem deslocamento vertical alternado", () => {
      const layout = computeFieldLayout(makePlayers(4, 0), { lines: [4] });
      const alturas = new Set(layout.map((entry) => entry.y));

      // Sem o deslocamento seriam 4 nomes na mesma altura, a 20 unidades de
      // distância, com ~22 de largura cada.
      expect(alturas.size).toBe(2);
    });

    it("linhas curtas ficam alinhadas — o deslocamento é só quando precisa", () => {
      const layout = computeFieldLayout(makePlayers(3, 0), { lines: [3] });
      expect(new Set(layout.map((entry) => entry.y)).size).toBe(1);
    });
  });

  it("todo jogador fica dentro do campo", () => {
    const players = makePlayers(6, 0);
    const layout = computeFieldLayout(players, { lines: [6] });

    for (const entry of layout) {
      expect(entry.x).toBeGreaterThan(0);
      expect(entry.x).toBeLessThan(100);
      expect(entry.y).toBeGreaterThan(0);
      expect(entry.y).toBeLessThan(100);
    }
  });

  it("lista vazia não quebra", () => {
    expect(computeFieldLayout([])).toEqual([]);
    expect(computeFieldLayout([], { lines: [2, 2, 2] })).toEqual([]);
  });
});
