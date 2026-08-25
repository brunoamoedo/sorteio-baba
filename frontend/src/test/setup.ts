import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * `window.matchMedia` não existe no jsdom, e agora o sistema depende dele em
 * dois lugares: o `useMediaQuery` do MUI (que decide tabela × card, barra
 * inferior, drawer) e a preferência inicial de tema.
 *
 * O padrão aqui é **desktop** — é o que preserva o comportamento dos testes
 * escritos antes desta mudança. Quem precisa testar o celular chama
 * `setViewport("mobile")`.
 */
type ViewportKind = "mobile" | "desktop";

let currentViewport: ViewportKind = "desktop";

/** Largura simulada por perfil. `md` (900px) é o corte de layout do sistema. */
const VIEWPORT_WIDTH: Record<ViewportKind, number> = {
  mobile: 375,
  desktop: 1280,
};

/** Resolve uma media query de largura contra a viewport simulada.
 *
 * Cobre as formas que o MUI gera (`(max-width:899.95px)`, `(min-width:900px)`)
 * e a de preferência de tema, que responde sempre "claro" nos testes. */
function matches(query: string): boolean {
  const width = VIEWPORT_WIDTH[currentViewport];

  const max = query.match(/\(max-width:\s*([\d.]+)px\)/);
  if (max) return width <= Number(max[1]);

  const min = query.match(/\(min-width:\s*([\d.]+)px\)/);
  if (min) return width >= Number(min[1]);

  return false;
}

export function setViewport(kind: ViewportKind): void {
  currentViewport = kind;
  window.innerWidth = VIEWPORT_WIDTH[kind];
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
  setViewport("desktop");
});
