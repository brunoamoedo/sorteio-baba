/** Texto da parte "goleiros" da configuração de uma partida.
 *
 * Existe para os quatro lugares que exibem a capacidade (tela da partida,
 * listagem, dashboard e jogos recorrentes) não repetirem — e não divergirem —
 * o mesmo `if`: **0 goleiros é um valor válido**, é a pelada em que o goleiro é
 * fixo e não entra no sorteio. Escrever "+ 0 goleiro" seria confuso, e o texto
 * fixo "+ 1 goleiro" que existia antes mentia para essas peladas.
 */
export function goalkeepersSuffix(goalkeepersPerTeam: number): string {
  if (goalkeepersPerTeam <= 0) return "";
  return ` + ${goalkeepersPerTeam} goleiro${goalkeepersPerTeam > 1 ? "s" : ""}`;
}

/** Versão compacta, para colunas de tabela: "6 + 1 GOL" ou só "6". */
export function goalkeepersSuffixShort(goalkeepersPerTeam: number): string {
  return goalkeepersPerTeam > 0 ? ` + ${goalkeepersPerTeam} GOL` : "";
}
