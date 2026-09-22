import { useState } from "react";
import { Alert, Box, Button, Chip, List, ListItem, ListItemText } from "@mui/material";

import type { QuickConfirmResolution } from "../../core/types/match";
import type { Player } from "../../core/types/player";
import { ConfirmIcon, DeclineIcon, PlayersIcon, WaitlistIcon, WarningIcon } from "../../shared/icons";
import { MensalistaSearchAutocomplete } from "./MensalistaSearchAutocomplete";

/** Cada linha processada ganha um índice estável. A chave anterior era o nome
 * digitado — colar a mesma pessoa duas vezes (comum ao copiar do WhatsApp)
 * gerava chaves React duplicadas e as linhas paravam de atualizar direito. */
export interface ResolutionRow extends QuickConfirmResolution {
  rowId: number;
}

/** Numera as linhas devolvidas pelo servidor, preservando a ordem. */
export function toResolutionRows(resolutions: QuickConfirmResolution[]): ResolutionRow[] {
  return resolutions.map((item, index) => ({ ...item, rowId: index }));
}

/**
 * Substitui **uma** linha por um mensalista escolhido à mão.
 *
 * Por `rowId`, nunca por `player_id`: duas linhas podem apontar para o mesmo
 * convidado, e filtrar por jogador reescrevia as duas de uma vez.
 */
export function applyFix(
  rows: ResolutionRow[] | null,
  rowId: number,
  player: Player,
): ResolutionRow[] | null {
  return (
    rows?.map((row) =>
      row.rowId === rowId
        ? {
            ...row,
            resolution: "mensalista" as const,
            player_id: player.id,
            player_name: player.name,
            player_type: "mensalista" as const,
            confidence: 1,
          }
        : row,
    ) ?? null
  );
}

interface QuickConfirmResolutionListProps {
  rows: ResolutionRow[];
  /** Mensalistas que ainda podem ser escolhidos nesta partida. */
  availableMensalistas: Player[];
  isLoadingOptions?: boolean;
  isFixing?: boolean;
  /** O organizador apontou quem era de verdade nesta linha. Quem chama decide
   * se isso é uma correção (`reassign`) ou uma confirmação que faltou. */
  onFix: (row: ResolutionRow, player: Player) => void;
}

/**
 * A conferência da lista colada: o que o servidor entendeu de cada linha e o
 * caminho para consertar o que ele errou.
 *
 * Extraída do `QuickConfirmDialog` para o Sorteio Avulso mostrar exatamente a
 * mesma conferência. Ela é o único momento em que o organizador vê que "Macedu"
 * virou convidado em vez de casar com "Macedo" — reescrevê-la em outra tela
 * seria reescrever a única defesa contra a lista entrar errada em campo.
 */
export function QuickConfirmResolutionList({
  rows,
  availableMensalistas,
  isLoadingOptions = false,
  isFixing = false,
  onFix,
}: QuickConfirmResolutionListProps) {
  const [fixOpenFor, setFixOpenFor] = useState<number | null>(null);

  const waitlistedCount = rows.filter((r) => r.waitlisted).length;
  const outCount = rows.filter((r) => r.resolution === "fora_da_lista").length;
  const alreadyConfirmedCount = rows.filter((r) => r.resolution === "ja_confirmado").length;
  const pendingReviewCount = rows.filter((r) => r.resolution === "convidado_criado").length;
  const invalidCount = rows.filter((r) => r.resolution === "linha_invalida").length;

  /** Quem de fato entrou na partida. As outras resoluções existem justamente
   * para **não** confirmar ninguém. */
  const enteredCount = rows.filter(
    (r) => r.resolution === "mensalista" || r.resolution === "convidado_criado",
  ).length;
  const missingCount = rows.length - enteredCount;

  return (
    <>
      {/* O fechamento de contas entre o que foi colado e o que entrou.
        *
        * Sem ele, uma lista de 24 nomes virava "23 confirmados" e não havia
        * nada na tela ligando os dois números — o organizador só descobria o
        * nome que faltou contando os jogadores na hora do sorteio. */}
      <Alert severity={missingCount > 0 ? "warning" : "success"} sx={{ mb: 2 }}>
        <strong>{rows.length}</strong> {rows.length === 1 ? "linha lida" : "linhas lidas"} →{" "}
        <strong>{enteredCount}</strong> {enteredCount === 1 ? "entrou" : "entraram"} na partida.
        {missingCount > 0 && (
          <>
            {" "}
            {missingCount === 1 ? "1 linha não entrou" : `${missingCount} linhas não entraram`} (
            {[
              outCount > 0 && `${outCount} fora da lista`,
              alreadyConfirmedCount > 0 && `${alreadyConfirmedCount} repetida(s)`,
              invalidCount > 0 && `${invalidCount} sem nome`,
            ]
              .filter(Boolean)
              .join(", ")}
            ) — veja abaixo e resolva o que for engano.
          </>
        )}
      </Alert>
      {waitlistedCount > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          A partida atingiu a capacidade configurada — {waitlistedCount} nome(s) entraram na lista
          de espera, na ordem em que foram confirmados (mensalistas na frente).
        </Alert>
      )}
      {outCount > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {outCount === 1 ? "1 linha estava marcada" : `${outCount} linhas estavam marcadas`} com
          👋/❌ (saiu da lista) e <strong>não</strong> foi confirmada. Se for engano, confirme na
          tela da partida.
        </Alert>
      )}
      {alreadyConfirmedCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {alreadyConfirmedCount === 1
            ? "1 linha aponta para alguém que já estava confirmado"
            : `${alreadyConfirmedCount} linhas apontam para alguém que já estava confirmado`}{" "}
          — nada foi alterado nelas. Pode ser a mesma pessoa repetida na lista (aí é só ignorar) ou{" "}
          <strong>outra pessoa de nome parecido</strong>: nesse caso escolha o jogador certo abaixo.
        </Alert>
      )}
      {invalidCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {invalidCount === 1
            ? "1 linha não tinha nome nenhum"
            : `${invalidCount} linhas não tinham nome nenhum`}{" "}
          (só a numeração, ou só um emoji). Nada foi confirmado nelas —{" "}
          <strong>elas continuam listadas aqui</strong> em vez de sumirem: se alguma era uma
          pessoa, escolha o jogador certo abaixo.
        </Alert>
      )}
      {pendingReviewCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {pendingReviewCount === 1
            ? "1 nome não foi reconhecido como mensalista."
            : `${pendingReviewCount} nomes não foram reconhecidos como mensalistas.`}{" "}
          Se algum for engano (é mensalista, só não bateu o nome), busque o nome certo abaixo.
        </Alert>
      )}
      <List dense disablePadding>
        {rows.map((row) => (
          <ListItem
            key={row.rowId}
            sx={{ flexDirection: "column", alignItems: "stretch", px: 0, py: 1 }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                gap: 1,
                flexWrap: "wrap",
              }}
            >
              <ListItemText
                primary={row.input_name}
                secondary={
                  row.resolution === "linha_invalida"
                    ? "Não sobrou nome nenhum depois de tirar numeração e emoji"
                    : row.resolution === "mensalista" && row.player_name !== row.parsed_name
                      ? `Reconhecido como ${row.player_name}`
                      : // Mostra o que sobrou depois de tirar numeração/emoji/anotação:
                        // é isso que explica um reconhecimento inesperado.
                        row.parsed_name !== row.input_name
                        ? `Procurado como “${row.parsed_name}”`
                        : undefined
                }
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {row.waitlisted && (
                  <Chip
                    icon={<WaitlistIcon />}
                    label={`${row.waitlist_position}º na espera`}
                    color="info"
                    size="small"
                    variant="outlined"
                  />
                )}
                {row.resolution === "fora_da_lista" ? (
                  <Chip
                    icon={<DeclineIcon />}
                    label="Fora da lista — não confirmado"
                    size="small"
                    variant="outlined"
                  />
                ) : row.resolution === "linha_invalida" ? (
                  <Chip
                    icon={<WarningIcon />}
                    label="Sem nome — não confirmado"
                    color="warning"
                    size="small"
                    variant="outlined"
                  />
                ) : row.resolution === "ja_confirmado" ? (
                  <Chip
                    icon={<PlayersIcon />}
                    label={`${row.player_name} já estava confirmado`}
                    color="warning"
                    size="small"
                    variant="outlined"
                  />
                ) : row.resolution === "mensalista" ? (
                  <Chip
                    icon={<ConfirmIcon />}
                    label="Mensalista"
                    color="success"
                    size="small"
                    variant="outlined"
                  />
                ) : (
                  <Chip
                    icon={<WarningIcon />}
                    label="Convidado (não reconhecido)"
                    color="warning"
                    size="small"
                    variant="outlined"
                  />
                )}
                {row.resolution === "mensalista" && (
                  <Button
                    size="small"
                    onClick={() =>
                      setFixOpenFor((current) => (current === row.rowId ? null : row.rowId))
                    }
                  >
                    Corrigir
                  </Button>
                )}
              </Box>
            </Box>
            {(row.resolution === "convidado_criado" ||
              row.resolution === "ja_confirmado" ||
              row.resolution === "linha_invalida" ||
              fixOpenFor === row.rowId) && (
              <MensalistaSearchAutocomplete
                // Só quem **não está confirmado** nesta partida. Quem já está
                // dentro não é uma correção possível.
                options={availableMensalistas}
                loading={isLoadingOptions}
                disabled={isFixing}
                noOptionsText="Todos os mensalistas já estão confirmados nesta partida"
                placeholder={
                  row.resolution === "ja_confirmado"
                    ? "É outra pessoa? Busque quem deveria entrar"
                    : row.resolution === "linha_invalida"
                      ? "Era alguém? Busque quem deveria entrar"
                      : "Não é essa pessoa? Busque o nome certo"
                }
                sx={{ mt: 1 }}
                onPick={(player) => {
                  onFix(row, player);
                  setFixOpenFor(null);
                }}
              />
            )}
          </ListItem>
        ))}
      </List>
    </>
  );
}
