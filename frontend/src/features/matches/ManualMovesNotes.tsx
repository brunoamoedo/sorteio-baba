import { Alert, AlertTitle, Box, Typography } from "@mui/material";

import type { Team } from "../../core/types/draw";
import { getTeamLabel } from "./shareFormat";
import {
  describeManualMove,
  formationReport,
  skillSpread,
  teamSkillTotals,
  weakestSplitReport,
  type ManualMove,
} from "./teamComposition";

interface ManualMovesNotesProps {
  moves: ManualMove[];
  /** Composição atual — usada para conferir se as alterações manuais desfizeram
   * a regra dos piores jogadores, quebraram a formação ou pioraram o
   * equilíbrio. */
  teams: Team[];
  /** Soma de estrelas de cada time **antes** da primeira alteração manual, ou
   * seja, como o algoritmo entregou. É a única referência honesta para dizer
   * "piorou": comparar com um ideal abstrato acusaria o sorteio por um
   * desequilíbrio que o organizador acabou de criar. */
  baselineTotals: number[] | null;
}

/**
 * "Observações das alterações": o registro, logo abaixo do campo, de tudo que
 * o organizador mudou na mão depois do sorteio.
 *
 * Aparece **somente** quando existe alteração manual — um sorteio que ninguém
 * mexeu não ganha um bloco vazio na tela. O bloco não desfaz nada: se o ajuste
 * desequilibrou os times, juntou os piores jogadores ou quebrou a formação, ele
 * diz isso com números e o organizador decide.
 */
export function ManualMovesNotes({ moves, teams, baselineTotals }: ManualMovesNotesProps) {
  if (moves.length === 0) return null;

  const weakest = weakestSplitReport(teams);
  const brokeWeakestRule = weakest !== null && !weakest.satisfied;

  const currentTotals = teamSkillTotals(teams);
  const currentSpread = skillSpread(currentTotals);
  const baselineSpread = baselineTotals ? skillSpread(baselineTotals) : null;
  const worsenedBalance = baselineSpread !== null && currentSpread > baselineSpread;

  const brokenFormations = teams
    .map((team, index) => ({ index, report: formationReport(team) }))
    .filter((entry) => entry.report && !entry.report.satisfied);

  return (
    <Box sx={{ mt: 2 }} data-testid="manual-moves-notes">
      <Alert severity="warning" icon={false}>
        <AlertTitle sx={{ fontWeight: 800 }}>⚠️ Observações das alterações</AlertTitle>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Os times foram gerados automaticamente pelo sorteio — o algoritmo{" "}
          <strong>não foi executado de novo</strong>. Alterações manuais de jogadores ou posições
          são <strong>registradas na auditoria</strong>, com quem alterou e quando.
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {moves.map((move) => (
            <Typography component="li" variant="body2" key={move.id}>
              {describeManualMove(move)}
            </Typography>
          ))}
        </Box>

        {worsenedBalance && (
          <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }} data-testid="balance-warning">
            ⚠️ As alterações desequilibraram os times: o sorteio entregou{" "}
            {baselineTotals?.join(" / ")} estrelas (diferença de {baselineSpread}) e agora está{" "}
            {currentTotals.join(" / ")} (diferença de {currentSpread}). Arraste de volta para
            desfazer, ou clique em “Sortear Novamente”.
          </Typography>
        )}

        {brokeWeakestRule && (
          <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>
            ⚠️ Atenção: com estas alterações, {weakest.maxInSameTeam} jogadores de{" "}
            {weakest.weakestLevel} estrela(s) ficaram no mesmo time — o sorteio automático os
            mantinha separados.
          </Typography>
        )}

        {brokenFormations.length > 0 && (
          <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }} data-testid="formation-warning">
            ⚠️ A formação de{" "}
            {brokenFormations.map((entry) => getTeamLabel(entry.index)).join(", ")} não comporta mais
            todos os jogadores — quem ficou sem vaga aparece no campo fora do desenho. Troque a
            formação do time ou desfaça a alteração.
          </Typography>
        )}
      </Alert>
    </Box>
  );
}
