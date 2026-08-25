import { describe, expect, it } from "vitest";

import {
  currentReference,
  formatMoney,
  formatReference,
  nextReference,
  referenceOptions,
} from "./financeShared";

/** `toLocaleString` separa "R$" do número com espaço **não separável** (U+00A0).
 * Comparar com um espaço comum falharia por um caractere invisível. */
const normalize = (value: string) => value.replace(/ /g, " ");

describe("dinheiro", () => {
  it("formata a string do servidor no padrão brasileiro", () => {
    expect(normalize(formatMoney("100.00"))).toBe("R$ 100,00");
    expect(normalize(formatMoney("1234.5"))).toBe("R$ 1.234,50");
  });

  it("mostra um traço quando não há valor, em vez de R$ NaN", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("")).toBe("—");
  });
});

describe("competência", () => {
  it("exibe AAAA-MM como Mês/Ano", () => {
    expect(formatReference("2026-05")).toBe("Mai/2026");
    expect(formatReference("2026-01")).toBe("Jan/2026");
    expect(formatReference(null)).toBe("—");
  });

  it("calcula a competência de uma data", () => {
    expect(currentReference(new Date(2026, 4, 15))).toBe("2026-05");
    expect(currentReference(new Date(2026, 0, 1))).toBe("2026-01");
  });

  it("avança de competência virando o ano corretamente", () => {
    expect(nextReference("2026-05")).toBe("2026-06");
    expect(nextReference("2026-12")).toBe("2027-01");
  });

  it("oferece competências passadas e futuras em ordem", () => {
    const options = referenceOptions(2, 2, new Date(2026, 4, 10));

    expect(options).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
  });
});
