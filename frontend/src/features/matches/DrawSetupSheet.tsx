import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Divider, List, ListItem, ListItemIcon, ListItemText, Stack, Typography } from "@mui/material";

import { BottomSheet } from "../../shared/components/BottomSheet";
import { ConfirmIcon, DrawIcon } from "../../shared/icons";
import { defaultFormation, generateFormations } from "../../core/formations";
import { goalkeepersSuffix } from "../../core/capacityLabel";
import { FormationPicker } from "./FormationPicker";

import type { MatchCapacity } from "../../core/types/match";

interface DrawSetupSheetProps {
  open: boolean;
  onClose: () => void;
  capacity: MatchCapacity;
  confirmedCount: number;
  /** Formação do sorteio anterior — "Sortear novamente" começa por ela. */
  initialFormation?: string;
  isDrawing: boolean;
  onDraw: (formation: string) => void;
  isRedraw: boolean;
}

/** As garantias que o algoritmo dá, em linguagem de gente.
 *
 * São **informativas**, não configuráveis: os pesos do sorteio são fixos no
 * código (decisão registrada em `REGRAS_DE_NEGOCIO.md` §13). O bloco existe
 * porque o organizador precisa saber o que o sistema garante antes de apertar
 * o botão — sem isso, o sorteio é uma caixa-preta. */
const RULES = [
  "Os jogadores mais fracos vão para times diferentes",
  "As estrelas ficam equilibradas entre os times",
  "As posições são distribuídas entre os times",
  "Convidados são espalhados, não concentrados",
  "Evita repetir as duplas dos últimos sorteios",
];

/**
 * Configuração do sorteio — o passo que não existia.
 *
 * Antes o botão disparava o sorteio direto, com a configuração da partida e
 * nada mais: não havia como escolher a formação nem sequer ver o que o
 * algoritmo ia garantir.
 */
export function DrawSetupSheet({
  open,
  onClose,
  capacity,
  confirmedCount,
  initialFormation,
  isDrawing,
  onDraw,
  isRedraw,
}: DrawSetupSheetProps) {
  // Quantos jogadores de linha cada time terá de fato — é o que define quais
  // formações são possíveis. Com mais confirmados que a capacidade, o teto da
  // configuração manda (o excedente vai para a fila antes do sorteio).
  const linePlayersPerTeam = useMemo(() => {
    const porTime = Math.floor(
      Math.min(confirmedCount, capacity.max_players) / Math.max(1, capacity.teams_count),
    );
    return Math.max(0, porTime - capacity.goalkeepers_per_team);
  }, [confirmedCount, capacity]);

  const suggested = useMemo(
    () => defaultFormation(linePlayersPerTeam)?.key ?? "",
    [linePlayersPerTeam],
  );

  /** A formação anterior só vale se ainda couber no time de agora.
   *
   * Uma partida sorteada com 6 de linha guarda, por exemplo, `2-2-2`. Se
   * depois chegarem mais confirmados e o time passar a ter 8, aquela formação
   * distribui 6 jogadores num time de 8 — o servidor recusa, e o organizador
   * via um erro sobre uma escolha que ele não tinha acabado de fazer. */
  const formacaoAindaCabe = useMemo(() => {
    if (!initialFormation) return false;
    return generateFormations(linePlayersPerTeam).some(
      (option) => option.key === initialFormation,
    );
  }, [initialFormation, linePlayersPerTeam]);

  const [formation, setFormation] = useState(
    formacaoAindaCabe && initialFormation ? initialFormation : suggested,
  );

  // Reabrir o painel parte da formação anterior — **quando ela ainda cabe**.
  // Mudou a quantidade de jogadores, a escolha volta para a sugestão do
  // tamanho novo.
  useEffect(() => {
    if (open) setFormation(formacaoAindaCabe && initialFormation ? initialFormation : suggested);
  }, [open, initialFormation, suggested, formacaoAindaCabe]);

  const canDraw = confirmedCount >= capacity.min_players;
  const missing = Math.max(0, capacity.min_players - confirmedCount);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isRedraw ? "Sortear novamente" : "Configurar sorteio"}
      // O real, não o teto configurado: com 24 confirmados numa partida de
      // teto 32, o time tem 6 de linha, não 8. O subtítulo dizia 8 enquanto o
      // corpo dizia 6, na mesma tela.
      subtitle={`${capacity.teams_count} times × (${linePlayersPerTeam} de linha${goalkeepersSuffix(
        capacity.goalkeepers_per_team,
      )})`}
      actions={
        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<DrawIcon />}
          disabled={!canDraw || isDrawing}
          onClick={() => onDraw(formation)}
        >
          {isDrawing ? "Sorteando..." : isRedraw ? "Sortear novamente" : "Sortear times"}
        </Button>
      }
    >
      <Stack spacing={2.5}>
        {!canDraw && (
          <Alert severity="warning">
            Faltam <strong>{missing}</strong> confirmado(s) para o mínimo de{" "}
            {capacity.min_players}. O sorteio libera assim que o mínimo for atingido.
          </Alert>
        )}

        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
            Jogadores
          </Typography>
          <Typography variant="body2">
            <strong>{Math.min(confirmedCount, capacity.max_players)}</strong> confirmados ·{" "}
            <strong>{linePlayersPerTeam}</strong> de linha por time
            {capacity.goalkeepers_per_team > 0
              ? ` + ${capacity.goalkeepers_per_team} goleiro(s)`
              : " · goleiro não entra no sorteio"}
          </Typography>
        </Box>

        <Divider />

        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Formação
          </Typography>
          {linePlayersPerTeam >= 2 ? (
            <>
              <FormationPicker
                linePlayers={linePlayersPerTeam}
                value={formation}
                onChange={setFormation}
              />
              <Stack direction="row" sx={{ mt: 1, justifyContent: "center" }}>
                {/* "Sem formação", não "Sortear sem formação": dois botões
                    começando com "Sortear" no mesmo painel é ambíguo — este
                    apenas limpa a escolha, quem sorteia é o do rodapé. */}
                <Button size="small" onClick={() => setFormation("")} disabled={!formation}>
                  Sem formação
                </Button>
              </Stack>
              {!formation && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  Sem formação, o campo desenha cada jogador na linha da posição cadastrada dele.
                </Typography>
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Poucos jogadores de linha por time para escolher uma formação.
            </Typography>
          )}
        </Box>

        <Divider />

        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
            O sorteio garante
          </Typography>
          <List dense disablePadding>
            {RULES.map((rule) => (
              <ListItem key={rule} disableGutters sx={{ py: 0.25 }}>
                <ListItemIcon sx={{ minWidth: 28, color: "success.main" }}>
                  <ConfirmIcon sx={{ fontSize: 16 }} />
                </ListItemIcon>
                <ListItemText
                  primary={rule}
                  slotProps={{ primary: { variant: "body2" } }}
                />
              </ListItem>
            ))}
          </List>
          <Typography variant="caption" color="text.secondary">
            A formação organiza o desenho em campo — ela não altera quem joga com quem.
          </Typography>
        </Box>
      </Stack>
    </BottomSheet>
  );
}
