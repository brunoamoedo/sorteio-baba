/** Remove acentos e caixa para a busca casar "Joao" com "João" — é o que a
 * pessoa digita com pressa à beira do campo.
 *
 * Vive aqui, e não dentro de uma tela, porque a mesma necessidade aparece em
 * toda lista de gente do sistema: nomes em português têm acento, e quem
 * procura raramente digita. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
