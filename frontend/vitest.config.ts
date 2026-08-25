import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Configuração da suíte de testes do frontend.
 *
 * Separada de `vite.config.ts` de propósito: o build da aplicação não precisa
 * conhecer jsdom nem os arquivos de teste, e o Vitest não precisa do servidor
 * de desenvolvimento (porta, polling de arquivos).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Histórico de chamadas zerado entre testes — os dublês vêm de `vi.mock`,
    // que é criado uma vez por arquivo e acumularia as chamadas de todos eles.
    clearMocks: true,
    restoreMocks: true,
    // Os testes de tela montam MUI inteiro no jsdom e dirigem o formulário com
    // `userEvent`, que espera entre cada tecla. Com vários arquivos em paralelo
    // isso passa de 5s (o padrão) em máquina carregada — e o sintoma é um
    // timeout intermitente em testes que passam sozinhos. Não é lentidão do
    // código sob teste, é custo do ambiente.
    testTimeout: 20000,
  },
});
