import { Fragment } from "react";

import type { PlayerFilters } from "../../api/playersApi";
import type { Player, Position } from "../../core/types/player";

interface PlayersPrintSheetProps {
  players: Player[];
  positions: Position[];
  organizationName?: string;
  /** Os filtros ativos na tela quando o PDF foi gerado. */
  filters: PlayerFilters;
}

const ESTRELAS_MAXIMAS = 5;

/** Paleta da folha — as mesmas cores do sistema (`theme/tokens`), repetidas
 * aqui como literais de propósito: este componente é desenhado com estilo
 * embutido, e não com o tema do MUI, porque o navegador precisa de cor
 * declarada no próprio elemento para levá-la ao papel. */
const COR = {
  titulo: "#146c2e",
  cabecalho: "#1c8639",
  cabecalhoTexto: "#ffffff",
  estrelaCheia: "#e8a33d",
  estrelaVazia: "#d6d6d6",
  mensalista: "#146c2e",
  convidado: "#c62828",
  ativo: "#1b7f37",
  inativo: "#8a8a8a",
  linhaAlternada: "#f4f7f4",
  apelido: "#5a677a",
  borda: "#d9e2d9",
} as const;

/** Nível como texto, não como ícone: `★★★☆☆` é copiável do PDF e sobrevive
 * mesmo quando alguém imprime em monocromático — aí as cheias ficam escuras e
 * as vazias claras, e a contagem continua legível. */
function estrelas(nivel: number) {
  return (
    <span style={{ letterSpacing: 1 }}>
      <span style={{ color: COR.estrelaCheia }}>{"★".repeat(nivel)}</span>
      <span style={{ color: COR.estrelaVazia }}>
        {"☆".repeat(Math.max(0, ESTRELAS_MAXIMAS - nivel))}
      </span>
    </span>
  );
}

/** Descreve os filtros ativos em português.
 *
 * Sem isto, um PDF de "só os mensalistas ativos" é indistinguível de um PDF do
 * elenco inteiro — quem recebe conta 25 nomes e conclui que a pelada tem 25
 * jogadores. A folha precisa dizer o que ela é. */
function descreveFiltros(filters: PlayerFilters): string {
  const partes: string[] = [];
  if (filters.search) partes.push(`busca "${filters.search}"`);
  if (filters.status) partes.push(filters.status === "ativo" ? "somente ativos" : "somente inativos");
  if (filters.player_type) {
    partes.push(filters.player_type === "mensalista" ? "somente mensalistas" : "somente convidados");
  }
  return partes.length ? partes.join(" · ") : "todos os jogadores do cadastro";
}

/**
 * Folha de impressão do cadastro de jogadores — a origem do "Gerar PDF".
 *
 * Não existe na tela (`print-only`): a lista da tela tem caixas de seleção,
 * botões de editar e apagar, e no celular vira cartões. Nada disso pertence a
 * um documento. Aqui é sempre uma tabela, igual no computador e no celular,
 * porque o papel tem o mesmo tamanho nos dois.
 *
 * O PDF sai pelo diálogo de impressão do próprio navegador ("Salvar como PDF"),
 * que existe no computador e no celular. Ver `printStyles.ts`.
 */
export function PlayersPrintSheet({
  players,
  positions,
  organizationName,
  filters,
}: PlayersPrintSheetProps) {
  const nomePorPosicao = new Map(positions.map((posicao) => [posicao.id, posicao.code]));
  const posicao = (id: number | null) => (id ? (nomePorPosicao.get(id) ?? "—") : "—");

  const geradoEm = new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="print-only">
      <h1 style={{ margin: 0, fontSize: 20, color: COR.titulo }}>Jogadores{organizationName ? ` · ${organizationName}` : ""}</h1>
      <p style={{ margin: "4px 0 16px", fontSize: 11, color: "#444" }}>
        {players.length} {players.length === 1 ? "jogador" : "jogadores"} · {descreveFiltros(filters)}
        <br />
        Gerado em {geradoEm}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            {["Nome", "Tipo", "Nível", "Posições", "Telefone", "Situação"].map((titulo) => (
              <th
                key={titulo}
                style={{
                  textAlign: "left",
                  background: COR.cabecalho,
                  color: COR.cabecalhoTexto,
                  padding: "6px 6px",
                  fontWeight: 700,
                }}
              >
                {titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((player, indice) => (
            <Fragment key={player.id}>
              <tr style={{ background: indice % 2 ? COR.linhaAlternada : "transparent" }}>
                <td style={{ padding: "5px 4px", borderBottom: `1px solid ${COR.borda}` }}>
                  {player.name}
                  {player.nickname && (
                    <span style={{ color: COR.apelido }}> ({player.nickname})</span>
                  )}
                </td>
                <td style={{ padding: "5px 4px", borderBottom: `1px solid ${COR.borda}` }}>
                  <span
                    style={{
                      color:
                        player.player_type === "mensalista" ? COR.mensalista : COR.convidado,
                      fontWeight: 600,
                    }}
                  >
                    {player.player_type === "mensalista" ? "Mensalista" : "Convidado"}
                  </span>
                </td>
                <td style={{ padding: "5px 4px", borderBottom: `1px solid ${COR.borda}`, whiteSpace: "nowrap" }}>
                  {estrelas(player.skill_level)}
                </td>
                <td style={{ padding: "5px 4px", borderBottom: `1px solid ${COR.borda}`, whiteSpace: "nowrap" }}>
                  {posicao(player.primary_position)}
                  {player.secondary_position ? ` / ${posicao(player.secondary_position)}` : ""}
                </td>
                <td style={{ padding: "5px 4px", borderBottom: `1px solid ${COR.borda}`, whiteSpace: "nowrap" }}>
                  {player.phone || "—"}
                </td>
                <td style={{ padding: "5px 4px", borderBottom: `1px solid ${COR.borda}` }}>
                  <span
                    style={{
                      color: player.status === "ativo" ? COR.ativo : COR.inativo,
                      fontWeight: 600,
                    }}
                  >
                    {player.status === "ativo" ? "Ativo" : "Inativo"}
                  </span>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
