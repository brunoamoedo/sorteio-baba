import { describe, expect, it } from "vitest";

import { formatPhone, phoneError } from "./phone";

describe("formatPhone", () => {
  it("formata o celular completo", () => {
    expect(formatPhone("11914344257")).toBe("(11) 91434-4257");
    expect(formatPhone("(11) 91434-4257")).toBe("(11) 91434-4257");
  });

  it("descarta o +55 colado do WhatsApp, como o servidor faz", () => {
    expect(formatPhone("+55 11 91434-4257")).toBe("(11) 91434-4257");
    expect(formatPhone("5511914344257")).toBe("(11) 91434-4257");
  });

  it("mantém o 55 quando ele é o DDD, não o país", () => {
    // 11 dígitos começando em 55: é Rio Grande do Sul, não prefixo de país.
    expect(formatPhone("55991434425")).toBe("(55) 99143-4425");
  });

  it("não passa de 11 dígitos", () => {
    expect(formatPhone("119143442579999")).toBe("(11) 91434-4257");
  });

  it("deixa apagar até o fim — nenhum separador é devolvido sozinho", () => {
    // O caso que prende o cursor: se "(11) " voltasse a "(11) " no backspace,
    // a pessoa nunca sairia dali.
    expect(formatPhone("(11) ")).toBe("(11");
    expect(formatPhone("(11")).toBe("(11");
    expect(formatPhone("(1")).toBe("(1");
    expect(formatPhone("(")).toBe("");
    expect(formatPhone("")).toBe("");
  });

  it("vai montando a máscara conforme os dígitos chegam", () => {
    expect(formatPhone("1")).toBe("(1");
    expect(formatPhone("119")).toBe("(11) 9");
    expect(formatPhone("1191434")).toBe("(11) 91434");
    expect(formatPhone("11914344")).toBe("(11) 91434-4");
  });
});

describe("phoneError", () => {
  it("aceita o celular completo", () => {
    expect(phoneError("(11) 91434-4257")).toBeNull();
  });

  it("aceita vazio — nem toda ficha tem telefone", () => {
    expect(phoneError("")).toBeNull();
    expect(phoneError("   ")).toBeNull();
  });

  it("recusa número incompleto e diz quanto falta", () => {
    expect(phoneError("(11) 9143")).toMatch(/Faltam 5/);
  });

  it("recusa fixo de 10 dígitos", () => {
    expect(phoneError("7781024129")).toMatch(/11 dígitos/);
  });

  it("recusa 11 dígitos sem o 9 depois do DDD", () => {
    expect(phoneError("11814344257")).toMatch(/começar com 9/);
  });
});
