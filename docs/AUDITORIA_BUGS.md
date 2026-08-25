# Auditoria Técnica — Bugs Encontrados e Correções Aplicadas

> **Status: em manutenção contínua.** Este é o registro vivo de bugs do projeto — todo defeito encontrado, por mim ou reportado pelo usuário, entra aqui com causa raiz e correção.
>
> **Rodada 1** (auditoria inicial): 39 achados corrigidos, mais 4 descobertos durante a implementação (seção "Achados extras").
> **Rodada 2** (PostgreSQL + defeitos reportados em uso): 8 achados — ver [Rodada 2](#rodada-2--postgresql-e-defeitos-reportados-em-uso).
>
> Base analisada: `backend/apps/*` (accounts, players, matches, draws, audit, statistics), `backend/common/`, `backend/config/`, todo o `frontend/src/`, `docker-compose.yml`, `.github/workflows/ci.yml` e a suíte de testes.
> Linha de base no início: **75 testes backend passando em SQLite**. Estado atual: **114 testes passando em PostgreSQL 16**, `ruff check` limpo, `tsc -b` limpo, `vite build` OK.
> Documentação lida integralmente: `REQUISITOS.md`, `REGRAS_DE_NEGOCIO.md`, `PLANO_IMPLEMENTACAO.md`.

---

## Decisões de produto confirmadas com o usuário

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Critério de ordem da fila | Ordem de inscrição (`confirmed_at`) |
| 2 | Mensalista vs convidado na fila | **Mensalista tem prioridade** |
| 3 | Promoção refaz o sorteio? | **Não** — o organizador decide ("Sortear Novamente") |
| 4 | Aproveitamento inclui empates? | **Sim** — vitórias ÷ partidas com placar lançado |
| 5 | Partida recorrente removida | Status **Cancelada**, reversível pela ação de reativar |
| 6 | React Query | **Removido** a pedido, substituído por camada própria em `core/data/` |

---

## Achados extras — bugs que só apareceram durante a implementação

Nenhum destes estava no levantamento inicial; todos foram encontrados ao reescrever ou testar o código.

### 🔴 X1 — A sessão caía sozinha ~30 minutos depois de todo login

**Arquivo:** `frontend/src/core/httpClient.ts`

O backend usa `ROTATE_REFRESH_TOKENS = True` + `BLACKLIST_AFTER_ROTATION = True`: cada renovação devolve um refresh token **novo** e coloca o anterior na blacklist. O interceptor descartava o token novo e regravava o antigo:

```tsx
tokenStorage.setTokens({ access: data.access, refresh: tokens.refresh });  // ← refresh ANTIGO
```

Consequência: a primeira renovação funcionava, a segunda batia contra um token já invalidado → logout forçado. Como o access token dura 30 minutos, **toda sessão caía sozinha na segunda renovação**. Corrigido para `data.refresh ?? tokens.refresh`.

### 🔴 X2 — Estado da organização divergindo do `localStorage` (403 silencioso após relogar)

**Arquivo:** `frontend/src/features/organization/OrganizationContext.tsx`

`currentOrganizationId` era copiado do storage para o estado do React no mount. O logout limpava o storage, mas **não** o estado. Ao relogar na mesma aba, o guard achava que havia organização selecionada e liberava a tela, enquanto o cliente HTTP — que lê o storage — mandava a requisição **sem** o cabeçalho `X-Organization-Id`. Resultado: dashboard com "Você não tem permissão para esta ação".

Corrigido tornando o storage a única fonte da verdade (lido a cada render); o estado virou apenas um gatilho de re-render.

### 🟠 X3 — "Confirmar todos" preenchia as vagas com convidados primeiro

**Arquivo:** `backend/apps/matches/services.py`

`order_by("player_type", "name")` ordena alfabeticamente, e `"convidado" < "mensalista"`. Com 16 jogadores para 14 vagas, os convidados ocupavam as vagas e mensalistas iam para a espera — exatamente o oposto da prioridade acordada. Corrigido com ordenação explícita por prioridade. Coberto por teste.

### 🟠 X4 — Cache próprio quebrava as inscrições ao trocar de sessão

**Arquivo:** `frontend/src/core/data/queryStore.ts` (código novo)

O `clear()` removia os registros do mapa. Como `getSnapshot` recria o registro sob demanda, o componente continuava inscrito no objeto antigo e **nunca mais era notificado** — a tela de login gravava o token, o `/auth/me` respondia 200, e a interface não reagia. Corrigido: registros com ouvintes ativos são zerados no lugar, nunca descartados.

Bônus da mesma família: uma query que falhava ficava em erro permanente (o efeito pulava o refetch quando `status === "error"`), então um 401 durante o logout deixava a tela seguinte quebrada após o próximo login.

---

## Sumário executivo

| Severidade | Qtd | Onde |
|---|---|---|
| 🔴 Crítico | 5 | Sorteio (capacidade/fila), sorteio de jogador inativo, login duplo-clique, interceptor 401, exportação SVG/PNG vazia |
| 🟠 Alto | 8 | Constraint de confirmação, placar, tratamento de erro da API, selects de formulário, posições assíncronas |
| 🟡 Médio | 14 | Tasks Celery, paginação, erros silenciosos, throttling, estados inconsistentes |
| ⚪ Baixo | 12 | A11y, dark mode, UX, semântica de estatísticas, duplicação |

**Total: 39 achados.**

Os itens 1 e 2 do pedido (lista de espera + respeitar a configuração da partida) **não são bugs de regressão** — correspondem à **Fase 3 do `PLANO_IMPLEMENTACAO.md`, que nunca foi implementada**. O próprio `REGRAS_DE_NEGOCIO.md` §13 declara: *"Lista de espera automática quando confirmados excedem o máximo da partida"* como não implementado. Estão tratados abaixo como **B1**.

---

# PARTE 1 — BACKEND

## 🔴 B1 — O sorteio ignora completamente `max_players` (itens 1 e 2 do pedido)

**Arquivos:** `backend/apps/draws/services.py:28-37`, `backend/apps/matches/models.py`, `backend/apps/matches/services.py`

**Sintoma:** com 16 confirmados numa partida de 2 times × 6 de linha + 1 goleiro (capacidade 14), o sorteio distribui **os 16** em 2 times de 8. A configuração da partida é usada só como piso (`min_players`); o teto (`max_players`) nunca é lido pelo motor.

**Causa raiz:**
```python
# draws/services.py
confirmations = Confirmation.objects.filter(match=match, status=CONFIRMED)...
confirmed_players = [c.player for c in confirmations]
if len(confirmed_players) < match.min_players:      # única validação
    raise InsufficientPlayersError(...)
```
Não há nenhuma referência a `match.max_players` em `execute_draw`. E não existe o model `WaitlistEntry` — nem a coluna, nem a migration, nem os serviços `promote_from_waitlist`/`move_waitlist_entry`/`remove_from_waitlist` previstos no plano (§6.1).

**Impacto:** o número de times, jogadores de linha e goleiros configurados na partida não tem efeito prático nenhum sobre quem entra em campo. Excedentes são "absorvidos" em vez de ficarem na espera.

**Correção proposta:** ver **Plano de implementação · Etapa A** no final deste documento.

---

## 🔴 B2 — O sorteio inclui jogadores inativos e até removidos

**Arquivo:** `backend/apps/draws/services.py:28-31`

**Sintoma:** um jogador confirmado que depois é marcado como **inativo** ou **removido** (soft-delete) continua sendo sorteado e aparece nos times.

**Causa raiz:**
```python
Confirmation.objects.filter(match=match, status=Confirmation.Status.CONFIRMED).select_related("player")
```
- `Confirmation.objects` é o `SoftDeleteManager` **da Confirmation**, não do Player.
- `select_related("player")` é um `JOIN` — ele **não passa pelo manager do `Player`**, então `player.is_deleted=True` vem junto.
- Não existe filtro `player__status=ATIVO`.

Isso contradiz diretamente `REGRAS_DE_NEGOCIO.md` §3: *"Jogadores inativos não aparecem no roster de confirmação de partidas nem entram no sorteio."*

**Reprodução:** confirmar 14 jogadores → editar 1 para `inativo` (ou removê-lo) → sortear → ele está em um time.

**Agravante:** o `roster` da tela **filtra** por `status=ATIVO`, então o contador "👥 X confirmados" da interface diverge do total que o backend realmente sorteia. O organizador vê 13 e o sorteio usa 14.

**Correção:** filtrar `player__status=Player.Status.ATIVO, player__is_deleted=False` na consulta de confirmados, em um único ponto reutilizável (`get_confirmed_players(match)`), consumido também pelo `confirmed_count` do serializer e pela futura fila.

---

## 🟠 B3 — `Confirmation` sem constraint de soft-delete + `get_or_create` no manager errado

**Arquivos:** `backend/apps/matches/models.py:153-156`, `backend/apps/matches/services.py:70`

**Causa raiz:**
```python
constraints = [UniqueConstraint(fields=["match", "player"], name="unique_confirmation_per_match_player")]
#                                  ↑ falta condition=Q(is_deleted=False)
```
```python
confirmation, _created = Confirmation.objects.get_or_create(match=match, player=player)
#                                    ↑ manager que ESCONDE registros soft-deletados
```
Se uma `Confirmation` for soft-deletada, o `get_or_create` não a encontra (o manager filtra `is_deleted=False`), tenta um `INSERT` e **estoura `IntegrityError` (500)** porque a constraint no banco não tem o filtro parcial.

Hoje não ocorre porque `set_confirmation` nunca deleta — mas é **bloqueante** para a fila de espera (que precisa mover confirmações). Já estava registrado no plano (§2.3, achado #5), previsto para a Fase 3.

**Comparação:** `Match` já faz certo (`condition=models.Q(is_deleted=False)` na `unique_recurring_game_date`). É inconsistência interna.

**Correção:** adicionar `condition=Q(is_deleted=False)` na constraint (migration) e trocar para `Confirmation.all_objects.get_or_create(...)` com "reviver" o registro (`is_deleted=False, deleted_at=None`).

---

## 🟠 B4 — `POST /api/recurring-games/` retorna **500** quando campos opcionais são omitidos

**Arquivo:** `backend/apps/matches/serializers.py:28-35`

```python
def validate(self, attrs):
    merged = {**(self.instance.__dict__ if self.instance else {}), **attrs}
    validate_recurring_game_config(
        teams_count=merged["teams_count"],                    # ← KeyError
        min_players_per_team_line=merged["min_players_per_team_line"],
        max_players_per_team_line=merged["max_players_per_team_line"],
    )
```
`teams_count` (default 2), `min_players_per_team_line` (default 4) e `max_players_per_team_line` (default 8) têm **default no model**, portanto o DRF os marca `required=False`. Um POST que os omita cai em `KeyError` → **HTTP 500 em vez de usar o default**.

Secundariamente, `self.instance.__dict__` carrega `_state` e campos internos do Django — é frágil por construção.

**Correção:** trocar por leitura campo a campo com fallback explícito na instância e nos defaults do model, no mesmo padrão do `MatchSerializer.validate` (que já usa a função `current(field)`).

---

## 🟠 B5 — O tratador global de exceções destrói todas as mensagens de erro da API

**Arquivo:** `backend/common/exceptions.py:36`

```python
response.data = {"detail": response.data}
```

Toda resposta de erro é re-embrulhada. Consequências:
- Um erro de validação `{"teams_count": ["É necessário pelo menos 2 times."]}` vira `{"detail": {"teams_count": ["..."]}}`.
- Um 401 vira `{"detail": {"detail": "As credenciais de autenticação não foram fornecidas."}}` (aninhamento duplo).
- Um 429 (throttling) vira `{"detail": {"detail": "Request was throttled..."}}`.

**Impacto real e visível:** é por isso que **todas as telas mostram mensagens genéricas** — *"Não foi possível salvar. Confira os dados"*, *"Usuário ou senha inválidos"* — mesmo quando o backend explicou exatamente o que estava errado. O frontend não tem como extrair a mensagem de um formato aninhado e variável.

**Correção:** preservar o formato nativo do DRF (`{"campo": ["msg"]}` / `{"detail": "msg"}`), sem re-embrulhar, e expor os erros de campo no frontend.

---

## 🟠 B6 — O placar aceita `result` vindo do cliente (regra de negócio no frontend)

**Arquivos:** `backend/apps/draws/services.py:155-185`, `backend/apps/draws/serializers.py:56-60`, `frontend/src/features/matches/ResultsDialog.tsx:39-58`

A derivação vitória/empate/derrota a partir dos gols — documentada em `REGRAS_DE_NEGOCIO.md` §7 como regra do sistema — está **implementada no frontend** (`deriveResults`). O backend aceita `result`, `goals_scored` e `goals_conceded` do cliente sem nenhuma validação cruzada.

Isso viola `REQUISITOS.md` §3: *"Frontend 100% desacoplado... nenhuma regra de negócio no cliente"*.

Problemas concretos:
- Qualquer cliente pode gravar `result="win"` com `goals_scored=0` — as estatísticas ficam permanentemente erradas.
- `set_match_results` **ignora silenciosamente** times cujo `team_id` não pertence ao sorteio (`continue` sem erro) — o organizador recebe 200 achando que salvou.
- Não valida que **todos** os times receberam placar: é possível concluir a partida com metade dos times sem resultado.
- A partida é marcada `COMPLETED` mesmo que nenhum resultado válido tenha sido gravado.

**Correção:** mover a derivação para o backend (`set_match_results` recebe só `{team_id, goals_scored}` e calcula `result`/`goals_conceded`), exigir todos os times e rejeitar ids desconhecidos com 400.

---

## 🟡 B7 — Convidados criados pela lista de nomes nascem todos **Atacantes**

**Arquivo:** `backend/apps/matches/services.py:121`

```python
default_position = Position.objects.filter(organization=organization).order_by("sort_order").last()
```
Com o seed padrão (GOL=1, ZAG=2, ME=3, AT=4), `.last()` retorna **AT**. Colar 16 nomes não reconhecidos cria 16 atacantes.

**Impacto no sorteio:** o critério "distribuição por posição" (`_position_cost`) passa a ver 16 jogadores da mesma posição, e o equilíbrio posicional vira ruído — exatamente o oposto do objetivo.

**Bug adicional:** se a organização não tiver nenhuma posição, `default_position` é `None` e `Player.primary_position` é `NOT NULL` → **IntegrityError (500)**.

**Correção:** escolher a posição por `code` semanticamente neutro (ex.: ME/linha) com fallback pela `sort_order` mais baixa não-goleiro, e falhar com 400 explicativo se não houver posições.

---

## 🟡 B8 — Partida removida "ressuscita" sozinha

**Arquivo:** `backend/apps/matches/services.py:22-58`

`ensure_next_match` consulta `Match.objects.filter(recurring_game=...)` — manager que **esconde** as partidas soft-deletadas. Se o organizador remover a partida gerada da semana (ex.: feriado), a task `generate_upcoming_matches_task` não a enxerga e **cria outra** na próxima execução. A `UniqueConstraint` parcial (`condition=is_deleted=False`) não impede, porque a linha antiga está marcada como deletada.

**Efeito:** não existe forma de cancelar uma ocorrência de jogo recorrente — ela volta.

**Correção:** consultar via `all_objects` ao decidir se já existe partida para a data, respeitando a remoção intencional (ou introduzir `status=CANCELED` como o caminho correto de cancelamento).

---

## 🟡 B9 — Sorteio automático perde a janela se o worker atrasar 1 minuto

**Arquivo:** `backend/apps/draws/tasks.py:34-38`

```python
if effective_draw_time.replace(second=0, microsecond=0) != current_time:
    continue
```
Comparação de **igualdade exata ao minuto**. Se o Celery Beat pular um tick, se o worker estiver ocupado, ou se houver qualquer atraso de fila > 60s, o sorteio automático **simplesmente não acontece naquele dia** — e não fica registrado em lugar nenhum (o `logger.warning` só cobre o caso de jogadores insuficientes).

**Correção:** trocar por uma janela (`draw_time <= agora` e ainda não sorteada no dia), tornando a task idempotente por partida em vez de dependente do minuto exato.

---

## 🟡 B10 — `set_all_confirmations`: N×3 queries e nenhuma trava de capacidade

**Arquivo:** `backend/apps/matches/services.py:89-103`

Para cada jogador ativo: um `get_or_create` + um `save` + um `INSERT` de auditoria. Com 100 jogadores são **~300 queries em uma request**. O comentário justifica a escolha pela auditoria — legítimo, mas resolvível com `bulk_create` da auditoria mantendo o mesmo registro por jogador.

Além disso, "Confirmar todos" ignora `max_players` — com a fila de espera (B1) precisa preencher até o teto e enfileirar o resto.

---

## 🟡 B11 — Throttling anônimo bloqueia o login da equipe inteira

**Arquivo:** `backend/config/settings/base.py:115-122`

```python
"DEFAULT_THROTTLE_RATES": {"user": "1000/day", "anon": "100/day"}
```
`POST /api/auth/token/` é uma rota **anônima**. Numa rede com NAT compartilhado (o clube, o escritório), 100 tentativas de login por dia são consumidas rápido, e todos passam a receber **429**. Pior: por causa de **B5**, o 429 chega ao frontend indistinguível de senha errada — o usuário vê *"Usuário ou senha inválidos"* e tenta de novo, consumindo mais cota.

`1000/day` por usuário também é apertado: a tela de detalhe da partida dispara 4 queries e cada confirmação invalida 3.

**Correção:** escopos de throttle dedicados (`login` mais restrito por tentativa, mas por minuto/hora e não por dia) e limites operacionais mais realistas.

---

## 🟡 B12 — `move-player` permite editar sorteio histórico via API

**Arquivos:** `backend/apps/draws/views.py:23-35`, `backend/apps/draws/services.py:122-152`

O `MovePlayerSerializer` valida que o jogador e o time pertencem ao sorteio, mas **não valida que o sorteio é o vigente** (`is_current=True`). A trava existe só na UI (`canEditTeams = canManage && isViewingCurrent`). Pela API é possível reescrever o histórico — que a documentação promete imutável (`REQUISITOS.md` §2.10).

Também não há validação de tamanho de time: é possível mover todos para um time só.

---

## ⚪ B13 — Dashboard perde a próxima partida assim que ela é sorteada

**Arquivo:** `backend/apps/matches/dashboard_views.py:20-28`

O filtro é `status__in=[SCHEDULED, CONFIRMING]`. Depois do sorteio o status vira `DRAWN` e a partida **some do dashboard**, inclusive no próprio dia do jogo — justamente quando é mais consultada.

---

## ⚪ B14 — Histórico de duplas contamina o "Sortear novamente"

**Arquivo:** `backend/apps/draws/services.py:49-52`

`PairHistoryRepository.compute()` roda **antes** da transação que marca o sorteio anterior como `is_current=False`. Ao re-sortear a mesma partida, o sorteio que está sendo substituído ainda conta como "semana anterior" e penaliza as duplas — comportamento não documentado que enviesa o resultado do re-sorteio.

---

## ⚪ B15 — Semântica de aproveitamento inconsistente com a documentação

**Arquivo:** `backend/apps/statistics/services.py:104-105`

```python
decided = wins + losses + draws
win_rate = wins / decided if decided else None
```
A variável se chama `decided` mas inclui empates. `REGRAS_DE_NEGOCIO.md` §8 diz *"aproveitamento (vitórias / decididas)"*. Ou o nome está errado, ou o cálculo. Precisa de decisão de produto.

---

## ⚪ B16 — Geração de slug com corrida e numeração fora do padrão

**Arquivo:** `backend/apps/accounts/models.py:51-58`

`_generate_unique_slug` faz `SELECT` seguido de `INSERT` sem trava — duas organizações com o mesmo nome criadas simultaneamente colidem na constraint `unique`. O loop começa em `suffix=1` e incrementa antes de usar, então o primeiro conflito gera `-2` (nunca existe `-1`).

---

# PARTE 2 — FRONTEND

## 🔴 F1 — O bug do login (duplo clique) — **duas causas raiz independentes**

### Causa raiz A — `logout()` envenena o cache da query `["me"]`

**Arquivos:** `frontend/src/features/auth/AuthContext.tsx:47-53` e `:55-63`, `frontend/src/routes/ProtectedRoute.tsx:8-22`

```tsx
const logout = () => {
  webTokenStorage.clear();
  webOrganizationStorage.clear();
  setHasTokens(false);
  queryClient.setQueryData(["me"], null);      // ← AQUI
  queryClient.setQueryData(["organizations", "mine"], null);
};
```

`setQueryData(["me"], null)` **não limpa** a query — ela grava `null` como dado válido. A query passa a ter `status: "success"`, `data: null`.

No login seguinte:
1. `setSessionTokens` grava o token, faz `setHasTokens(true)` e invalida `["me"]`.
2. A query é reabilitada. Como **já existe dado em cache** (`null`), o React Query v5 faz um **refetch em background**: `isPending = false` → portanto **`isLoading = false`**.
3. `ProtectedRoute` avalia:
   - `isLoading = hasTokens && meQuery.isLoading` → **`false`** (não mostra o spinner)
   - `isAuthenticated = hasTokens && !!meQuery.data` → `true && !!null` → **`false`**
4. Resultado: `<Navigate to="/login" replace />` **antes** de o `GET /auth/me` responder. O usuário volta para a tela de login.
5. **No segundo clique** o `GET /auth/me` da primeira tentativa já resolveu e populou o cache com o usuário real → `isAuthenticated` é `true` imediatamente → entra.

É exatamente o sintoma relatado: *"frequentemente é necessário clicar duas vezes"*. "Frequentemente" e não "sempre" porque só acontece depois de um `logout()` na mesma aba (ou com o cache já semeado).

O mesmo padrão quebra `OrganizationProvider` (`isLoading: isAuthenticated && membershipsQuery.isLoading`) → `RequireOrganization` pode piscar *"Nenhuma organização encontrada para o seu usuário."*

### Causa raiz B — o interceptor 401 recarrega a página inteira em qualquer falha de credencial

**Arquivos:** `frontend/src/core/httpClient.ts:44-83`, `frontend/src/api/client.ts:11-13`

```tsx
if (error.response?.status === 401) {
  tokenStorage.clear();
  onUnauthorized?.();          // → window.location.assign("/login")
}
```
O interceptor **não exclui as rotas de autenticação**. Uma senha errada no próprio `POST /auth/token/` retorna 401 → o interceptor limpa o storage e faz `window.location.assign("/login")` → **reload duro da página**. O formulário é zerado, o `<Alert severity="error">` nunca chega a ser pintado, e o usuário só percebe que "não aconteceu nada". Clica de novo — e aí funciona.

Pior no cenário de token velho: se sobrou um `refresh` no `localStorage`, a senha errada entra no **primeiro** ramo (`tokens?.refresh` é truthy), tenta renovar, refaz o `POST /auth/token/` com o mesmo corpo errado, toma 401 de novo e só então recarrega. Duas requisições desnecessárias e o mesmo resultado.

**Correção proposta (definitiva):**
1. Em `logout()`, usar `queryClient.removeQueries({ queryKey: ["me"] })` em vez de `setQueryData(..., null)` — e o mesmo para `["organizations","mine"]`.
2. Derivar `isLoading` de forma segura: `hasTokens && !meQuery.data && (meQuery.isLoading || meQuery.isFetching)` — enquanto houver token e não houver usuário resolvido, o guard **espera**, nunca redireciona.
3. Excluir `/auth/token/` e `/auth/token/refresh/` do tratamento de 401 do interceptor.
4. Trocar `window.location.assign` por um callback que faça `logout()` + navegação do React Router (sem reload).
5. Desabilitar o botão por `isSubmitting` **e** `loginMutation.isPending`, e tratar a rejeição no `onSubmit` (hoje ela vaza — ver F7).

---

## 🔴 F2 — Interceptor desloga o usuário quando há 401 em requisições paralelas

**Arquivo:** `frontend/src/core/httpClient.ts:42-79`

```tsx
let isRefreshing = false;
...
if (status === 401 && tokens?.refresh && !originalRequest._retry && !isRefreshing) {
   ... refresh ...
}
if (error.response?.status === 401) {   // ← todos os OUTROS caem aqui
   tokenStorage.clear();
   onUnauthorized?.();
}
```

`isRefreshing` é uma flag simples, **sem fila de espera**. Quando o access token expira (30 min), a `MatchDetailPage` tem **4 queries simultâneas** (`match`, `roster`, `current-draw`, `draw-history`). As quatro tomam 401 ao mesmo tempo:
- a 1ª entra no refresh;
- as outras 3 encontram `isRefreshing === true`, caem no segundo `if` e **limpam o token e recarregam a página**.

Sintoma para o usuário: *"o sistema me joga para a tela de login sozinho no meio do uso"*, e o refresh que estava em andamento é perdido.

**Correção:** substituir a flag por uma **promise compartilhada** de refresh — requisições concorrentes aguardam a mesma renovação e são reexecutadas depois; só desloga se a renovação de fato falhar.

---

## 🔴 F3 — Exportar SVG/PNG do time gera um campo **vazio, sem jogadores**

**Arquivos:** `frontend/src/features/matches/FootballPitch.tsx:49-67`, `frontend/src/features/matches/PlayerToken.tsx:23-68`, `frontend/src/features/matches/exportUtils.ts:12-19`

O `<svg>` contém **apenas as marcações do campo** (`PITCH_MARKINGS`). Os jogadores são renderizados como `<Box>` do MUI (`<div>` HTML) posicionados em `position: absolute` **por cima** do SVG, fora dele:

```tsx
<Box component="svg" ref={svgRef} viewBox="0 0 100 140">
  {PITCH_MARKINGS}                {/* ← só isso está dentro do SVG */}
</Box>
{positioned.map((p) => <PlayerToken ... />)}   {/* ← divs, FORA do SVG */}
```

`exportUtils.serializeSvg()` faz `svg.cloneNode(true)` — clona só o elemento `<svg>`. Portanto:
- **"Exportar SVG"** baixa um campo verde vazio.
- **"Exportar PNG"** idem (é gerado a partir do mesmo SVG).
- **"📤 Enviar no WhatsApp"** anexa imagens vazias via `navigator.share({ files })`.

Contradiz `REQUISITOS.md` §2.7: *"Campo de futebol em SVG gerado dinamicamente por time, com jogadores posicionados automaticamente... mostrando nome, posição e estrelas"* e `REGRAS_DE_NEGOCIO.md` §10.

**Correção:** renderizar os jogadores **dentro** do `<svg>` (`<g><circle/><text/></g>` usando as mesmas coordenadas de `computeFieldLayout`), mantendo o drag-and-drop via `@dnd-kit` nos próprios nós SVG. A lógica de `fieldLayout.ts` não muda (o plano §7.3 já pede que ela seja preservada).

---

## 🟠 F4 — Selects e switches dos formulários **não atualizam ao editar** (salvam o valor errado)

**Arquivos:** `frontend/src/features/players/PlayerFormDrawer.tsx:104-147`, `frontend/src/features/recurringGames/RecurringGameFormDrawer.tsx:98-163`

Padrão usado em todos os selects:
```tsx
<TextField select defaultValue={player?.player_type ?? "mensalista"} {...register("player_type")}>
<Switch defaultChecked={recurringGame?.is_active ?? true} {...register("is_active")} />
```

`register()` devolve `{name, onChange, onBlur, ref}` e o `ref` do MUI `Select` aponta para um **input escondido**. O `reset(buildDefaultValues(player))` do `useEffect` atualiza o estado interno do React Hook Form, mas **não re-renderiza o Select do MUI**, que é não-controlado (só leu o `defaultValue` no primeiro mount).

**Sintomas concretos:**
- Abrir "Editar" no jogador A, fechar, abrir no jogador B → os campos **Tipo**, **Status** e **Posição secundária** ainda mostram os valores de A.
- Salvar nesse estado **grava o valor errado no banco**.
- Em Jogos Recorrentes: **Dia da semana** e o switch **Ativo** têm o mesmo problema.

**Correção:** trocar todos por `<Controller>` (ou `useForm({ values })` com `value` controlado), no mesmo padrão que o campo `skill_level` já usa corretamente (`Controller` + `Rating`).

---

## 🟠 F5 — "Posição principal" aparece em branco ao editar um jogador

**Arquivo:** `frontend/src/features/players/PlayerFormDrawer.tsx:122-134` + `PlayersPage.tsx:37-40`

As posições vêm de uma **query separada** (`positionsQuery`). No primeiro render do drawer, `positions=[]`, então o `<TextField select>` não tem nenhum `<MenuItem>` com o `value` do jogador e exibe vazio. O `useEffect` de `reset` depende só de `[player, reset]` — **não roda de novo quando as posições chegam**. Somado ao F4 (select não-controlado), o campo obrigatório aparece em branco e o submit falha ou grava outra posição.

---

## 🟠 F6 — A tela não tem nenhuma noção de capacidade nem de lista de espera

**Arquivo:** `frontend/src/features/matches/MatchDetailPage.tsx:169`

```tsx
const canDraw = !!match && confirmedCount >= match.min_players && canManage;
```
Não há teto, não há aviso de "capacidade atingida", não há painel de fila. O `max_players` só aparece como texto informativo na linha *"(mínimo X, máximo Y)"*. É a contraparte de front do **B1**.

---

## 🟠 F7 — Erros silenciosos em toda a camada de mutations

| Local | Problema |
|---|---|
| `LoginPage.tsx:17-20` | `await login(payload)` sem `try/catch`; o RHF re-lança → **unhandled promise rejection** no console a cada senha errada |
| `ResultsDialog.tsx:73-76` | `await onSubmit(results); onClose();` — se o `set-results` falhar, o diálogo fica aberto, **sem nenhuma mensagem** |
| `MatchDetailPage.tsx:98-165` | `confirmMutation`, `addGuestMutation`, `moveMutation`, `resultsMutation` — **nenhuma tem `onError`** |
| `MatchesPage.tsx:86-92`, `PlayersPage.tsx:83-89`, `RecurringGamesPage.tsx:68-74` | `mutateAsync` sem `catch` (o `Alert` do drawer cobre parcialmente, mas a rejeição continua não tratada) |
| `QuickConfirmDialog.tsx:59-80` | `reassignMutation` sem `onError` |

**Sintoma para o usuário:** clicar no toggle de presença e "não acontecer nada" quando a requisição falha — o Switch volta sozinho no próximo refetch, sem explicação. É literalmente o *"botões que não respondem"* e *"erros silenciosos"* do pedido.

---

## 🟡 F8 — Toggle de presença sem estado otimista nem trava de duplo clique

**Arquivo:** `frontend/src/features/matches/MatchDetailPage.tsx:369-398`

O `<Switch>` é controlado pelo dado do servidor (`entry.confirmation_status`) e a mutation **não é otimista** nem desabilita o controle durante o envio. Em conexão lenta o switch volta ao estado anterior e só muda quando a invalidação retorna — dá a impressão de que o clique foi ignorado. Dois cliques rápidos disparam duas mutations concorrentes cujo resultado depende da ordem de chegada.

---

## 🟡 F9 — Listas mostram só os 20 primeiros registros (silenciosamente)

**Arquivos:** `matchesApi.ts:44,63`, `playersApi.ts:18`, `auditApi.ts`, `drawsApi.ts:15-25`

Todas as funções fazem `return data.results` da **primeira página** (`PAGE_SIZE = 20` global). A partir de 20 partidas / 20 jogadores / 20 registros de auditoria, o restante **desaparece da interface sem qualquer indicação**. Já registrado no plano (§2.2, achado #9) e nunca corrigido.

Impacto direto no negócio: uma pelada com 25 mensalistas não consegue ver 5 deles na tela de Jogadores.

---

## 🟡 F10 — Estado de edição não é limpo ao fechar os drawers

**Arquivos:** `MatchesPage.tsx:198`, `PlayersPage.tsx:221`, `RecurringGamesPage.tsx:158`

```tsx
onClose={() => setFormOpen(false)}   // editing / editingPlayer permanecem setados
```
O item em edição continua no estado. Combinado com **F4**, produz formulários com dados do registro anterior.

---

## 🟡 F11 — Busca de jogadores dispara uma requisição por tecla

**Arquivo:** `frontend/src/features/players/PlayersPage.tsx:32-35, 182-186`

`filters.search` entra direto no `queryKey`, sem debounce. Digitar "Rodrigo" faz **7 requisições** ao backend — que ainda consomem a cota do throttle (B11).

---

## 🟡 F12 — `RequireOrganization` esconde erro de rede atrás de "Nenhuma organização encontrada"

**Arquivos:** `frontend/src/features/organization/OrganizationContext.tsx:51`, `frontend/src/routes/RequireOrganization.tsx:18-26`

`isLoading` é `false` quando a query **falha**, e `memberships` fica `[]`. A tela mostra *"Nenhuma organização encontrada para o seu usuário."* como se fosse um estado final legítimo — quando na verdade foi um erro de rede ou 500. Nenhum `isError` é tratado. O usuário fica preso sem opção de "tentar novamente".

Além disso, `selectOrganization` é chamada dentro de um `useEffect` com `eslint-disable` e dependência só em `[memberships]` — se o backend devolver o array com nova referência a cada refetch, o efeito re-roda desnecessariamente.

---

## ⚪ F13 — `QuickConfirmDialog`: chaves React duplicadas com nomes repetidos

**Arquivo:** `frontend/src/features/matches/QuickConfirmDialog.tsx:138, 172, 180`

`key={resolution.input_name}` — colar a mesma linha duas vezes (comum ao copiar do WhatsApp) gera **chaves duplicadas**, e as linhas passam a não renderizar/atualizar corretamente. O `fixOpenFor` também é indexado por nome, então o autocomplete de correção abre nas duas linhas ao mesmo tempo.

---

## ⚪ F14 — `ResultsDialog` descarta o placar digitado a cada refetch

**Arquivo:** `frontend/src/features/matches/ResultsDialog.tsx:63-65`

```tsx
useEffect(() => { if (open) setGoals(buildInitialGoals(teams)); }, [open, teams]);
```
`teams` vem de `currentDraw.teams`. Qualquer invalidação (uma confirmação em outra aba, um refetch) troca a referência do array e o efeito **reseta os gols digitados** com o diálogo aberto.

---

## ⚪ F15 — `MatchFormDrawer` altera o máximo da partida ao editar outro campo

**Arquivo:** `frontend/src/features/matches/MatchFormDrawer.tsx:47-50`

```tsx
return Math.max(1, Math.round(total / teamsCount) - GOALKEEPERS_PER_TEAM);
```
Quando `max_players` não é múltiplo de `teams_count`, o arredondamento não é reversível. Editar só o **local** de uma partida faz o formulário reenviar um `max_players_per_team_line` diferente, **alterando silenciosamente a capacidade da partida**. Com a fila de espera (B1) isso passa a mudar quem entra em campo.

---

## ⚪ F16 — Aba de navegação some no detalhe da partida

**Arquivo:** `frontend/src/shared/layout/AppLayout.tsx:46-48`

Em `/partidas/:id`, `currentTab` é `false` — nenhuma aba fica marcada e o MUI emite warning de `value` fora das opções. O usuário perde a referência de onde está.

---

## ⚪ F17 — Dashboard sem skeleton e campo SVG ignorando o dark mode

- `DashboardPage.tsx`: `summaryQuery.isLoading` não é usado; a tela pisca "—" antes dos números.
- `FootballPitch.tsx:17,23`: verde `#2e7d32` e `#1b5e20` fixos, ilegíveis/destoantes no tema escuro (já registrado no plano §2.5 e §5.3).
- `preserveAspectRatio="none"` distorce as marcações do campo quando o card fica largo.

---

## ⚪ F18 — Acessibilidade

- Botão de alternância de tema (`AppLayout.tsx:84`) sem `aria-label`.
- Botão **Sair** sem confirmação (um clique acidental derruba a sessão — e por causa do F1, voltar exige dois cliques).
- `RosterEntry` na tela da partida não expõe posição nem nível — o organizador confirma "às cegas".

---

# PARTE 3 — QUALIDADE DE CÓDIGO

| Item | Onde | Observação |
|---|---|---|
| `interface PaginatedResponse<T>` duplicada | `matchesApi.ts`, `playersApi.ts`, `drawsApi.ts`, `auditApi.ts` | Extrair para `core/types/api.ts` |
| `invalidateMatchQueries` duplicada | `MatchDetailPage.tsx:85-89` e `QuickConfirmDialog.tsx:45-49` | Extrair para um hook `useMatchInvalidation(matchId)` |
| `dashboardApi` e `recurringGamesApi` dentro de `matchesApi.ts` | `frontend/src/api/` | Quebra a convenção "um módulo por domínio" declarada no plano §1.3 |
| Consulta de confirmados repetida | `draws/services.py`, `matches/serializers.py:88`, `statistics/services.py` | Fonte única `get_confirmed_players(match)` — pré-requisito de B1/B2 |
| `authenticated_client` repetido | 6 arquivos em `backend/tests/` | Já registrado no plano (§2.9), pendente |
| Frontend sem nenhum teste | — | Vitest não configurado; toda a UI é verificada manualmente |
| `# noqa: B007` no laço do SA | `simulated_annealing.py:70` | Funciona, mas `iterations_run` fora do laço é frágil se o laço nunca executar (`max_iterations=0`) |

---

# PARTE 4 — RESULTADO: como cada achado foi corrigido

## Backend

| # | Achado | Como foi corrigido | Arquivo(s) |
|---|---|---|---|
| B1 | Sorteio ignorava `max_players`; não havia fila | Model `WaitlistEntry`, `compute_match_capacity` como fonte única, `set_confirmation` desviando para a fila, `enforce_match_capacity` antes de todo sorteio, promoção automática e manual, 4 endpoints | `matches/models.py`, `matches/services.py`, `matches/views.py`, `draws/services.py` |
| B2 | Jogador inativo/removido era sorteado | `confirmed_confirmations()` — fonte única com `player__status=ATIVO` e `player__is_deleted=False`, consumida pelo sorteio, pelo contador da tela e pela fila | `matches/services.py`, `matches/serializers.py` |
| B3 | `Confirmation` sem filtro de soft-delete na constraint | Constraint com `condition=Q(is_deleted=False)` + `_get_or_revive_confirmation` usando `all_objects` | `matches/models.py`, migration `0005` |
| B4 | POST de jogo recorrente sem campos opcionais → 500 | Cascata explícita: valor enviado → instância → default do model | `matches/serializers.py` |
| B5 | Erros da API re-embrulhados em `{"detail": {...}}` | Handler devolve o formato nativo do DRF; frontend ganhou `getApiErrorMessage`/`getApiFieldErrors` | `common/exceptions.py`, `core/data/apiError.ts` |
| B6 | Placar (`result`) vinha do cliente | `derive_team_outcomes` no servidor; API aceita só `{team_id, goals_scored}`, exige todos os times e recusa ids desconhecidos | `draws/services.py`, `draws/serializers.py` |
| B7 | Convidado da lista de nomes nascia Atacante | `_default_guest_position` escolhe a primeira posição de linha; resolvida sob demanda | `matches/services.py` |
| B8 | Partida removida ressuscitava | `ensure_next_match` consulta `all_objects`; ações `cancel`/`reactivate` como caminho reversível | `matches/services.py`, `matches/views.py` |
| B9 | Sorteio automático perdia a janela | Comparação por janela (`DRAW_AUTO_DRAW_GRACE_MINUTES`, padrão 60 min), idempotente e com retentativa | `draws/tasks.py`, `settings/base.py` |
| B10 | `set_all_confirmations` sem trava de capacidade | Passa pelo controle de capacidade e devolve `{confirmed, waitlisted, declined}` | `matches/services.py` |
| B11 | Throttle diário bloqueava o login de uma rede inteira | Escopo `login` dedicado (20/min) + limites por hora em vez de por dia | `settings/base.py`, `accounts/urls.py` |
| B12 | Sorteio histórico editável pela API | `move_player_to_team` recusa `draw.is_current == False` | `draws/services.py` |
| B13 | Dashboard perdia a partida após o sorteio | Filtro passa a excluir só Cancelada/Concluída | `matches/dashboard_views.py` |
| B14 | Histórico de duplas contaminava o "Sortear novamente" | `PairHistoryRepository.compute(exclude_match=...)` | `draws/repositories.py` |
| B15 | Semântica de aproveitamento ambígua | Mantido incluindo empates (decisão do usuário), variável renomeada e documentada | `statistics/services.py` |
| B16 | Corrida na geração de slug | Retentativa com `IntegrityError` + numeração começando em `-2` | `accounts/models.py` |

## Frontend

| # | Achado | Como foi corrigido | Arquivo(s) |
|---|---|---|---|
| F1 | **Login exigia dois cliques** | `logout` passou a **remover** o cache (antes gravava `null`, deixando a query "com dado" e o guard concluindo "não autenticado"); `isLoading` derivado do dado; navegação só quando a sessão está pronta; interceptor não trata mais 401 de login como sessão expirada | `AuthContext.tsx`, `ProtectedRoute.tsx`, `LoginPage.tsx`, `httpClient.ts` |
| F2 | 401 concorrentes deslogavam o usuário | Promise de refresh compartilhada; sem `window.location`; evento `onSessionExpired` tratado pelo `AuthProvider` | `httpClient.ts`, `sessionEvents.ts`, `client.ts` |
| F3 | Exportação SVG/PNG saía vazia | Jogadores desenhados **dentro** do `<svg>`, drag-and-drop mantido nos nós SVG, foto trocada pela inicial (evita canvas contaminado por CORS) | `PlayerToken.tsx`, `FootballPitch.tsx` |
| F4 | Selects não atualizavam ao editar | Todos migrados para `Controller`; `reset` também no `open` | `PlayerFormDrawer.tsx`, `RecurringGameFormDrawer.tsx` |
| F5 | Posição principal em branco | Select desabilitado até as posições chegarem, com valor controlado | `PlayerFormDrawer.tsx` |
| F6 | Tela sem noção de capacidade/fila | Configuração, barra de ocupação, aviso de partida cheia e `WaitlistPanel` | `MatchDetailPage.tsx`, `WaitlistPanel.tsx` |
| F7 | Erros silenciosos | `onError` em todas as mutations; `mutate` nunca rejeita; `ResultsDialog` com alerta próprio; toasts com a mensagem real da API | camada `core/data` + todas as páginas |
| F8 | Toggle de presença "não respondia" | Estado por jogador em voo: Switch travado + spinner; disparos concorrentes descartados | `MatchDetailPage.tsx`, `useApiMutation.ts` |
| F9 | Listas mostravam só 20 registros | `fetchAllPages` percorre todas as páginas; `DataTable` com paginação | `api/fetchAllPages.ts`, `DataTable.tsx` |
| F10 | Estado de edição não limpo | `closeForm()` limpa o item em edição em todas as páginas | Players/Matches/RecurringGames |
| F11 | Uma requisição por tecla na busca | `useDebouncedValue` (350 ms) | `core/hooks/useDebouncedValue.ts` |
| F12 | Erro de rede virava "nenhuma organização" | Estado de erro próprio com "Tentar novamente" | `OrganizationContext.tsx`, `RequireOrganization.tsx`, `DataTable.tsx` |
| F13 | Chaves React duplicadas | `rowId` estável por linha processada | `QuickConfirmDialog.tsx` |
| F14 | Placar digitado era descartado | Efeito depende dos ids dos times, não do array | `ResultsDialog.tsx` |
| F15 | Editar partida mudava a capacidade | Sem mexer na configuração, os totais originais são reenviados intactos (`dirtyFields`) | `MatchFormDrawer.tsx` |
| F16 | Aba some no detalhe da partida | Aba ativa pelo prefixo mais específico | `AppLayout.tsx` |
| F17 | Dark mode e distorção do campo | Gramado por modo de tema; `preserveAspectRatio="xMidYMid meet"` | `FootballPitch.tsx` |
| F18 | Acessibilidade | `aria-label` no alternador de tema, nos botões da fila e no campo | vários |

## Qualidade de código

- `PaginatedResponse` unificado em `core/types/api.ts`; `fetchAllPages` compartilhado.
- Bloco de invalidação duplicado extraído para `useMatchInvalidation` + `matchKeys` (`matchQueries.ts`).
- `recurringGamesApi` e `dashboardApi` movidos para módulos próprios.
- Consulta de confirmados centralizada em `confirmed_confirmations`.
- Serializers que recebem jogador herdam `_OrganizationScopedPlayerSerializer` (isolamento multi-tenant sem repetição).
- **React Query removido**: substituído por `core/data/` (`queryStore`, `useApiQuery`, `useApiMutation`, `apiError`), sem dependência externa.

## Verificação executada

**Automatizada**
- Backend: **114 testes passando** (75 anteriores + 39 novos), `ruff check` limpo.
- Frontend: `tsc -b` limpo, `oxlint` sem novos avisos, `vite build` OK.

**Manual, no navegador**
- Login com **um clique** — do zero, após senha errada e em **três ciclos seguidos de logout → login**.
- Senha errada mostra "Usuário ou senha inválidos" **sem recarregar a página**.
- Partida de 2 times × 6 de linha + 1 goleiro (14 vagas) com 16 confirmados → **14 confirmados, 2 na lista de espera**, com aviso na tela e badge de posição no roster.
- Sorteio: 2 times × 7 jogadores = 14; a fila permanece intacta.
- Desmarcar um confirmado → **promoção automática** do primeiro da fila, com toast; o sorteio **não** é refeito.
- Exportação: o SVG serializado contém todos os nomes dos jogadores (antes saía vazio).
- Placar 3 x 1 → vitória/derrota derivadas no servidor e refletidas na mensagem do WhatsApp.
- Editar dois jogadores em sequência → os selects mostram os valores corretos de cada um.
- Sem overflow horizontal em 375 px; gramado adaptado ao tema escuro.

---

# Rodada 2 — PostgreSQL e defeitos reportados em uso

## 🔴 R1 — `ProgrammingError: relation "matches_waitlistentry" does not exist`

**Reportado pelo usuário** no dashboard (`/api/dashboard/summary/`, ambiente Docker na porta 8010).

**Causa raiz — e ela é minha.** A configuração de desenvolvimento tinha um **fallback silencioso para SQLite**:

```python
# config/settings/dev.py (antes)
DATABASES = {"default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}")}
```

E a suíte de testes rodava em SQLite em memória:

```python
# config/settings/test.py (antes)
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
```

Sem `DATABASE_URL` definida, eu apliquei a migration da lista de espera e rodei os 114 testes **contra SQLite**, enquanto o Docker e a produção rodam **PostgreSQL**. O banco real nunca recebeu a migration, e o `waitlist_count` do serializer quebrou toda a rota do dashboard.

Pior: o CI **já subia um serviço PostgreSQL**, mas os testes o ignoravam e rodavam em SQLite. O pipeline passava verde sem nunca exercitar o banco de verdade.

**Correção — PostgreSQL em todos os ambientes, sem exceção:**
- `config/settings/dev.py`: fallback para SQLite **removido**; o default aponta para o Postgres do Compose (`localhost:5435`).
- `config/settings/test.py`: passa a usar `TEST_DATABASE_URL` em PostgreSQL. Constraints parciais (`UniqueConstraint` com `condition`), tipos e comportamento transacional não são iguais nos dois bancos — testar em um e rodar no outro esconde exatamente esta classe de defeito.
- `.env` e `.env.example`: `DATABASE_URL` e `TEST_DATABASE_URL` explícitas.
- `.github/workflows/ci.yml`: os testes passam a apontar para o serviço PostgreSQL que já existia.
- Migration aplicada e verificada no banco real: tabela `matches_waitlistentry` criada e índice parcial `unique_confirmation_per_match_player` presente.

**Lição registrada:** paridade de banco entre desenvolvimento, teste, CI e produção não é preferência de estilo — é o que faz o teste significar alguma coisa.

## 🟠 R2 — Painel da lista de espera não atualizava depois de "Sortear Novamente"

**Arquivo:** `frontend/src/features/matches/matchQueries.ts`

Encontrado ao validar a normalização de dado legado no Postgres real: uma partida com 16 confirmados e capacidade 14 foi sorteada corretamente (14 em campo, 2 movidos para a fila **no banco**), mas a tela continuava mostrando "16 de 14 confirmados" e nenhum painel de fila até um reload manual.

**Causa raiz:** `invalidate.draws()` não incluía o roster nem a fila. Isso era correto antes — sortear não mexia em presença. Passou a ser errado quando `enforce_match_capacity` entrou: agora o sorteio **pode** mover gente para a fila. Corrigido incluindo `roster` e `waitlist` na invalidação de sorteio.

Verificado no navegador **sem reload**: `👥 16 de 14 confirmados` → `👥 14 de 14 confirmados · ⏳ 2 na espera`.

## 🟡 R3 — "Editar partida" parecia perder o nome

**Reportado pelo usuário.** **Arquivo:** `frontend/src/features/matches/MatchFormDrawer.tsx`

Investigado no navegador: o formulário **não** estava com defeito de preenchimento — a partida "teste" (nome próprio) abre com "teste" no campo, corretamente.

**Causa raiz — de interface, não de dados.** Partidas geradas por jogo recorrente têm `name = ""`; a listagem exibe o nome do **jogo recorrente** (`match.name || match.recurring_game_name || "Avulsa"`). Ao abrir a edição, o campo "Nome da partida" aparecia vazio e dava a impressão de que o dado tinha sumido.

**Correção:** quando a partida vem de um jogo recorrente e não tem nome próprio, o nome herdado aparece como *placeholder* e o texto de ajuda explica a origem: *"Opcional. Em branco, esta partida continua sendo exibida como «Pelada de Quinta (society)», o nome do jogo recorrente."*

## ⚪ R4 — Verificado e descartado: `0 / 57` na listagem de partidas

Apareceu na listagem e levantei suspeita de erro de unidade no cálculo de capacidade. **Não é bug**: o jogo recorrente "Pelada da Terça" está configurado com 3 times × 6–18 jogadores de linha, e `3 × (18 + 1) = 57` está correto. Registrado aqui para não ser reinvestigado.

## 🔴 R5 — Criar jogo recorrente não gerava a partida (pior no mesmo dia)

**Reportado pelo usuário:** *"quando cria a partida recorrente no mesmo dia ele não cria a partida conforme deveria"*.

**Reproduzido:** criar um jogo recorrente pela API deixava a listagem de partidas com **0 registros**.

**Causa raiz.** A geração de partidas acontecia **exclusivamente** na task periódica `generate_upcoming_matches_task`, agendada de **hora em hora** no Celery Beat. Criar o jogo recorrente não disparava nada. O organizador cadastrava a pelada e não via partida nenhuma — e para um jogo cujo dia da semana é **hoje**, esperar até uma hora significa perder a própria janela de confirmação do jogo. Some-se o fato de a geração depender de `celery-beat` e `celery-worker` estarem no ar: sem eles, a partida **nunca** aparecia.

Verifiquei antes de concluir que o cálculo de datas estava correto — `_next_occurrence` resolve corretamente para hoje quando o dia da semana é o de hoje (testado nos 7 dias). O defeito era só o gatilho.

**Correção:**
- `RecurringGameViewSet.perform_create` chama `ensure_next_match` — a partida nasce junto com o jogo recorrente.
- `perform_update` gera a partida quando o jogo recorrente é **reativado** (`is_active` de falso para verdadeiro).
- Novo endpoint `POST /api/recurring-games/{id}/generate-match/` e o botão **"Gerar a próxima partida agora"** na tela de Jogos Recorrentes, para os dois casos em que a geração automática se abstém de propósito: a ocorrência foi removida pelo organizador (R6) ou ainda está fora da janela de `days_before_to_generate`.
- A ação explícita usa `ensure_next_match(..., force=True)`, que **revive a mesma partida** removida em vez de criar uma duplicata — preservando id, confirmações e histórico de sorteios.

5 testes novos cobrem: criação no mesmo dia, reativação, reabertura de ocorrência removida com histórico preservado, janela de antecedência ignorada na ação explícita e bloqueio para o papel visualizador.

## 🟡 R6 — Efeito colateral do B8: remover a partida da semana travava o jogo recorrente

Consequência direta da correção do **B8** (partida removida não é recriada). Como `ensure_next_match` passou a olhar `all_objects`, uma ocorrência **futura** removida continua sendo "a última partida" e bloqueia a geração até a data dela passar. Correto quanto à intenção ("cancelei o jogo desta semana"), mas sem saída: não havia como reabrir.

Foi assim que o banco do usuário ficou — todas as partidas removidas manualmente (confirmado pelos `deleted_at`, espaçados de 3 a 5 segundos, ou seja, cliques individuais no botão "Remover") e nenhum caminho para trazê-las de volta.

**Correção:** o botão "Gerar a próxima partida agora" (R5) é a saída explícita, e ela **revive** a ocorrência com todo o histórico em vez de criar outra.

## ⚪ R7 — Verificado e descartado: partidas soft-deletadas no banco

Ao investigar o R5 notei que **todas** as 10 partidas do banco estavam com `is_deleted=True` e cheguei a suspeitar de exclusão em massa por bug. **Não é bug**: os `deleted_at` estão espaçados de 3 a 5 segundos em dois blocos (13:12 e 16:27), o padrão de alguém clicando "Remover" uma a uma na interface. Registrado para não ser reinvestigado.

## 🟠 R8 — Alterar o jogo recorrente não avisava sobre a partida já gerada

**Limitação levantada por mim ao fechar o R5, e resolvida a pedido do usuário.**

Alterar o dia da semana, o horário ou o número de times de um jogo recorrente **não** move a partida já gerada. A decisão de não mover está mantida e é deliberada: a partida pode ter confirmações e sorteio, e reescrevê-la por baixo seria destrutivo e silencioso. O problema era o **silêncio**: nada indicava que a partida da semana continuava com a configuração antiga.

**Correção — avisar, em vermelho, sem tocar no dado:**
- `Match.recurring_game_divergences` compara a partida com a configuração **atual** do jogo recorrente (dia da semana, horário, times, mínimo e máximo de jogadores) e devolve as diferenças em `{field, label, match_value, recurring_game_value}`, exposto no `MatchSerializer`.
- Escopo restrito a partidas **que ainda vão acontecer**: partida passada, concluída ou cancelada não gera aviso — divergir de uma configuração alterada depois é o esperado e seria só ruído.
- Componente `DivergenceWarning` em duas formas: chip vermelho compacto na listagem de Partidas (com as diferenças no tooltip) e `Alert` vermelho completo na tela da partida, listando "Esta partida: X → Jogo recorrente: Y" campo a campo.
- O texto explica **por que** a partida não mudou e o que fazer: *"A partida não é alterada automaticamente para não afetar as confirmações e o sorteio que já existem. Edite a partida se quiser que ela acompanhe a nova configuração."*

3 testes cobrem: as 5 divergências detectadas após alterar o jogo recorrente (com a partida comprovadamente intacta), partida avulsa e concluída sem aviso, e partida passada sem aviso.

## Verificação da Rodada 2

- **122 testes passando em PostgreSQL 16.14**, `ruff check` limpo, `tsc -b` limpo.
- Engine confirmada em uso: `django.db.backends.postgresql`, banco `pelada`, host `localhost:5435` (container `sorteiobaba-postgres-1`).
- `GET /api/dashboard/summary/` no backend Docker (porta 8010): **200**, com o objeto `capacity` completo.
- Login com um clique contra o Postgres com dados reais.
- Normalização de dado legado no banco real: partida com 16 confirmados e capacidade 14 → 14 sorteados (2 times × 7) e 2 na fila, na ordem correta (Macedo, mensalista, em 1º; Eduardo Santos, convidado, em 2º).
- `vite build` OK.
- Jogo recorrente criado pela interface para **hoje** → partida gerada na hora, visível na listagem.
- Botão "Gerar a próxima partida agora" no jogo recorrente real do usuário ("Peaky blinders baba", sexta-feira) → partida de 07/08/2026 criada, 2 times × (6 + 1 GOL), capacidade 14.
- Edição de partida: campo de nome preenchido para partida com nome próprio; nome herdado como placeholder para partida de jogo recorrente.
- Divergência provocada no jogo recorrente real ("Peaky blinders baba": sexta→segunda, 13:50→19:30, 2→3 times): chip vermelho `rgb(211,47,47)` na listagem com as 5 diferenças no tooltip, e `Alert` vermelho na tela da partida campo a campo. Legível em tema claro (`rgb(87,35,35)`) e escuro (`rgb(240,188,188)`). A partida permaneceu intacta; ao restaurar a configuração, o aviso some sozinho.

