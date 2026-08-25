import { Fragment, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";

import { getApiErrorMessage } from "../../core/data";
import type { Team } from "../../core/types/draw";
import { getTeamColor, getTeamLabel } from "./shareFormat";

/** Só os gols são enviados. Vitória, empate, derrota e `goals_conceded` são
 * **derivados no backend** — a regra saiu daqui porque regra de negócio no
 * cliente permitia gravar resultado inconsistente com o placar. */
export interface TeamGoalsInput {
  team_id: number;
  goals_scored: number;
}

interface ResultsDialogProps {
  open: boolean;
  onClose: () => void;
  teams: Team[];
  onSubmit: (results: TeamGoalsInput[]) => Promise<unknown>;
  isSubmitting: boolean;
}

function buildInitialGoals(teams: Team[]): Record<number, string> {
  return Object.fromEntries(teams.map((team) => [team.id, String(team.result?.goals_scored ?? 0)]));
}

function previewOutcome(goals: number[], index: number): string {
  const best = Math.max(...goals);
  const leaders = goals.filter((value) => value === best).length;
  if (goals[index] !== best) return "❌ Derrota";
  return leaders > 1 ? "🤝 Empate" : "🏆 Vitória";
}

export function ResultsDialog({ open, onClose, teams, onSubmit, isSubmitting }: ResultsDialogProps) {
  const [goals, setGoals] = useState<Record<number, string>>(() => buildInitialGoals(teams));
  const [error, setError] = useState<string | null>(null);

  // Depende apenas de `open` (e da identidade dos times), não do array inteiro:
  // antes, qualquer revalidação em segundo plano trocava a referência de
  // `teams` e **apagava o placar que o usuário estava digitando**.
  const teamIds = teams.map((team) => team.id).join(",");
  useEffect(() => {
    if (open) {
      setGoals(buildInitialGoals(teams));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teamIds]);

  const scored = teams.map((team) => Math.max(0, Number(goals[team.id] ?? 0) || 0));
  const preview =
    teams.length === 2
      ? `${getTeamLabel(0)} ${scored[0]} x ${scored[1]} ${getTeamLabel(1)}`
      : null;

  const handleSubmit = async () => {
    setError(null);
    try {
      await onSubmit(teams.map((team, index) => ({ team_id: team.id, goals_scored: scored[index] })));
      onClose();
    } catch (caught) {
      // Antes o diálogo simplesmente fechava (ou ficava aberto sem explicação)
      // e o erro só aparecia no console.
      setError(getApiErrorMessage(caught, "Não foi possível salvar o placar."));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>⚽ Lançar Placar</DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 1 }}>
          {teams.map((team, index) => (
            <Fragment key={team.id}>
              {index > 0 && (
                <Typography align="center" sx={{ fontSize: 24, my: 1 }} aria-hidden>
                  ⚔️
                </Typography>
              )}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  p: 1.5,
                  borderRadius: 2,
                  borderLeft: `4px solid ${getTeamColor(index)}`,
                  bgcolor: "action.hover",
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>🏆 {getTeamLabel(index)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {previewOutcome(scored, index)}
                  </Typography>
                </Box>
                <TextField
                  type="number"
                  size="small"
                  label="Gols"
                  value={goals[team.id] ?? "0"}
                  onChange={(event) =>
                    setGoals((previous) => ({ ...previous, [team.id]: event.target.value }))
                  }
                  slotProps={{
                    htmlInput: {
                      min: 0,
                      inputMode: "numeric",
                      "aria-label": `Gols do ${getTeamLabel(index)}`,
                    },
                  }}
                  sx={{ width: 96 }}
                />
              </Box>
            </Fragment>
          ))}
        </Box>

        {preview && (
          <Typography align="center" sx={{ mt: 2, fontWeight: 700 }}>
            🏆 {preview} 🏆
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
          Vitória, empate e derrota são calculados pelo servidor a partir dos gols. A partida será
          marcada como concluída e o placar entra na mensagem do WhatsApp.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Salvando..." : "Salvar placar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
