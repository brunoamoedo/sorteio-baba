import { describe, expect, it } from "vitest";

import { computeTeamsImageLayout, TEAMS_IMAGE, teamsImageColumns } from "./teamsImage";

describe("imagem única com todos os times", () => {
  it("distribui os times em colunas conforme a quantidade", () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10, 12].map(teamsImageColumns)).toEqual([1, 2, 3, 2, 3, 3, 3, 4, 4]);
  });

  it("2 times saem lado a lado numa imagem de 1080px", () => {
    const layout = computeTeamsImageLayout(2, 6);

    expect(layout).toMatchObject({ columns: 2, rows: 1, width: 1080 });
    expect(layout.cards).toHaveLength(2);
    expect(layout.cards[0].y).toBe(layout.cards[1].y);
  });

  it("com mais times a imagem cresce — o card nunca encolhe", () => {
    const few = computeTeamsImageLayout(2, 6);
    const many = computeTeamsImageLayout(8, 6);

    expect(many.cardWidth).toBe(few.cardWidth);
    expect(many.rows).toBe(3);
    expect(many.width).toBeGreaterThan(few.width);
    expect(many.height).toBeGreaterThan(few.height);
  });

  it("o card cabe o time com mais jogadores", () => {
    const layout = computeTeamsImageLayout(2, 11);
    expect(layout.cardHeight).toBeGreaterThanOrEqual(TEAMS_IMAGE.cardHeaderHeight + 11 * TEAMS_IMAGE.rowHeight);
  });

  it("nenhum card se sobrepõe a outro nem sai da imagem", () => {
    for (const count of [1, 2, 3, 4, 5, 7, 10, 13]) {
      const layout = computeTeamsImageLayout(count, 8);
      const boxes = layout.cards.map(({ x, y }) => ({
        x1: x,
        y1: y,
        x2: x + layout.cardWidth,
        y2: y + layout.cardHeight,
      }));

      for (const box of boxes) {
        expect(box.x1).toBeGreaterThanOrEqual(0);
        expect(box.y1).toBeGreaterThanOrEqual(0);
        expect(box.x2).toBeLessThanOrEqual(layout.width);
        expect(box.y2).toBeLessThanOrEqual(layout.height);
      }
      boxes.forEach((a, i) =>
        boxes.slice(i + 1).forEach((b) => {
          const overlap = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
          expect(overlap).toBe(false);
        }),
      );
    }
  });

  it("a última linha incompleta fica centralizada", () => {
    // 5 times em 3 colunas: a segunda linha tem 2 cards, no meio da imagem.
    const layout = computeTeamsImageLayout(5, 6);
    const [fourth, fifth] = layout.cards.slice(3);
    const left = fourth.x;
    const right = layout.width - (fifth.x + layout.cardWidth);

    expect(left).toBeCloseTo(right);
  });
});
