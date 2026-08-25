/**
 * Seleção múltipla.
 *
 * Dois comportamentos aqui não são detalhe de implementação — são o que separa
 * uma seleção correta de uma que altera o registro errado:
 *
 * 1. "Selecionar todos" marca **todo o conjunto filtrado**, não a página
 *    visível. Quem tem 87 mensalistas marca a caixa, lê "todos selecionados" e
 *    espera que sejam 87.
 * 2. Trocar o filtro descarta quem saiu da tela. Sem isso, o organizador marca
 *    cinco, filtra outra competência e a ação em massa atinge gente que ele
 *    não está mais vendo.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSelection } from "./useSelection";

const PAGINA = [1, 2, 3];

describe("useSelection", () => {
  it("começa vazia", () => {
    const { result } = renderHook(() => useSelection());

    expect(result.current.count).toBe(0);
    expect(result.current.isSelected(1)).toBe(false);
  });

  it("marca e desmarca um item", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.count).toBe(1);

    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(false);
  });

  it("marca vários", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.toggle(1));
    act(() => result.current.toggle(3));

    expect(result.current.count).toBe(2);
    expect(result.current.isSelected(2)).toBe(false);
  });

  it("selecionar todos marca o conjunto inteiro que foi passado", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.toggleAll(PAGINA));

    expect(result.current.count).toBe(3);
    expect(result.current.allSelected(PAGINA)).toBe(true);
  });

  it("selecionar todos de novo desmarca", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggleAll(PAGINA));

    act(() => result.current.toggleAll(PAGINA));

    expect(result.current.count).toBe(0);
  });

  it("com seleção parcial, selecionar todos completa em vez de limpar", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle(2));

    act(() => result.current.toggleAll(PAGINA));

    expect(result.current.count).toBe(3);
  });

  it("someSelected distingue parcial de completo", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.toggle(2));
    expect(result.current.someSelected(PAGINA)).toBe(true);
    expect(result.current.allSelected(PAGINA)).toBe(false);

    act(() => result.current.toggleAll(PAGINA));
    expect(result.current.someSelected(PAGINA)).toBe(false);
    expect(result.current.allSelected(PAGINA)).toBe(true);
  });

  it("trocar o filtro descarta quem saiu da tela", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggleAll([1, 2, 3]));

    act(() => result.current.keepOnly([2, 3, 9]));

    expect(result.current.count).toBe(2);
    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.isSelected(2)).toBe(true);
  });

  it("limpar zera tudo", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggleAll(PAGINA));

    act(() => result.current.clear());

    expect(result.current.count).toBe(0);
  });

  it("lista vazia não conta como tudo selecionado", () => {
    const { result } = renderHook(() => useSelection());

    expect(result.current.allSelected([])).toBe(false);
  });
});
