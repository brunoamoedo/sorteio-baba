import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Checkbox,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { playersApi } from "../../api/playersApi";
import { getApiErrorMessage, queryStore, useApiMutation, useApiQuery } from "../../core/data";
import type { BulkResult, LoginStatusRow } from "../../core/types/player";
import { SearchIcon } from "../../shared/icons";
import { AppLayout } from "../../shared/layout/AppLayout";
import { BulkActionBar } from "../../shared/components/BulkActionBar";
import { DataTable, type DataTableColumn } from "../../shared/components/DataTable";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatusChip } from "../../shared/components/StatusChip";
import { useToast } from "../../shared/components/ToastProvider";
import { useSelection } from "../../shared/hooks/useSelection";
import { normalizeSearch } from "../../shared/searchText";
import { ConfirmDialog } from "./ConfirmDialog";

const LOGIN_STATUS_KEY = ["players", "login-status"];

/**
 * Geração de acesso para os mensalistas.
 *
 * A tela mostra **três situações** e não deixa dúvida sobre nenhuma: quem pode
 * receber login, quem já tem, e quem está impedido — com o motivo. Sem isso, o
 * organizador clica em "gerar para todos", vê "18 de 20" e não sabe quais dois
 * ficaram de fora nem o que fazer a respeito.
 *
 * A senha inicial é a mesma para todo mundo e a tela **diz qual é** — ela não
 * vem do servidor, que nunca devolve senha. É uma constante conhecida dos dois
 * lados justamente para não precisar trafegar.
 */
export function LoginsPage() {
  const { showToast } = useToast();
  const selection = useSelection<number>();
  const [confirming, setConfirming] = useState<"generate" | null>(null);
  const [resetTarget, setResetTarget] = useState<LoginStatusRow | null>(null);

  const query = useApiQuery<LoginStatusRow[]>(LOGIN_STATUS_KEY, playersApi.loginStatus);
  const linhas = useMemo(() => query.data ?? [], [query.data]);

  /** A lista inteira já vem do servidor, então a busca é local — sem ida à API
   * e sem espera. Casa por **nome ou telefone**: aqui o telefone não é um dado
   * a mais, é o próprio usuário que a pessoa vai digitar para entrar. */
  const [busca, setBusca] = useState("");
  const visiveis = useMemo(() => {
    const termo = normalizeSearch(busca.trim());
    if (!termo) return linhas;
    // Os dígitos separados: quem procura "91434" não digita a máscara.
    const digitos = termo.replace(/\D/g, "");
    return linhas.filter(
      (linha) =>
        normalizeSearch(linha.player_name).includes(termo) ||
        normalizeSearch(linha.player_nickname).includes(termo) ||
        (!!digitos && linha.phone_digits.includes(digitos)),
    );
  }, [linhas, busca]);

  /** Só quem pode receber entra na seleção: marcar quem já tem login seria
   * oferecer uma ação que o servidor vai pular de qualquer jeito. */
  const selecionaveis = useMemo(
    () => visiveis.filter((linha) => linha.blocked_reason === null).map((linha) => linha.player_id),
    [visiveis],
  );
  /** Podado contra a lista **inteira**, não contra a filtrada: quem foi
   * selecionado e depois saiu de vista pela busca continua selecionado — a
   * barra de ações mostra a contagem, e perder a seleção ao digitar seria
   * exatamente o contrário do que a busca serve para fazer. */
  const todosSelecionaveis = useMemo(
    () => linhas.filter((linha) => linha.blocked_reason === null).map((linha) => linha.player_id),
    [linhas],
  );
  useEffect(() => {
    selection.keepOnly(todosSelecionaveis);
  }, [todosSelecionaveis, selection]);

  const invalidate = () => queryStore.invalidate(LOGIN_STATUS_KEY);

  const generateMutation = useApiMutation(
    (playerIds: number[] | undefined) => playersApi.generateLogins(playerIds),
    {
      onSuccess: (resultado: BulkResult) => {
        invalidate();
        selection.clear();
        setConfirming(null);
        const puladas =
          resultado.skipped_count > 0 ? ` · ${resultado.skipped_count} não gerado(s)` : "";
        showToast(`${resultado.processed_count} login(s) criado(s)${puladas}.`);
      },
      onError: (error) =>
        showToast(getApiErrorMessage(error, "Não foi possível gerar os logins."), "error"),
    },
  );

  const resetMutation = useApiMutation((playerId: number) => playersApi.resetPassword(playerId), {
    onSuccess: () => {
      invalidate();
      setResetTarget(null);
      showToast("Senha redefinida. A pessoa precisa escolher uma nova no próximo acesso.");
    },
    onError: (error) =>
      showToast(getApiErrorMessage(error, "Não foi possível redefinir a senha."), "error"),
  });

  const colunas: DataTableColumn<LoginStatusRow>[] = [
    {
      key: "select",
      label: "",
      render: (linha) =>
        linha.blocked_reason === null ? (
          <Checkbox
            size="small"
            checked={selection.isSelected(linha.player_id)}
            slotProps={{ input: { "aria-label": `Selecionar ${linha.player_name}` } }}
            onChange={() => selection.toggle(linha.player_id)}
          />
        ) : null,
    },
    {
      key: "player",
      label: "Jogador",
      sortValue: (linha) => linha.player_name,
      render: (linha) => (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {linha.player_name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {linha.phone || "sem telefone"}
          </Typography>
        </>
      ),
    },
    {
      key: "status",
      label: "Acesso",
      render: (linha) => <SituacaoDoAcesso linha={linha} />,
    },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      render: (linha) =>
        linha.has_login ? (
          <Button size="small" onClick={() => setResetTarget(linha)}>
            Resetar senha
          </Button>
        ) : null,
    },
  ];

  const buscando = busca.trim().length > 0;
  /** O botão do cabeçalho age sobre **o que está na tela**. Com a busca ativa,
   * "gerar para todos" criaria acesso para gente que a pessoa não está vendo —
   * e criar login é ação que não se desfaz com um clique. */
  const alvoDoBotao = selecionaveis;

  return (
    <AppLayout>
      <PageHeader
        title="Gerar Logins"
        action={
          <Button
            variant="contained"
            disabled={alvoDoBotao.length === 0 || generateMutation.isPending}
            onClick={() => setConfirming("generate")}
          >
            {buscando ? "Gerar para os encontrados" : "Gerar para todos"} ({alvoDoBotao.length})
          </Button>
        }
      />

      <Alert severity="info" sx={{ mb: 2 }}>
        O jogador entra com o <strong>telefone dele</strong> e a senha{" "}
        <strong>novasenha123</strong>. No primeiro acesso, o sistema exige que ele escolha uma
        senha própria — até lá, não consegue usar mais nada.
      </Alert>

      <TextField
        fullWidth
        label="Buscar por nome ou telefone"
        value={busca}
        onChange={(event) => setBusca(event.target.value)}
        slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 1, color: "text.secondary" }} /> } }}
        sx={{ mb: 2 }}
      />

      {selecionaveis.length > 0 && (
        <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
          <Checkbox
            size="small"
            checked={selection.allSelected(selecionaveis)}
            indeterminate={selection.someSelected(selecionaveis)}
            slotProps={{
              input: {
                "aria-label": buscando
                  ? "Selecionar os jogadores sem login encontrados"
                  : "Selecionar todos os jogadores sem login",
              },
            }}
            onChange={() => selection.toggleAll(selecionaveis)}
          />
          <Typography variant="body2" color="text.secondary">
            {buscando ? "Selecionar os encontrados sem login" : "Selecionar todos sem login"} (
            {selecionaveis.length})
          </Typography>
        </Stack>
      )}

      <DataTable
        columns={colunas}
        rows={visiveis}
        getRowKey={(linha) => linha.player_id}
        loading={query.isLoading}
        error={
          query.isError
            ? getApiErrorMessage(query.error, "Não foi possível carregar a lista.")
            : null
        }
        onRetry={() => query.refetch()}
        emptyMessage={
          buscando ? "Nenhum jogador encontrado." : "Nenhum mensalista cadastrado."
        }
        defaultSortKey="player"
        // A `DataTable` ordena decrescente por padrão, o que é certo para data
        // e valor e errado para gente: a lista abria no fim do alfabeto.
        defaultSortDesc={false}
        renderCard={(linha) => (
          <Card>
            <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.5 } }}>
              <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
                {linha.blocked_reason === null && (
                  <Checkbox
                    size="small"
                    checked={selection.isSelected(linha.player_id)}
                    slotProps={{ input: { "aria-label": `Selecionar ${linha.player_name}` } }}
                    onChange={() => selection.toggle(linha.player_id)}
                    sx={{ mt: -0.5, ml: -1 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
                    {linha.player_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {linha.phone || "sem telefone"}
                  </Typography>
                  <div style={{ marginTop: 6 }}>
                    <SituacaoDoAcesso linha={linha} />
                  </div>
                </div>
                {linha.has_login && (
                  <Button size="small" onClick={() => setResetTarget(linha)}>
                    Resetar
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>
        )}
      />

      <BulkActionBar
        count={selection.count}
        noun="jogador"
        nounPlural="jogadores"
        onClear={selection.clear}
        actions={[
          {
            key: "generate",
            label: "Gerar logins",
            shortLabel: "Gerar",
            onClick: () => setConfirming("generate"),
          },
        ]}
      />

      <ConfirmDialog
        open={confirming === "generate"}
        title="Gerar logins"
        confirmLabel="Gerar"
        isSubmitting={generateMutation.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() =>
          generateMutation.mutate(
            selection.count > 0
              ? [...selection.selected]
              : // Sem busca, `undefined` deixa o servidor resolver "todos os
                // mensalistas" — é ele quem tem a lista completa.
                buscando
                ? alvoDoBotao
                : undefined,
          )
        }
      >
        <Typography variant="body2">
          Você está criando acesso para{" "}
          <strong>
            {selection.count > 0
              ? `${selection.count} jogador(es)`
              : buscando
                ? `os ${alvoDoBotao.length} encontrado(s)`
                : `todos os ${alvoDoBotao.length}`}
          </strong>
          .
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Cada um entra com o próprio telefone e a senha <strong>novasenha123</strong>, e precisa
          trocá-la no primeiro acesso.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Quem já tem login não é afetado.
        </Typography>
      </ConfirmDialog>

      <ConfirmDialog
        open={resetTarget !== null}
        title="Resetar senha"
        confirmLabel="Resetar"
        isSubmitting={resetMutation.isPending}
        onClose={() => setResetTarget(null)}
        onConfirm={() => resetTarget && resetMutation.mutate(resetTarget.player_id)}
      >
        <Typography variant="body2">
          A senha de <strong>{resetTarget?.player_name}</strong> volta a ser{" "}
          <strong>novasenha123</strong>, e a atual deixa de funcionar imediatamente.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Você não vê a senha atual dessa pessoa — ela é substituída, não revelada.
        </Typography>
      </ConfirmDialog>
    </AppLayout>
  );
}

/** Três situações, cada uma com o seu tom: pode receber, já tem, impedido. */
function SituacaoDoAcesso({ linha }: { linha: LoginStatusRow }) {
  if (linha.has_login) {
    return (
      <StatusChip
        label={linha.must_change_password ? "Primeiro acesso pendente" : "Login ativo"}
        tone={linha.must_change_password ? "warning" : "success"}
      />
    );
  }
  if (linha.blocked_reason) {
    return <StatusChip label={linha.blocked_reason} tone="error" />;
  }
  return <StatusChip label="Sem login" tone="default" />;
}
