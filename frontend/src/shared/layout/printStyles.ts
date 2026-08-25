/**
 * Regras de impressão, compartilhadas por todas as telas.
 *
 * Ficam aqui, e não dentro de uma tela, porque "não imprimir o menu" vale para
 * o sistema inteiro — e antes cada tela que quisesse imprimir precisava
 * redeclarar a regra (só a de partida o fazia, então imprimir qualquer outra
 * levava o cabeçalho e a barra de navegação para o papel).
 *
 * O "gerar PDF" do sistema **é** esta impressão: o navegador tem "Salvar como
 * PDF" no próprio diálogo, no computador e no celular. Uma biblioteca de PDF
 * custaria centenas de kB no pacote para desenhar pior do que o navegador já
 * desenha, e ainda perderia a seleção de texto e a busca dentro do arquivo.
 */
export const PRINT_STYLES = {
  "@media print": {
    /** Some no papel: menus, botões, filtros, campos de busca. */
    ".no-print": { display: "none !important" },
    /** Ao contrário: existe **só** no papel. É a folha limpa, sem os controles
     * que a tela precisa ter. */
    ".print-only": { display: "block !important" },

    /** O navegador não imprime cor de fundo por padrão, e sem isto os chips e
     * as faixas de cabeçalho saem brancos e ilegíveis. */
    "*": { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" },

    /** Uma linha da tabela não pode ser partida entre duas páginas, e o
     * cabeçalho se repete no topo de cada uma — numa lista de 50 jogadores, a
     * segunda página sem cabeçalho vira uma tabela de colunas anônimas. */
    "thead": { display: "table-header-group" },
    "tr, img": { breakInside: "avoid" },

    body: { background: "#fff" },
  },
  /** Fora da impressão, a folha não existe. */
  ".print-only": { display: "none" },
} as const;
