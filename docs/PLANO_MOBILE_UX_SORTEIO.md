# Plano de Implementação — Mobile First, UX/UI e Evolução do Sorteio

> **Status: IMPLEMENTADO** (10/08/2026). O plano abaixo foi executado fase a fase; o que foi entregue está marcado no checklist da [§29](#29-checklist-de-execução) e comparado ao planejado na [§30](#30-entregue-vs-planejado).
>
> O documento nasceu como auditoria completa do sistema (backend, frontend, banco, Docker, CI, documentação) e foi mantido como registro do diagnóstico — os problemas descritos na §3 são o **estado anterior**, não o atual.
>
> Documentos relacionados (leitura obrigatória antes de implementar): [`REGRAS_DE_NEGOCIO.md`](./REGRAS_DE_NEGOCIO.md), [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md), [`AUDITORIA_BUGS.md`](./AUDITORIA_BUGS.md), [`REQUISITOS.md`](./REQUISITOS.md), [`AGENTS.md`](../AGENTS.md).

---

## Sumário

| # | Seção |
|---|---|
| 1 | [Resumo Executivo](#1-resumo-executivo) |
| 2 | [Arquitetura Atual](#2-arquitetura-atual) |
| 3 | [Problemas Encontrados](#3-problemas-encontrados) |
| 4 | [Melhorias Mobile First](#4-melhorias-mobile-first) |
| 5 | [Melhorias de UX/UI](#5-melhorias-de-uxui) |
| 6 | [Design System](#6-design-system) |
| 7 | [Menu Hamburger](#7-menu-hamburger) |
| 8 | [Sorteio](#8-sorteio) |
| 9 | [Formações](#9-formações) |
| 10 | [Campo SVG](#10-campo-svg) |
| 11 | [Troca de Jogadores](#11-troca-de-jogadores) |
| 12 | [Drag and Drop](#12-drag-and-drop) |
| 13 | [Regras de Equilíbrio](#13-regras-de-equilíbrio) |
| 14 | [Auditoria](#14-auditoria) |
| 15 | [Responsividade](#15-responsividade) |
| 16 | [PWA](#16-pwa) |
| 17 | [Performance](#17-performance) |
| 18 | [Acessibilidade](#18-acessibilidade) |
| 19 | [Backend](#19-backend) |
| 20 | [Banco de Dados](#20-banco-de-dados) |
| 21 | [APIs](#21-apis) |
| 22 | [Componentes Frontend](#22-componentes-frontend) |
| 23 | [Alterações de Dependências](#23-alterações-de-dependências) |
| 24 | [Alterações no Docker](#24-alterações-no-docker) |
| 25 | [Plano de Testes](#25-plano-de-testes) |
| 26 | [Critérios de Aceite](#26-critérios-de-aceite) |
| 27 | [Ordem Recomendada de Implementação](#27-ordem-recomendada-de-implementação) |
| 28 | [Riscos e Impactos](#28-riscos-e-impactos) |
| 29 | [Checklist de Execução](#29-checklist-de-execução) |
| 30 | [Entregue vs. planejado](#30-entregue-vs-planejado) |
| 31 | [Diário do loop de implementação](#31-diário-do-loop-de-implementação) |

---

## 1. Resumo Executivo

### O que o sistema é hoje

Um SaaS multi-organização de gestão de peladas: cadastro de jogadores, jogos recorrentes, partidas, confirmação de presença (inclusive por lista colada do WhatsApp), **sorteio inteligente de times equilibrados** (Simulated Annealing), lista de espera, placar, estatísticas, financeiro (mensalidades + despesas) e auditoria append-only. Backend Django/DRF; frontend React + MUI.

### O diagnóstico em uma frase

**O sistema é maduro no domínio e imaturo na camada de interface para celular.** As regras de negócio são sólidas, documentadas e testadas; o front foi construído desktop-first e recebeu ajustes pontuais de responsividade (`direction={{ xs: "column", sm: "row" }}`, drawer abaixo de `md`), mas **nenhuma tela foi desenhada partindo do celular** — e a tela mais importante do produto (a da partida/sorteio) é justamente a que mais sofre.

### Os quatro problemas estruturais

1. **Toda listagem é uma tabela.** `DataTable` é o único padrão de lista do sistema (Jogadores, Partidas, Financeiro, Pessoas, Estatísticas com **12 colunas**, Auditoria). Em 375px isso vira rolagem horizontal crua. Não existe visão em card/lista para telas pequenas.
2. **O sorteio depende de mouse.** A única forma de ajustar os times depois do sorteio é **arrastar e soltar**. Não existe alternativa por toque, por teclado, nem qualquer forma de **trocar a posição** de um jogador ou **trocar dois jogadores entre si** — funcionalidades pedidas e hoje inexistentes.
3. **Não existe o conceito de formação.** Nem no banco (`Draw`/`Team`/`TeamPlayer`), nem na API, nem no campo SVG. O campo desenha as linhas a partir do `sort_order` da posição cadastrada de cada jogador (`core/fieldLayout.ts`), não de uma formação escolhida. Toda a Parte 12–14 do pedido é funcionalidade **nova**, não ajuste.
4. **O Design System parou na metade.** Existem tokens de tema e 6 componentes compartilhados (bom), mas convivem com emojis usados como ícones, cores hexadecimais hardcoded (times, gramado, jogador), inputs de 40px (abaixo do alvo de toque de 44px) e nenhum componente de bottom sheet, empty state ou skeleton de página.

### Números

| Métrica | Valor |
|---|---|
| Problemas identificados | **99** |
| Alterações propostas | **168** |
| Prioridade CRÍTICA | 21 |
| Prioridade ALTA | 47 |
| Prioridade MÉDIA | 24 |
| Prioridade BAIXA | 7 |
| Migrations novas previstas | 3 |
| Endpoints novos previstos | 6 |
| Componentes frontend novos previstos | 14 |
| Dependências novas propostas | 1 obrigatória + 2 opcionais |

### O que **não** muda

Nenhuma regra de negócio existente é removida. O algoritmo de sorteio (Simulated Annealing, restrição dos piores jogadores, histórico de duplas, equilíbrio, posições, convidados) **permanece intacto** — a formação entra como uma **camada de apresentação/atribuição posterior** à distribuição de times, não como um novo critério dentro da têmpera. Ver §13 para a análise de conflito.

---

## 2. Arquitetura Atual

### 2.1 Repositório

```
SORTEIOBABA/
├── backend/           Django 5 + DRF + Celery
│   ├── apps/          accounts, players, matches, draws, audit, statistics, finance
│   ├── common/        exceptions, mixins, models (soft-delete), pagination, permissions
│   ├── config/        settings (base/dev/prod/test), urls, celery
│   └── tests/         26 arquivos pytest
├── frontend/          React 19 + TS 6 + Vite 8 + MUI 9
│   ├── src/api/       13 módulos *Api.ts (axios)
│   ├── src/core/      data layer própria, types, dateTime, fieldLayout
│   ├── src/features/  admin, audit, auth, dashboard, finance, matches, members,
│   │                  organization, players, recurringGames, statistics
│   ├── src/routes/    ProtectedRoute, RequireOrganization
│   └── src/shared/    components (6), layout (AppLayout), theme (ColorModeContext)
├── docs/              5 documentos (regras, requisitos, planos, auditoria)
├── docker-compose.yml postgres, redis, backend, celery-worker, celery-beat, frontend
└── .github/workflows/ci.yml
```

### 2.2 Backend

| Item | Estado |
|---|---|
| Stack | Python 3.13, Django 5.x, DRF, Celery + Redis, PostgreSQL (SQLite em dev sem `DATABASE_URL`) |
| Autenticação | JWT (SimpleJWT), access 30min, refresh 7d com rotação + blacklist |
| Multi-tenancy | `Organization` + `Membership` + header `X-Organization-Id`, resolvido em `apps/accounts/organization_context.py` e aplicado por `common/mixins.py` / `common/permissions.py` |
| Papéis | `admin`, `organizador`, `visualizador`, `jogador` + `is_superadmin` transversal |
| Soft-delete | `common/models.py` — `BaseModel` / `OrganizationOwnedModel` (`is_deleted`, `deleted_at`) |
| Auditoria | `apps/audit/models.py` — append-only, FKs para `match`/`draw`/`player`/`team_from`/`team_to` + par genérico `entity`/`entity_id` |
| Motor de sorteio | `apps/draws/domain/` — **framework-agnostic** (dataclasses puras, sem Django) |
| Paginação | `common/pagination.py`, `PAGE_SIZE = 20` global |
| Throttling | `2000/hour` usuário, `120/hour` anônimo, escopo `login` `20/minute` |
| Docs API | drf-spectacular em `/api/docs/` |

**Modelos centrais do sorteio** (`backend/apps/draws/models.py`):

```
Draw(organization, match, algorithm, trigger, weights, score_balance,
     score_position, score_repetition, total_score, iterations_run,
     is_current, executed_by)
  └── Team(draw, name, color, order_index)
        ├── TeamPlayer(team, player, position_snapshot→Position,
        │              skill_snapshot, used_secondary_position)
        └── TeamResult(team, goals_scored, goals_conceded, result)
```

> **Nenhum campo de formação, linha ou slot existe hoje.**

**Motor de sorteio** (`apps/draws/domain/`):

- `entities.py` — `Player(id, skill_level, primary_position_id, secondary_position_id, is_guest)`
- `scoring.py` — 6 critérios com pesos fixos: `balance=1.0`, `position=1.0`, `repetition=0.5`, `secondary_usage=0.3`, `weakest_split=10.0`, `guest_balance=0.3`
- `strategies/simulated_annealing.py` — seed em serpentina do pior para o melhor + têmpera (20.000 iterações máx, 3.000 sem melhora, resfriamento 0,995), com **restrição dura** de separação dos piores (`minimum_weakest_split_cost` como piso; qualquer candidato acima é descartado antes de avaliar o resto do score)

**Fluxo do sorteio** (`apps/draws/services.py::execute_draw`):
`get_match_capacity` → `enforce_match_capacity` (excedente → fila) → `get_confirmed_players` → valida mínimo → monta entidades puras → `PairHistoryRepository.compute` (janela de 10 sorteios) → `SimulatedAnnealingStrategy.solve` → grava `Draw`/`Team`/`TeamPlayer` → marca partida `drawn` → `log_action(DRAW_CREATED)`.

**Posições** (`apps/players/models.py::Position`): por organização, com `code`, `name`, `sort_order`, `is_active`. Semeadas em `apps/players/repositories.py::DEFAULT_POSITIONS` como `GOL(1)`, `ZAG(2)`, `ME(3)`, `AT(4)`. **A organização pode criar posições adicionais livremente** — qualquer solução de formação precisa respeitar isso.

### 2.3 Frontend

| Item | Estado |
|---|---|
| Stack | React 19.2, TypeScript 6, Vite 8, MUI 9.3 + `@mui/icons-material`, `@mui/x-charts` 9.10 |
| Roteamento | `react-router-dom` 7, 12 rotas protegidas em `src/App.tsx` |
| Formulários | `react-hook-form` 7.84 |
| Drag & drop | `@dnd-kit/core` 6.3 (apenas `PointerSensor`) |
| Data layer | **própria** — `src/core/data/` (`queryStore`, `useApiQuery`, `useApiMutation`, `apiError`). React Query foi removido de propósito (ver `AGENTS.md`) |
| HTTP | axios com interceptors em `src/core/httpClient.ts` + `src/api/client.ts` |
| Tema | `src/shared/theme/ColorModeContext.tsx` — paleta verde, Inter, 25 sombras suaves, `borderRadius` 12, overrides de 10 componentes MUI |
| Componentes compartilhados | `DataTable`, `FormDrawer`, `PageHeader`, `StatusChip`, `ConfirmDialog`, `ToastProvider` |
| Testes | Vitest + Testing Library, 6 arquivos `*.test.ts(x)`, concentrados em `features/matches` e `features/finance` |
| Lint | oxlint |
| Build | `tsc -b && vite build`, sem `manualChunks`, sem code splitting |

**Layout** (`src/shared/layout/AppLayout.tsx`): `AppBar position="static"` + `Tabs` acima de `md`; `Drawer` lateral esquerdo abaixo de `md`. `NAV_ITEMS` tem 10 entradas com filtro por papel + item exclusivo de superadmin. **Nenhum ícone.**

**Tela da partida** (`src/features/matches/MatchDetailPage.tsx`, 884 linhas — o maior componente do sistema): card de configuração, painel de fila de espera, lista de presença, overlay de embaralhamento, histórico de sorteios, cards de time (`TeamResultCard`) com campo SVG (`FootballPitch` + `PlayerToken`), observações de alterações manuais (`ManualMovesNotes`) e bloco do WhatsApp (`WhatsAppShareCard`).

**Campo SVG** (`FootballPitch.tsx` + `core/fieldLayout.ts`):
- `viewBox="0 0 100 140"`, `maxWidth: 240px`, `preserveAspectRatio="xMidYMid meet"`
- `computeFieldLayout` agrupa jogadores por `positionSortOrder` distinto → cada valor distinto vira uma **linha**; `y` interpolado entre 88 (embaixo) e 12 (em cima); `x = (i+1)/(n+1) * 100`
- `PlayerToken` desenha um `<g>` dentro do SVG (círculo com inicial, nome truncado em 11 caracteres, estrelas), com `data-player-id`/`data-team-player-id`/`data-team-id` e `useDraggable`

### 2.4 Infraestrutura

- `docker-compose.yml`: postgres:16 (`5435:5432`), redis:7, backend (`8010:8000`, `runserver`), celery-worker, celery-beat, frontend (`5175:5173`, **`npm run dev`**)
- `frontend/Dockerfile`: `node:22-alpine`, `npm install`, `npm run dev --host` → **não existe imagem de produção** (sem `npm run build` + servidor estático)
- CI: backend (ruff + pytest contra PostgreSQL) e frontend (oxlint + vitest + build) + build das duas imagens Docker

### 2.5 PWA — estado atual

**Não existe PWA.** Verificado: não há `manifest.webmanifest`, não há service worker, não há `apple-touch-icon`, não há `<meta name="theme-color">`, e o `frontend/index.html` tem apenas `favicon.svg` + viewport. `frontend/public/icons.svg` é **lixo de template** (ícones de bluesky/discord/github/x) e não é referenciado em lugar nenhum do código.

---

## 3. Problemas Encontrados

Formato: `ID | Tela/Arquivo | Problema | Impacto | Solução proposta | Prioridade`.
Larguras de referência usadas na análise: **320 / 375 / 390 / 414 / 768 / 1024 / 1440 px**.

### 3.A Navegação e Layout — 9 problemas

| ID | Tela / Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-01 | `shared/layout/AppLayout.tsx:87` | `AppBar position="static"` — o cabeçalho sai da tela ao rolar. Em telas longas (partida com 25 jogadores) não há acesso ao menu sem voltar ao topo. | Alto — navegação inacessível durante o uso real | `position="sticky"` + barra inferior de navegação no mobile | **CRÍTICO** |
| P-02 | `AppLayout.tsx:136` | Item ativo do drawer usa `selected={item.path === location.pathname}` (igualdade exata). Em `/partidas/123` **nenhum item fica marcado** — inconsistente com o `currentTab` das abas (linhas 75–78), que usa prefixo. | Médio — usuário perde a noção de onde está | Reaproveitar a mesma lógica de prefixo para os dois | ALTO |
| P-03 | `AppLayout.tsx:127-144` | Drawer ancorado à esquerda, itens no topo, largura fixa 260px, sem botão de fechar, sem `safe-area-inset`. Área do polegar (terço inferior) fica vazia. | Alto — uso com uma mão inviável | Drawer redesenhado (§7): cabeçalho com identidade, itens com ícone, ações no rodapé | **CRÍTICO** |
| P-04 | `AppLayout.tsx:99-103` | `<Tabs>` sem `variant="scrollable"`. Com 8–10 itens visíveis (admin vê 9 + Sistema) as abas espremem/cortam em notebooks 1024–1280px. | Alto — itens inalcançáveis no desktop pequeno | `variant="scrollable"` + `allowScrollButtonsMobile`, ou migrar para menu lateral permanente em `lg+` | ALTO |
| P-05 | `AppLayout.tsx:110` | Nome da organização escondido em `xs` (`display: { xs: "none", sm: "block" }`). Em multi-org, o usuário no celular não sabe em qual pelada está. | Alto — risco de agir na organização errada | Mostrar sempre (truncado) ou como subtítulo do título | ALTO |
| P-06 | `AppLayout.tsx:120` | Botão "Sair" fixo na barra, colado no toggle de tema, sem confirmação. Em 375px os dois ficam a ~8px de distância. | Médio — logout acidental | Mover "Sair" para o rodapé do drawer + `ConfirmDialog` | MÉDIO |
| P-07 | `AppLayout.tsx:146` | Conteúdo em `Box sx={{ p: { xs: 2, sm: 3 } }}` sem `maxWidth`. Em 1440px+ e 4K o conteúdo estica de borda a borda. | Médio — legibilidade em telas largas | `Container maxWidth="lg"` + `disableGutters` no mobile | MÉDIO |
| P-08 | `AppLayout.tsx` (todo) | Sem estrutura de landmarks (`<header>`, `<nav>`, `<main>`), sem skip-link. | Médio — navegação por leitor de tela ruim | `component="header"/"nav"/"main"` + skip-link | MÉDIO |
| P-09 | `App.tsx:62` | Rota `*` redireciona para `/` — usuário sem permissão para `/` (perfil `jogador`) entra em loop visual de redirecionamento. | Baixo | Página 404 dedicada com CTA para a home do papel | BAIXO |

### 3.B Tabelas e Listagens — 9 problemas

| ID | Tela / Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-10 | `shared/components/DataTable.tsx:158` | `TableContainer sx={{ overflowX: "auto" }}` é a **única** estratégia mobile. Toda listagem vira rolagem horizontal crua. | Alto — atinge 6 telas | `DataTable` ganha `renderCard` e alterna automaticamente para lista de cards abaixo de `md` (§22) | **CRÍTICO** |
| P-11 | `features/statistics/StatisticsPage.tsx:40-94` | Tabela com **12 colunas** (jogos, vitórias, derrotas, empates, aproveitamento, presenças, ausências, 2 sequências, média ⭐, dias). Em 375px são ~5 telas de rolagem lateral. | Alto — tela inutilizável no celular | Card por jogador com 4 métricas principais + expandir para o resto | **CRÍTICO** |
| P-12 | `features/players/PlayersPage.tsx:158-228` | Tabela com 6 colunas incluindo `Rating` (5 estrelas ≈ 90px) e coluna de ações. Excede 375px com folga. | Alto — tela mais usada depois da partida | Card de jogador conforme §5 (nome, apelido, estrelas, posição, tipo, ação) | **CRÍTICO** |
| P-13 | `features/audit/AuditLogPage.tsx:32-54` | 7 colunas, incluindo **IP** e "Time origem → destino". `before`/`after` (o conteúdo real da auditoria) **não são exibidos em nenhum lugar**. | Alto — a trilha é ilegível justamente para o caso `player_moved` | Card com timeline + detalhe expansível mostrando `before`/`after` formatados | ALTO |
| P-14 | `features/finance/FinancePage.tsx:351-451` | Aba de mensalidades com 7 colunas + coluna de ações com 2 botões de texto. | Alto | Card de cobrança | ALTO |
| P-15 | `MatchesPage.tsx:186-222`, `PlayersPage.tsx:205-227`, `RecurringGamesPage.tsx:121-162` | `IconButton size="small"` = **34×34px** de alvo real. Mínimo recomendado: 44×44px (48px no Material 3). | Alto — toques errados, especialmente em Remover ao lado de Editar | Alvos de 44px + menu de overflow (⋮) no mobile em vez de ícones enfileirados | **CRÍTICO** |
| P-16 | `DataTable.tsx:240-255` | `TablePagination` com `labelRowsPerPage="Linhas por página"` e `rowsPerPageOptions=[25,50,100]` estoura 375px. | Médio | Paginação compacta no mobile ("25 de 87" + setas) ou rolagem infinita | MÉDIO |
| P-17 | `FinancePage.tsx:689-793` | **9 filtros** (status, competência, mensalista, 2 datas de vencimento, 2 valores, 2 datas de pagamento) num `Stack` com `flexWrap`. No celular ocupa mais de uma tela inteira antes de qualquer dado. | Alto — o conteúdo some atrás dos filtros | Barra com chips de filtro ativo + bottom sheet "Filtros" (§22) | ALTO |
| P-18 | `DataTable.tsx:104-108` + `api/fetchAllPages.ts` | A tabela pagina **no cliente** sobre um array que já veio inteiro (`fetchAllPages` lê até 50 páginas × 100 itens). Tudo em memória. | Médio — memória e tempo de carga no celular | Paginação/scroll infinito servidos pela API (`page`/`page_size`) | MÉDIO |

### 3.C Tela da Partida e Sorteio — 15 problemas

| ID | Tela / Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-19 | `MatchDetailPage.tsx:526-557` | **O botão "🎲 Sortear Times" não é alcançável sem rolar.** No mobile o `Stack` empilha "📝 Lista de nomes", "⚽ Lançar Placar" e só então o botão principal, tudo abaixo de 5 linhas de texto de configuração. | Alto — a ação central do produto está enterrada | Barra de ação fixa no rodapé (`AppBar position="fixed" bottom`) com a ação primária contextual | **CRÍTICO** |
| P-20 | `MatchDetailPage.tsx:536-555` | O motivo de o botão estar desabilitado vive **só num `Tooltip`** ("Aguardando o mínimo de N confirmados"). Tooltip não existe em toque. | Alto — usuário não entende por que não consegue sortear | Texto sempre visível abaixo do botão (o dado já existe em `capacity.min_players`) | **CRÍTICO** |
| P-21 | `MatchDetailPage.tsx:659-725` | Lista de presença sem busca, sem filtro e sem contador fixo. Com 25–30 jogadores é rolagem longa para achar uma pessoa. | Alto | Campo de busca + chips de filtro (Confirmados / Pendentes / Na espera) + contador sticky | ALTO |
| P-22 | `MatchDetailPage.tsx:302-308` | A lista se reordena a cada alteração de presença (confirmados sobem). No celular a linha que acabou de ser tocada **salta para longe do dedo**. | Médio — erro de toque em sequência | Manter a ordem estável durante a sessão de edição; reordenar só ao recarregar, com botão "Reordenar" explícito | ALTO |
| P-23 | `MatchDetailPage.tsx:628-657` | "Adicionar jogador pelo nome": `TextField` + `Button` em `display:flex` com `helperText` de 2 linhas e botão de `height: 40` fixo — desalinha e espreme abaixo de 360px. | Médio | Empilhar no mobile; botão `fullWidth`; helper como texto auxiliar do campo | MÉDIO |
| P-24 | `MatchDetailPage.tsx:472-582` | Card de configuração com 6 linhas de texto denso (`⚙️`, `👥`, `🤖`, `⏳`, `📝`) mais barra de progresso e alertas. Em 375px passa de 40% da primeira tela sem nenhuma ação. | Alto — não há hierarquia | Resumo em 2 linhas + "ver detalhes" expansível; métricas como chips | ALTO |
| P-25 | `MatchDetailPage.tsx:731-747` | Chips do histórico de sorteios com data/hora completa (`10/08/2026 14:32`) — em 4+ sorteios ocupam 3 linhas de chips de 32px. | Baixo | Select/bottom sheet "Versão do sorteio" | BAIXO |
| P-26 | `MatchDetailPage.tsx:780-827` | Cards de time em `flex: "1 1 300px"` com o separador `⚽ VS ⚽` como item flex. Com 3+ times e `flexWrap`, o separador aparece órfão no início de linhas quebradas. | Médio | Grid responsivo sem separador flex (o "VS" vira decoração do card) | MÉDIO |
| P-27 | `MatchDetailPage.tsx:762-771` | Score do sorteio exposto como `Equilíbrio: 4.25 · Repetição: 1.50` — números crus sem unidade nem interpretação. | Médio — informação inútil para o organizador | Indicador qualitativo ("Times equilibrados — diferença de 1 estrela") com detalhe técnico opcional | MÉDIO |
| P-28 | `features/matches/WhatsAppShareCard.tsx:50-63` | `TextField` `multiline` com `minRows={6}` e `maxRows={20}` — no celular o bloco de texto empurra os dois botões de ação para fora da tela. | Alto — a ação mais usada do produto (copiar para o grupo) fica escondida | Prévia colapsada (3 linhas) + botões no topo do card + botão flutuante de copiar | ALTO |
| P-29 | `features/matches/shareFormat.ts:74-90` | O texto do WhatsApp **não inclui posição nem formação** — só nomes. | Médio — requisito 22 do pedido | Incluir posição por jogador e a formação de cada time (§9) | ALTO |
| P-30 | `features/matches/QuickConfirmDialog.tsx:188` | `Dialog maxWidth="sm" fullWidth` com textarea `minRows={8}` + 6 linhas de explicação + alertas. Em 375px o diálogo praticamente ocupa a tela, mas **com margens**, e o `Autocomplete` dentro de cada `ListItem` estoura a largura. | Alto — o fluxo "colar lista do WhatsApp" é o principal caminho de confirmação | `fullScreen` abaixo de `sm` + `AppBar` de diálogo com "Fechar" | ALTO |
| P-31 | `features/matches/WaitlistPanel.tsx:88-138` | 4 `IconButton size="small"` por linha (promover, subir, descer, remover) = 4 alvos de 34px lado a lado, e o motivo de "promover" estar desabilitado só existe em `Tooltip`. | Alto | Menu de overflow por item + mensagem visível de "sem vaga" | ALTO |
| P-32 | `MatchDetailPage.tsx:466` | `GlobalStyles` de impressão declarado dentro da página. Funciona, mas o CSS de print não trata quebra de página entre cards de time. | Baixo | Regras `break-inside: avoid` nos cards | BAIXO |
| P-33 | `MatchDetailPage.tsx:84-884` | Componente de **884 linhas** com 6 queries, 7 mutations e 10 estados locais. Qualquer alteração de UI aqui tem alto risco de regressão. | Alto — risco de manutenção | Quebrar em `MatchHeaderCard`, `PresencePanel`, `DrawResultSection`, `useMatchDraw()` | ALTO |

### 3.D Campo SVG e Movimentação — 9 problemas

| ID | Tela / Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-34 | `features/matches/FootballPitch.tsx:68` | `maxWidth: 240` fixo. Num celular de 375px há 343px úteis e o campo usa 240. Com `viewBox` 100×140 e `fontSize="3.9"`, o nome do jogador renderiza a **~9px** — ilegível. | Alto — o campo é o coração do resultado | Campo fluido (`width: 100%`, `maxWidth` só em `md+`), viewBox ampliado e tipografia proporcional (§10) | **CRÍTICO** |
| P-35 | `core/fieldLayout.ts:41` | `x = ((i + 1) / (n + 1)) * 100`. Com 4 jogadores numa linha o espaçamento é de 20 unidades; o texto do nome (11 caracteres a `fontSize 3.9`) ocupa ~22 unidades → **os nomes se sobrepõem**. | Alto | Escalonar fonte e truncamento pelo tamanho da linha + deslocamento vertical alternado (§10) | **CRÍTICO** |
| P-36 | `core/fieldLayout.ts:26-45` | As linhas do campo vêm do `positionSortOrder` **distinto presente no time**. Um time sem meio-campistas desenha 2 linhas; outro com 4 posições desenha 4. Os times ficam com desenhos incomparáveis, e **não há como escolher a formação**. | Alto — requisito 12–14 | Layout dirigido pela **formação** (§9/§10), com `fieldLayout` recebendo `lines: number[]` | **CRÍTICO** |
| P-37 | `FootballPitch.tsx:88-107` | O campo desenha **um só gol** (embaixo) e a marcação é de meio-campo — visualmente é "meio campo com linha central", o que confunde a leitura da formação. | Médio | Desenho revisto: campo vertical completo ou meio-campo coerente com o gol único | MÉDIO |
| P-38 | `FootballPitch.tsx:83` | `role="img"` no `<svg>` com filhos interativos (`PlayerToken` com `useDraggable`). Em várias tecnologias assistivas, `role="img"` **remove os descendentes da árvore de acessibilidade** — os jogadores somem para o leitor de tela. | Alto — a11y | `role="group"` + `aria-label`, com uma descrição textual paralela (a escalação em lista já existe) | ALTO |
| P-39 | `features/matches/PlayerToken.tsx:80` | Convidado é sinalizado **apenas por cor** (`fill="#dc2626"`) dentro do campo. | Médio — daltonismo | Marcador de forma (anel tracejado / etiqueta "C") além da cor | MÉDIO |
| P-40 | `PlayerToken.tsx:15` | `MAX_NAME_CHARS = 11` fixo, independente do tamanho da linha e do tamanho de tela. | Médio | Truncamento calculado (§10) | MÉDIO |
| P-41 | `features/matches/exportUtils.ts:13-19` | `serializeSvg` usa `getBoundingClientRect()` para dimensionar. **No mobile, com o campo em 240px, o PNG exportado sai em 240×336** (×2 = 480×672) — baixa resolução para compartilhar no grupo. | Médio | Exportar em dimensão fixa de alta resolução (ex.: 1080×1512), independente do render | ALTO |
| P-42 | `TeamResultCard.tsx:168-177` | A única instrução de edição é "Arraste um jogador para outro time para ajustar manualmente" — **não há alternativa por toque nem por teclado**. | Alto — requisito 16 | Modo de seleção por toque (§11/§12) | **CRÍTICO** |

### 3.E Dashboard e Jogadores — 7 problemas

| ID | Tela / Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-43 | `features/dashboard/DashboardPage.tsx:21-36` | 6 cards de igual peso visual (`h4`), sem hierarquia: "Próxima partida" tem o mesmo destaque de "Convidados". | Alto — o que importa não aparece primeiro | Hierarquia definida em §5: Hoje → Próximo sorteio → Confirmados → Pendências → Financeiro | **CRÍTICO** |
| P-44 | `DashboardPage.tsx:26` | O card "Próxima partida" mostra **só a data**, sem horário, local ou contagem regressiva. | Alto | Card-herói com data, hora, local, ocupação e ação primária | ALTO |
| P-45 | `DashboardPage.tsx:42-48` | A ação "Confirmar presença" está no `PageHeader`; ao rolar até os cards ela sai da tela e o card da próxima partida não é clicável. | Médio | Card inteiro clicável + ação repetida no card | MÉDIO |
| P-46 | `DashboardPage.tsx` (todo) | Sem nenhuma informação de **pendências** (sorteio automático travado, mensalidades vencidas, fila de espera de outras partidas) nem de **financeiro**, apesar de os dados existirem na API. | Alto — requisito 9 | Blocos "Pendências" e "Financeiro do mês" | ALTO |
| P-47 | `PlayersPage.tsx:269-302` | Barra de ações em lote não é fixa: seleciona-se 10 jogadores, rola a lista e as ações somem. | Médio | Barra de ação flutuante fixa no rodapé enquanto houver seleção | MÉDIO |
| P-48 | `PlayersPage.tsx:243-267` | Filtros (busca + 2 selects) sempre visíveis, ocupando ~120px do topo no mobile. | Baixo | Busca visível + demais filtros em bottom sheet | MÉDIO |
| P-49 | `PlayersPage.tsx:185` | Nível exibido como `Rating readOnly` (5 ícones). Em card mobile isso é desperdício de largura. | Baixo | `3★` compacto no card; `Rating` só no desktop e no formulário | BAIXO |

### 3.F Formulários, Drawers e Diálogos — 9 problemas

| ID | Tela / Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-50 | `shared/components/FormDrawer.tsx:33` | `width: { xs: "100vw" }` — `100vw` **inclui a barra de rolagem** em navegadores desktop e causa overflow horizontal do body. | Médio | `width: { xs: "100%" }` + `maxWidth: "100vw"` | MÉDIO |
| P-51 | `FormDrawer.tsx:37-50` | Botões Salvar/Cancelar ficam **no fim do conteúdo**, não fixos. `PlayerFormDrawer` tem 10 campos + upload: no celular é preciso rolar tudo para salvar. | Alto | Rodapé fixo (`position: sticky; bottom: 0`) com as ações | ALTO |
| P-52 | `FormDrawer.tsx:32` | Sem cabeçalho fixo e sem botão de fechar (X). A única saída é "Cancelar" no fim. | Médio | Cabeçalho sticky com título + X | ALTO |
| P-53 | `features/matches/MatchFormDrawer.tsx:196-231` | Campos numéricos `type="number"` sem `inputMode="numeric"`: teclado errado no iOS e spinners ocupando espaço. | Médio | `inputMode="numeric"` + `pattern` + botões −/+ (stepper) no mobile | MÉDIO |
| P-54 | `shared/theme/ColorModeContext.tsx:143` | `MuiTextField defaultProps: { size: "small" }` global → altura de **40px** em todos os campos do sistema. Abaixo do alvo de toque de 44px. | Alto — atinge todos os formulários | `size: "medium"` (56px) abaixo de `md`; `small` só em `md+` | **CRÍTICO** |
| P-55 | vários (`PlayersPage.tsx:284`, `FinancePage.tsx:424`, `MatchDetailPage.tsx:608`) | Uso extensivo de `Button size="small"` (30px de altura) para ações reais. | Alto | Tamanho mínimo 44px no mobile via override de tema | **CRÍTICO** |
| P-56 | `shared/components/ConfirmDialog.tsx:30` | `Dialog` sem `fullWidth`; no mobile fica estreito e o texto de descrição (frequentemente longo — ver `MatchDetailPage.tsx:875`) vira um bloco alto e apertado. | Médio | `fullWidth` + botões `fullWidth` empilhados no mobile | MÉDIO |
| P-57 | `shared/components/ToastProvider.tsx:46` | `Snackbar` em `bottom center` — vai cobrir a futura barra de ação fixa e a navegação inferior. | Médio | `anchorOrigin` no topo no mobile, ou offset acima da barra | MÉDIO |
| P-58 | `ToastProvider.tsx:44` | `autoHideDuration = 4000` para mensagens de até 2 frases (ex.: `MatchDetailPage.tsx:200-203`). | Baixo | Duração proporcional ao tamanho + ação "Desfazer" quando aplicável | BAIXO |

### 3.G Design System e Tema — 12 problemas

| ID | Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-59 | `ColorModeContext.tsx:85-97` | A paleta só define `primary`, `secondary`, `error`, `warning`, `success`, `background`, `divider`. **Não há tokens semânticos** (`surface`, `surfaceVariant`, `muted`, `border`, `info`). | Alto — cada tela inventa a sua cor | Paleta estendida com módulo de tokens (§6) | ALTO |
| P-60 | `ColorModeContext.tsx:100-108` | Tipografia define só `h4`–`h6`, `subtitle`, `button`. **Sem `h1`–`h3`, sem escala fluida.** As páginas usam `h5` como título principal. | Médio | Escala tipográfica completa com `clamp()` (§6) | ALTO |
| P-61 | `ColorModeContext.tsx:34-60` | `SOFT_SHADOWS` usa `rgba(15, 23, 42, ...)` (azul-escuro) nos **dois** modos. No tema escuro a sombra é invisível e a hierarquia de elevação some. | Médio | Duas escalas de sombra por modo | MÉDIO |
| P-62 | todo o front | **Emojis como ícones**: `🎲 Sortear`, `⚽ Lançar Placar`, `📝 Lista de nomes`, `✅ Confirmar todos`, `❌ Desmarcar`, `🗑️ Remover`, `⏸️ Inativar`, `⚙️ Sistema`, `📋 Copiar`, `📤 Enviar`, `👥`, `⏳`, `🤖`, `📅`, `📍`… convivendo com `@mui/icons-material`. Renderização varia por SO, leitor de tela verbaliza ("bola de futebol"), alinhamento vertical inconsistente. | Alto — identidade visual e a11y | Sistema de ícones único (`@mui/icons-material`) com mapa central; emoji só onde é conteúdo (mensagem do WhatsApp, identidade dos times) | ALTO |
| P-63 | `features/matches/shareFormat.ts:8-18` | `TEAM_COLORS` — 9 hexadecimais fixos, sem relação com o tema e sem verificação de contraste em modo escuro. | Médio | Tokens de time no tema, com variante clara/escura | MÉDIO |
| P-64 | `FootballPitch.tsx:23-26` | `PITCH_COLORS` hardcoded (já com variante clara/escura — melhor que o resto, mas fora do tema). | Baixo | Migrar para o tema | BAIXO |
| P-65 | `PlayerToken.tsx:80-121` | Cores fixas: `#dc2626`, `#ffffff`, `#1f2937`, `#ffd54f`, `rgba(0,0,0,0.65)`. | Médio | Tokens | MÉDIO |
| P-66 | `ColorModeContext.tsx:63-66` | Modo inicial lê só `localStorage`, com fallback `"light"`. **Ignora `prefers-color-scheme`.** | Médio | Respeitar a preferência do SO na primeira visita | MÉDIO |
| P-67 | `frontend/index.html` | Sem `<meta name="theme-color">` e sem `color-scheme`. A barra do navegador do celular fica branca no tema escuro. | Médio | `theme-color` por `prefers-color-scheme` + `color-scheme: light dark` | MÉDIO |
| P-68 | `shared/components/` | **Não existem**: `EmptyState`, `PageSkeleton`, `BottomSheet`, `Tabs` padronizado, `Dropdown`/menu de overflow, `Avatar` padronizado, `Switch`/`Radio`/`Checkbox` com rótulo padronizado. Cada tela resolve à mão. | Alto — duplicação e inconsistência | 14 componentes novos (§22) | ALTO |
| P-69 | `PlayersPage.tsx:316`, `MatchesPage.tsx:257`, `AuditLogPage.tsx:86` etc. | Estados vazios são apenas texto cinza centralizado, sem ilustração e **sem CTA** ("Nenhum jogador encontrado." e nada mais). | Médio | `EmptyState` com ícone, texto e ação | MÉDIO |
| P-70 | `frontend/index.html:2` | `<html lang="en">` num sistema 100% em português. Leitor de tela lê os textos com fonética inglesa. | Alto — a11y (bug real, correção de 1 linha) | `lang="pt-BR"` | ALTO |

### 3.H Acessibilidade — 10 problemas

| ID | Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-71 | `MatchDetailPage.tsx:536`, `WaitlistPanel.tsx:89`, `TeamResultCard.tsx:148` | Informação essencial só em `Tooltip` (motivo de desabilitado, função dos botões de exportar). Toque não dispara hover. | Alto — requisito 8 | Rótulo/texto visível ou `aria-describedby` com texto renderizado | **CRÍTICO** |
| P-72 | `MatchDetailPage.tsx:95-97` | `useSensors(useSensor(PointerSensor, ...))` — **sem `KeyboardSensor`**. Arrastar por teclado é impossível. | Alto | `KeyboardSensor` + `sortableKeyboardCoordinates`, e o modo de seleção por toque (que também resolve teclado) | ALTO |
| P-73 | `FootballPitch.tsx:83` | `role="img"` esconde os jogadores da árvore de acessibilidade (ver P-38). | Alto | `role="group"` | ALTO |
| P-74 | `shared/components/PageHeader.tsx:18` | Título da página é `Typography variant="h5"` → renderiza `<h5>`. **Nenhuma página tem `<h1>`.** Hierarquia de headings quebrada em todo o sistema. | Médio | `component="h1"` mantendo o estilo `h5` | ALTO |
| P-75 | `ColorModeContext.tsx:87` | `primary.main = #1e8e3e` com `contrastText: #ffffff` → contraste ≈ **3,6:1**. Abaixo de 4,5:1 (WCAG AA para texto normal). Botões primários preenchidos com texto branco falham. | Alto | Escurecer o primário para texto (`#146c2e` ≈ 5,4:1) ou usar texto maior/semibold com o tom atual — **a decidir com verificação formal** | ALTO |
| P-76 | `PlayerToken.tsx:110-122` | Estrelas em `#ffd54f` sobre gramado verde com contorno preto de 0,8 — contraste não verificado. | Médio | Verificar e ajustar | MÉDIO |
| P-77 | tema | Sem customização de `:focus-visible`. O anel de foco padrão do MUI some sobre superfícies coloridas (cards de time, campo). | Médio | Token de foco global de alto contraste | MÉDIO |
| P-78 | `DataTable.tsx:204-210` | Linha clicável é um `<tr onClick>` — **não é focável nem acionável por teclado**. | Médio | `tabIndex`/`role="button"` na linha ou link real na primeira célula | MÉDIO |
| P-79 | `StatisticsPage.tsx:109-115` | `BarChart` do `@mui/x-charts` sem descrição textual alternativa. | Baixo | `aria-label` + tabela como alternativa textual (já existe abaixo) | BAIXO |
| P-80 | `PlayersPage.tsx:243`, `FinancePage.tsx` | Campos de filtro sem `aria-controls`/`aria-live` para anunciar a mudança do número de resultados. | Baixo | Região `aria-live="polite"` com "N resultados" | BAIXO |

### 3.I Performance — 9 problemas

| ID | Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-81 | `src/App.tsx:10-21` | **Nenhum code splitting.** Todas as 12 páginas são importadas estaticamente, incluindo `StatisticsPage` que arrasta `@mui/x-charts` (dependência pesada) e `FinancePage` com 10 sub-componentes. Um jogador que só confirma presença baixa o bundle inteiro. | Alto — primeiro carregamento em 4G | `React.lazy` + `Suspense` por rota | ALTO |
| P-82 | `FinancePage.tsx:118-141` | **7 queries em paralelo no mount** (capabilities, charges, summary, players, plans, memberFees, expenses, recurringExpenses), várias usando `fetchAllPages`. | Alto | Carregar por aba (lazy por tab) + `enabled` | ALTO |
| P-83 | `MatchDetailPage.tsx:124-136` | 5 queries em paralelo ao abrir a partida (match, roster, waitlist, currentDraw, drawHistory). O histórico raramente é usado. | Médio | `drawHistory` sob demanda | MÉDIO |
| P-84 | `api/fetchAllPages.ts` | Toda listagem busca **todas as páginas** (até 50 × 100 registros) antes de renderizar qualquer coisa. | Alto | Paginação servida + primeira página renderizada imediatamente | ALTO |
| P-85 | `PlayersPage.tsx:165`, `MatchDetailPage.tsx:699`, `WaitlistPanel.tsx:147` | `Avatar src={player.photo}` aponta direto para o `ImageField` do Django — **sem miniatura**. Uma foto de 3MB tirada no celular é baixada em tamanho original em cada linha da lista. | Alto | Geração de thumbnail no backend (ou `loading="lazy"` + `srcset` como paliativo) | ALTO |
| P-86 | `PlayerToken.tsx`, `FootballPitch.tsx` | Sem `React.memo`. Cada movimento de arrasto re-renderiza todos os campos de todos os times. | Médio | `memo` + `useMemo` no layout | MÉDIO |
| P-87 | `frontend/vite.config.ts` | Build sem `manualChunks`, sem análise de bundle, sem compressão. | Médio | `rollupOptions.output.manualChunks` (vendor/mui/charts) | MÉDIO |
| P-88 | `frontend/Dockerfile` | A imagem roda `npm run dev` (servidor de desenvolvimento Vite). **Não existe build de produção.** | Alto — não há caminho de deploy | Dockerfile multi-stage: `npm ci && npm run build` → nginx/caddy servindo estático com cache | ALTO |
| P-89 | `frontend/public/icons.svg` | Arquivo de template não referenciado (ícones de bluesky/discord/github/x) publicado no `public/`. | Baixo | Remover | BAIXO |

### 3.J PWA — 3 problemas

| ID | Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-90 | `frontend/index.html` | **Não existe manifest.** O app não é instalável ("Adicionar à tela de início" não cria um app real). | Médio — requisito 27 | `manifest.webmanifest` (§16) | MÉDIO |
| P-91 | `frontend/public/` | Sem `apple-touch-icon`, sem ícones 192/512 nem maskable. | Médio | Conjunto de ícones a partir do `favicon.svg` | MÉDIO |
| P-92 | — | Sem service worker. (Nota: **offline não é objetivo** — ver §16.) | Baixo | SW apenas de app-shell, sem cache de dados de negócio | BAIXO |

### 3.K Backend, API e Banco — 7 problemas

| ID | Arquivo | Problema | Impacto | Solução proposta | Prioridade |
|---|---|---|---|---|---|
| P-93 | `apps/draws/models.py` | **Não existe formação.** `Draw` não tem campo de formação, `Team` não tem, `TeamPlayer` não tem `line_index`/`slot_index`. A posição no campo é derivada em tempo de render pelo `sort_order`. | Alto — bloqueia requisitos 12–15 | 3 campos novos + migration (§20) | **CRÍTICO** |
| P-94 | `apps/draws/services.py:251-296` | `move_player_to_team` é a **única** operação de edição pós-sorteio. Não existe alterar posição, não existe trocar dois jogadores. A troca hoje exigiria 2 chamadas sequenciais **não atômicas** — se a segunda falhar, os times ficam inconsistentes e a auditoria registra meia operação. | Alto — requisitos 15/17 | `change_player_position` e `swap_players` transacionais (§19) | **CRÍTICO** |
| P-95 | `apps/audit/models.py:11-36` | `AuditLog.Action` não tem ações para mudança de posição, troca de jogadores nem alteração de formação. `move_player_to_team` grava `before`/`after` só com time. | Alto — requisito 24 | 3 ações novas + payload com posição (§14) | ALTO |
| P-96 | `apps/draws/serializers.py:91-117` | `DrawSerializer` não expõe `score_weakest_split` nem `score_guest_balance` (só existem no payload da auditoria). A tela não consegue mostrar o relatório completo de equilíbrio. | Baixo | Expor como campos calculados ou colunas | BAIXO |
| P-97 | `apps/matches/views.py:436-443` | `POST /api/matches/{id}/draw/` **não aceita nenhum parâmetro**. Não há como pedir uma formação, um número de times diferente, ou pesos diferentes na hora do sorteio. | Alto — requisito 11 | Corpo opcional com `formation`, `formations_by_team` (§21) | ALTO |
| P-98 | `apps/draws/domain/scoring.py:9-21` | `ScoringWeights` fixo em código (já documentado como não implementado em `REGRAS_DE_NEGOCIO.md` §13). | Médio | Fora do escopo desta fase; registrar como dívida | BAIXO |
| P-99 | `apps/matches/views.py:264` | `roster` retorna **todos** os jogadores ativos sem paginação, um `PlayerSerializer` por jogador (já registrado em `PLANO_IMPLEMENTACAO.md` §2.2). | Médio | Serializer enxuto para o roster | MÉDIO |

---

## 4. Melhorias Mobile First

### Princípio

**A tela de 375px é a tela de projeto.** Cada componente é escrito para caber nela e recebe *progressive enhancement* para cima, nunca o contrário. Concretamente: nenhum `sx` novo deve começar por um valor de desktop e "consertar" no `xs`; o valor base é o mobile.

```
❌ sx={{ display: "flex", flexDirection: { xs: "column" } }}     // desktop-first
✅ sx={{ display: "flex", flexDirection: { xs: "column", md: "row" } }}  // base = mobile
```

### Breakpoints

**Decisão: manter os breakpoints padrão do MUI.** Alterá-los reescreveria o significado de todos os `{ xs, sm, md }` já espalhados por ~30 arquivos, com risco de regressão silenciosa e sem ganho real. O que muda é a **semântica documentada**:

| Alias | MUI | px | Dispositivo alvo |
|---|---|---|---|
| `xs` | `xs` | 0–599 | Celular (320 / 375 / 390 / 414) |
| `sm` | `sm` | 600–899 | Celular grande deitado / tablet pequeno |
| `md` | `md` | 900–1199 | Tablet grande / notebook |
| `lg` | `lg` | 1200–1535 | Desktop |
| `xl` | `xl` | 1536+ | Desktop grande / 4K |

Corte de layout principal: **`md`** (o mesmo que o `AppLayout` já usa para trocar abas por drawer).

### Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-001 | `shared/theme/ColorModeContext.tsx` | Documentar os breakpoints acima em comentário no tema e exportar `BREAKPOINT_INTENT` para uso em testes de responsividade. | Baixo | ALTA |
| A-002 | `shared/theme/ColorModeContext.tsx` | `MuiTextField.defaultProps.size` deixa de ser `"small"` global; passa a `"medium"` e o `small` é aplicado explicitamente em `md+` via `styleOverrides` responsivo. Corrige P-54. | **Alto — muda a altura de todos os campos do sistema** | **CRÍTICA** |
| A-003 | `shared/theme/ColorModeContext.tsx` | `MuiButton`/`MuiIconButton`: `minHeight: 44` e `minWidth: 44` abaixo de `md`. Corrige P-15, P-55. | Alto | **CRÍTICA** |
| A-004 | `shared/layout/AppLayout.tsx` | `AppBar` → `position="sticky"` com `top: 0` e `zIndex` acima do conteúdo. Corrige P-01. | Médio | **CRÍTICA** |
| A-005 | `shared/layout/AppLayout.tsx` | Envolver `children` em `Container maxWidth="lg"` com `disableGutters` abaixo de `sm`; padding `{ xs: 2, sm: 3 }` preservado. Corrige P-07. | Baixo | MÉDIA |
| A-006 | `frontend/index.html` | `<html lang="pt-BR">`; adicionar `<meta name="theme-color">` (light/dark) e `<meta name="color-scheme" content="light dark">`. Corrige P-70, P-67. | Baixo | ALTA |
| A-007 | `frontend/src/index.css` | Adicionar `:root { color-scheme: light dark; }`, `body { overscroll-behavior-y: contain; -webkit-tap-highlight-color: transparent; }` e utilitário `.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }`. | Baixo | ALTA |
| A-008 | `frontend/index.html` | `viewport` com `viewport-fit=cover` para que `env(safe-area-inset-*)` funcione em iPhone com notch. | Baixo | MÉDIA |

---

## 5. Melhorias de UX/UI

### 5.1 Dashboard mobile (requisito 9)

Hierarquia proposta, de cima para baixo, no celular:

```
┌──────────────────────────────────┐
│ HOJE                             │  ← só aparece se houver partida hoje
│ ⚽ Pelada de Quinta · 21:00       │
│ 👥 14/18 · sorteio às 20:00      │
│ [ Abrir partida ]                │
├──────────────────────────────────┤
│ PRÓXIMO SORTEIO                  │  ← card-herói (quando não há partida hoje)
│ Sábado, 15/08 às 09:00           │
│ 📍 Quadra do Centro              │
│ ▓▓▓▓▓▓▓░░░ 12 de 18 confirmados  │
│ [ Confirmar presença ]           │
├──────────────────────────────────┤
│ PENDÊNCIAS                       │
│ ⚠️ Sorteio automático travado:    │
│    faltam 3 confirmados          │
│ ⏳ 2 na lista de espera           │
├──────────────────────────────────┤
│ JOGADORES   ·   FINANCEIRO       │  ← 2 colunas compactas
│ 24 ativos       R$ 1.240 aberto  │
│ 18 mensalistas  R$ 340 despesas  │
└──────────────────────────────────┘
```

Em `md+`, os mesmos blocos viram um grid de 3 colunas com o card-herói ocupando 2.

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-009 | `features/dashboard/DashboardPage.tsx` | Reescrever com a hierarquia acima; substituir os 6 cards uniformes. Corrige P-43, P-44, P-45, P-46. | Alto | **CRÍTICA** |
| A-010 | `features/dashboard/NextMatchHeroCard.tsx` *(novo)* | Card-herói: data/hora/local, barra de ocupação, chip de sorteio automático, card inteiro clicável, ação primária. | Médio | **CRÍTICA** |
| A-011 | `features/dashboard/PendingTasksCard.tsx` *(novo)* | Bloco de pendências alimentado por `automatic_draw_blocked_reason`, `waitlist_count` e divergências. | Médio | ALTA |
| A-012 | `backend/apps/matches/dashboard_views.py` + `serializers.py` | Estender `DashboardSummary` com: partida de hoje, pendências e resumo financeiro da competência corrente (respeitando `financial.view` — quem não pode ver dinheiro não recebe o bloco). | Médio | ALTA |

### 5.2 Módulo de jogadores (requisito 10)

Card mobile proposto:

```
┌──────────────────────────────────┐
│ (BA)  Bruno Amoedo               │
│       "Barba" · ★★★★☆            │
│       Meio-Campo · Mensalista    │
│                            [ ⋮ ] │
└──────────────────────────────────┘
```

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-013 | `shared/components/DataTable.tsx` | Nova prop opcional `renderCard?: (row: T) => ReactNode`. Quando presente e a viewport for `< md`, a tabela renderiza uma lista de cards (mantendo ordenação, seleção, loading, erro, vazio e paginação). **Sem `renderCard`, o comportamento atual é preservado byte a byte.** Corrige P-10. | Alto — componente usado por 6 telas | **CRÍTICA** |
| A-014 | `features/players/PlayerCard.tsx` *(novo)* | Card do jogador conforme acima, com menu de overflow (Editar/Remover). Corrige P-12, P-15, P-49. | Médio | **CRÍTICA** |
| A-015 | `features/matches/MatchCard.tsx` *(novo)* | Card da partida: nome, data/hora, ocupação, status, divergência, menu ⋮. | Médio | ALTA |
| A-016 | `features/finance/ChargeCard.tsx` *(novo)* | Card de mensalidade: jogador, competência, valor, vencimento, status, ação "Dar baixa". | Médio | ALTA |
| A-017 | `features/statistics/PlayerStatsCard.tsx` *(novo)* | Card com 4 métricas principais (jogos, vitórias, aproveitamento, sequência) + "ver tudo" expansível. Corrige P-11. | Médio | ALTA |
| A-018 | `features/audit/AuditEntryCard.tsx` *(novo)* | Card de auditoria com data/hora, ação, quem, alvo e detalhe expansível formatando `before`/`after`. Corrige P-13. | Médio | ALTA |
| A-019 | `features/members/MemberCard.tsx` *(novo)* | Card de pessoa/perfil. | Baixo | MÉDIA |
| A-020 | `features/players/PlayersPage.tsx` | Barra de ação em lote passa a ser flutuante fixa no rodapé enquanto houver seleção. Corrige P-47. | Baixo | MÉDIA |

---

## 6. Design System

### 6.1 Cores

Tokens propostos (`src/shared/theme/tokens.ts`, **arquivo novo**), consumidos pelo `createTheme`:

| Token | Light | Dark | Uso |
|---|---|---|---|
| `primary` | `#1e8e3e` | `#4caf6f` | Ação principal, identidade |
| `primaryText` | `#146c2e` | `#7fd39b` | Texto/ícone primário sobre fundo claro (contraste AA) |
| `secondary` | `#1565c0` | `#64b5f6` | Ação secundária, links |
| `success` | `#1e8e3e` | `#4caf6f` | Confirmado, pago, vitória |
| `warning` | `#ed6c02` | `#ffb74d` | Espera, pendente, atenção |
| `danger` | `#d32f2f` | `#ef5350` | Erro, remover, convidado, derrota |
| `info` | `#0288d1` | `#4fc3f7` | Avisos neutros |
| `background` | `#f6f7f9` | `#0f1115` | Fundo da aplicação |
| `surface` | `#ffffff` | `#171a21` | Card, papel, drawer |
| `surfaceVariant` | `#fafbfc` | `#1b1e26` | Cabeçalho de tabela, faixas |
| `text` | `#0f172a` | `#e6e8ec` | Texto principal |
| `muted` | `#64748b` | `#94a3b8` | Texto auxiliar |
| `border` | `rgba(15,23,42,.08)` | `rgba(255,255,255,.10)` | Divisores, contornos |
| `focus` | `#1565c0` | `#64b5f6` | Anel de foco (2px + 2px offset) |
| `pitchGrass` / `pitchStripe` / `pitchLine` | — | — | Campo (migrados de `FootballPitch.tsx`) |
| `team[0..8]` | — | — | Identidade dos times (migrados de `shareFormat.ts`) |

> **Verificação obrigatória**: todo par texto/fundo deve atingir **4,5:1** (texto normal) ou **3:1** (texto ≥ 18,66px bold / componentes de UI). O par atual `#1e8e3e` + branco (≈3,6:1) reprova e é o item P-75.

### 6.2 Tipografia

Fonte: **Inter** (já configurada). Nota: a família é declarada no tema mas **não é carregada** — não há `@font-face`, `<link>` para Google Fonts nem pacote `@fontsource`. Hoje o sistema cai no fallback (`-apple-system`/`Segoe UI`/`Roboto`). Decisão proposta: **auto-hospedar via `@fontsource-variable/inter`** (evita requisição a domínio externo e o *layout shift* de fonte).

| Papel | Variante | Mobile | Desktop | Peso |
|---|---|---|---|---|
| Título de página | `h1` | 24px | 30px | 700 |
| Título de seção | `h2` | 20px | 24px | 700 |
| Título de card | `h3` | 17px | 18px | 700 |
| Subtítulo | `subtitle1` | 15px | 16px | 600 |
| Corpo | `body1` | 15px | 16px | 400 |
| Corpo compacto | `body2` | 14px | 14px | 400 |
| Rótulo / label | `overline` | 12px | 12px | 600, `letter-spacing .04em` |
| Auxiliar | `caption` | 12px | 12px | 400, cor `muted` |
| Botão | `button` | 15px | 15px | 600, sem `text-transform` |

Escala fluida com `clamp()` para `h1`–`h3`. **Nunca abaixo de 12px** e nunca `body` abaixo de 14px.

### 6.3 Espaçamento, raio e elevação

- Unidade base **8px** (MUI padrão, já em uso). Escala permitida: `0.5, 1, 1.5, 2, 3, 4, 6, 8`. Sem valores mágicos em `px`.
- Raio: `sm: 8` (botão, input, chip) · `md: 12` (padrão) · `lg: 16` (card, dialog) · `full: 999` (avatar, pill).
- Elevação: **duas escalas** (clara e escura) — a atual serve ao tema claro; a escura precisa de sombras mais opacas + borda sutil. Corrige P-61.

### 6.4 Inventário de componentes

| Componente | Hoje | Ação |
|---|---|---|
| `Button` | override de tema | Estender: tamanho mínimo de toque, variantes documentadas |
| `Input` / `Select` | `MuiTextField` `size:small` global | **Alterar** (A-002) |
| `Checkbox` / `Radio` | MUI cru | Padronizar com rótulo e alvo de 44px |
| `Switch` | MUI cru (`MatchDetailPage`) | Padronizar com rótulo acessível |
| `Card` | override de tema | OK |
| `Modal` / `Dialog` | `ConfirmDialog` + 5 diálogos soltos | Padronizar `fullScreen` abaixo de `sm` |
| `Drawer` | `FormDrawer` | Cabeçalho/rodapé fixos |
| `BottomSheet` | **não existe** | **Criar** |
| `Badge` / `Chip` | `StatusChip` | OK — estender com tom `info` |
| `Toast` | `ToastProvider` | Ajustar ancoragem e duração |
| `Tabs` | MUI cru (`FinancePage`, `AppLayout`) | Padronizar (scrollable no mobile) |
| `Dropdown` / menu ⋮ | **não existe** | **Criar** (`OverflowMenu`) |
| `Avatar` | MUI cru, 3 usos diferentes | Padronizar (`PlayerAvatar` com iniciais e lazy) |
| `EmptyState` | **não existe** | **Criar** |
| `Loading` | `CircularProgress` solto | Padronizar |
| `Skeleton` | só dentro do `DataTable` | **Criar** `PageSkeleton` |

### 6.5 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-021 | `shared/theme/tokens.ts` *(novo)* | Tokens de cor (§6.1), raio, espaçamento e elevação por modo. | Médio | **CRÍTICA** |
| A-022 | `shared/theme/ColorModeContext.tsx` | Consumir `tokens.ts`; adicionar `surface`, `surfaceVariant`, `muted`, `border`, `focus`, `team[]`, `pitch*` à paleta. Corrige P-59. | Alto | **CRÍTICA** |
| A-023 | `shared/theme/ColorModeContext.tsx` | Escala tipográfica completa `h1`–`h6` com `clamp()`. Corrige P-60. | Médio | ALTA |
| A-024 | `shared/theme/ColorModeContext.tsx` | Duas escalas de sombra (clara/escura). Corrige P-61. | Baixo | MÉDIA |
| A-025 | `shared/theme/ColorModeContext.tsx` | Estado inicial do modo respeita `window.matchMedia("(prefers-color-scheme: dark)")` quando não há preferência salva. Corrige P-66. | Baixo | MÉDIA |
| A-026 | `shared/theme/ColorModeContext.tsx` | Override global de `:focus-visible` com o token `focus`. Corrige P-77. | Baixo | MÉDIA |
| A-027 | `shared/theme/ColorModeContext.tsx` | Ajustar `primary` para atingir contraste AA em botões preenchidos. Corrige P-75. **Requer validação visual com o usuário** (muda a cor de identidade). | Alto — visual | ALTA |
| A-028 | `shared/icons/index.ts` *(novo)* | Mapa central `AppIcons` (`draw`, `players`, `agenda`, `finance`, `org`, `reports`, `audit`, `settings`, `confirm`, `decline`, `share`, `copy`, `whatsapp`, `swap`, `position`, `formation`…) apontando para `@mui/icons-material`. Corrige P-62. | Médio | ALTA |
| A-029 | vários (`MatchDetailPage`, `PlayersPage`, `FinancePage`, `RecurringGamesPage`, `WaitlistPanel`) | Substituir emojis de **ação** por ícones do mapa. **Preservar** os emojis que são conteúdo: mensagem do WhatsApp (`shareFormat.ts`) e identidade dos times (🔵🔴🟠…). | Médio | ALTA |
| A-030 | `features/matches/shareFormat.ts` | `TEAM_COLORS` passa a ler do tema (mantendo os mesmos valores em modo claro). Corrige P-63. | Baixo | MÉDIA |
| A-031 | `features/matches/FootballPitch.tsx`, `PlayerToken.tsx` | Cores hardcoded → tokens. Corrige P-64, P-65. | Baixo | MÉDIA |
| A-032 | `shared/components/StatusChip.tsx` | Adicionar variante com ícone e tom `info`; garantir que todo estado tenha **texto**, nunca só cor. Corrige P-39 parcialmente. | Baixo | MÉDIA |
| A-033 | `frontend/package.json` | Adicionar `@fontsource-variable/inter` e importar em `main.tsx`. | Baixo | MÉDIA |
| A-034 | `docs/DESIGN_SYSTEM.md` *(novo)* | Documento vivo do DS: tokens, componentes, regras de uso, do/don't. | Baixo | MÉDIA |

---

## 7. Menu Hamburger

### 7.1 Desenho proposto (mobile)

```
┌────────────────────────────────┐
│  ⚽  Pelada da Quinta       [×] │ ← organização atual (trocável)
│      Bruno · Administrador      │
├────────────────────────────────┤
│  🏠  Início                     │
│  ⚽  Sorteios / Partidas    ●   │ ← ● = badge (partida hoje)
│  👥  Jogadores                  │
│  📅  Jogos Recorrentes          │
│  💰  Financeiro                 │
│  🏢  Pessoas e Perfis           │
│  📊  Estatísticas               │
│  📋  Auditoria                  │
│  ⚙️  Sistema                    │ ← só superadmin
├────────────────────────────────┤
│  🌙  Tema escuro          [ ⬤] │ ← rodapé, zona do polegar
│  🔄  Trocar organização         │
│  🚪  Sair                       │
└────────────────────────────────┘
```

Regras:
- Ícones de **uma biblioteca só** (`@mui/icons-material`, já instalada) — os emojis acima são apenas ilustrativos do documento.
- Ícone **nunca substitui o texto**: os dois sempre juntos (requisito 5).
- Ícone com `fontSize="small"` (20px), `aria-hidden`, alinhado a 12px do texto, largura de coluna fixa (32px) para o texto alinhar verticalmente.
- Estado ativo: fundo `primary` com 12% de opacidade + barra de 3px à esquerda + ícone e texto em `primary` + `aria-current="page"`.
- Item com altura mínima **48px**.
- Navegação primária adicional: **barra inferior fixa** com as 4 rotas mais usadas do papel (ex.: Início · Partidas · Jogadores · Financeiro) + botão "Mais" que abre o drawer. É o que resolve a zona do polegar de verdade.
- Modo claro/escuro: ícones usam `currentColor`, nunca cor fixa.

### 7.2 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-035 | `shared/layout/navItems.ts` *(novo)* | Extrair `NAV_ITEMS` de `AppLayout.tsx` para um módulo com `{ key, label, path, icon, roles, showInBottomBar }`. Fonte única para drawer, abas e barra inferior. | Baixo | ALTA |
| A-036 | `shared/layout/AppDrawer.tsx` *(novo)* | Drawer redesenhado conforme §7.1: cabeçalho com organização + papel, lista com ícones, rodapé com tema/trocar org/sair. Corrige P-03, P-06. | Médio | **CRÍTICA** |
| A-037 | `shared/layout/BottomNav.tsx` *(novo)* | `BottomNavigation` fixa abaixo de `md`, com `safe-area-inset-bottom`, 4 itens + "Mais". | Médio | **CRÍTICA** |
| A-038 | `shared/layout/AppLayout.tsx` | Corrigir o item ativo do drawer para usar a mesma lógica de prefixo das abas (extrair `resolveActivePath`). Corrige P-02. | Baixo | ALTA |
| A-039 | `shared/layout/AppLayout.tsx` | `<Tabs variant="scrollable" allowScrollButtonsMobile>` com ícone + rótulo. Corrige P-04. | Baixo | ALTA |
| A-040 | `shared/layout/AppLayout.tsx` | Nome da organização sempre visível (truncado com `noWrap` no mobile). Corrige P-05. | Baixo | ALTA |
| A-041 | `shared/layout/AppLayout.tsx` | Landmarks semânticos (`header`/`nav`/`main`) + skip-link. Corrige P-08. | Baixo | MÉDIA |
| A-042 | `shared/layout/AppDrawer.tsx` | Contraste e estado ativo validados nos dois temas; `aria-current="page"` no item ativo. | Baixo | ALTA |
| A-043 | `shared/layout/AppLayout.tsx` | Reservar `padding-bottom` equivalente à altura da `BottomNav` para o conteúdo não ficar coberto. | Baixo | ALTA |

---

## 8. Sorteio

### 8.1 O fluxo proposto

```
1. CONFIGURAR          2. SORTEAR             3. AJUSTAR            4. COMPARTILHAR
   ├ times                ├ animação             ├ trocar posição      ├ copiar WhatsApp
   ├ formação/time        ├ scroll p/ resultado   ├ trocar jogadores    ├ enviar
   └ regras               └ chip de origem        └ mover entre times   └ exportar PNG
                                                     ↓
                                                  AUDITORIA
```

**A etapa 1 não existe hoje** — o sorteio dispara direto do botão, usando a configuração da partida.

### 8.2 Tela de configuração do sorteio (novo)

Bottom sheet aberto pelo botão "Sortear", com o resumo do que será feito **antes** de executar:

```
┌────────────────────────────────┐
│  Configurar sorteio         [×]│
├────────────────────────────────┤
│  Times                         │
│    [ − ]   3   [ + ]           │
│                                │
│  Confirmados: 18 (6 por time)  │
│  Goleiro fixo (não sorteado)   │
│                                │
│  Formação                      │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │2-2-2 │ │3-1-2 │ │2-3-1 │    │
│  │  ●   │ │      │ │      │    │
│  └──────┘ └──────┘ └──────┘    │
│  [ Formação por time ▾ ]       │
│                                │
│  Regras aplicadas              │
│  ✓ Piores separados            │
│  ✓ Convidados distribuídos     │
│  ✓ Evita repetir duplas (10)   │
│  ✓ Equilíbrio de nível         │
│                                │
│  [      🎲 Sortear times     ] │
└────────────────────────────────┘
```

Notas de projeto:
- "Times" edita a configuração **da partida** (`teams_count`) — deve deixar claro que a mudança persiste e recalcula a capacidade/fila (a regra de `compute_match_capacity` já existe).
- "Regras aplicadas" é **informativo, não editável** nesta fase — os pesos continuam fixos (P-98). Serve para o organizador entender o que o sistema garante (requisito 18).
- Quando `capacity.goalkeepers_per_team > 0`, a formação exclui o goleiro da notação e o campo desenha a linha de goleiro separadamente.

### 8.3 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-044 | `features/matches/DrawSetupSheet.tsx` *(novo)* | Bottom sheet de configuração (§8.2). | Alto | **CRÍTICA** |
| A-045 | `features/matches/MatchDetailPage.tsx` | O botão de sorteio abre o sheet em vez de disparar direto; "Sortear novamente" reabre o sheet com a formação anterior pré-selecionada (requisito 20). | Médio | **CRÍTICA** |
| A-046 | `features/matches/MatchActionBar.tsx` *(novo)* | Barra de ação fixa no rodapé (acima da `BottomNav`) com a ação primária contextual: "Sortear times" → "Sortear novamente" → "Lançar placar". Corrige P-19. | Alto | **CRÍTICA** |
| A-047 | `features/matches/MatchDetailPage.tsx` | Motivo de bloqueio do sorteio como **texto visível** ("Faltam 3 confirmados para o mínimo de 18"), nunca só tooltip. Corrige P-20, P-71. | Baixo | **CRÍTICA** |
| A-048 | `features/matches/MatchHeaderCard.tsx` *(novo, extraído de `MatchDetailPage.tsx:471-582`)* | Resumo em 2 linhas + detalhes expansíveis; métricas como chips. Corrige P-24, P-33. | Médio | ALTA |
| A-049 | `features/matches/PresencePanel.tsx` *(novo, extraído de `MatchDetailPage.tsx:595-725`)* | Busca + filtro por status + contador sticky + ordem estável. Corrige P-21, P-22, P-23, P-33. | Médio | ALTA |
| A-050 | `features/matches/DrawResultSection.tsx` *(novo, extraído de `MatchDetailPage.tsx:749-857`)* | Resultado, cards de time, observações e compartilhamento. Corrige P-33. | Médio | ALTA |
| A-051 | `features/matches/useMatchDraw.ts` *(novo)* | Hook com as mutations do sorteio (sortear, mover, trocar posição, trocar jogadores) e o *optimistic update* via `useDrawCachePatch`. | Médio | ALTA |
| A-052 | `features/matches/DrawResultSection.tsx` | Score cru substituído por indicador qualitativo com detalhe técnico opcional. Corrige P-27. | Baixo | MÉDIA |
| A-053 | `features/matches/MatchDetailPage.tsx:385-388` | Manter o *scroll* automático para o resultado (requisito 21 — **já existe e funciona**), ajustando o offset para compensar a `AppBar` sticky e a barra de ação. | Baixo | ALTA |
| A-054 | `features/matches/DrawResultSection.tsx` | Grid de times sem separador flex órfão; cards empilham no mobile e vão a 2/3 colunas em `md+`. Corrige P-26. | Baixo | MÉDIA |
| A-055 | `features/matches/DrawShuffleOverlay.tsx` | Respeitar `prefers-reduced-motion` (sem animação, só progresso). | Baixo | MÉDIA |

---

## 9. Formações

### 9.1 Modelo conceitual

**Uma formação é uma lista ordenada de tamanhos de linha, da defesa para o ataque, contando apenas jogadores de linha.**

```
"2-2-2"  →  lines = [2, 2, 2]  →  6 jogadores de linha
"3-2-1-1" → lines = [3, 2, 1, 1] → 7 jogadores de linha
```

O **goleiro não entra na notação** (convenção do futebol brasileiro e coerente com `goalkeepers_per_team`, que já é configuração separada da partida). Quando `goalkeepers_per_team > 0`, o campo desenha uma linha de goleiro abaixo da primeira linha da formação.

### 9.2 Geração do catálogo de formações válidas

Função pura `generateFormations(linePlayers, options)` — **sem posições fixas**, exatamente como o requisito pede:

```
Entrada:  L = jogadores de linha por time
Regras:
  k (número de linhas) ∈ [2, kMax], onde kMax = 3 se L ≤ 6, senão 4
  cada linha ≥ 1
  cada linha ≤ min(4, ceil(L / 2))
  soma das linhas = L
Saída:    todas as composições ordenadas por "equilíbrio" (menor variância primeiro)
```

Resultados dessa regra (conferidos contra os exemplos do pedido):

| L | Formações geradas | Exemplos do pedido cobertos |
|---|---|---|
| 4 | `2-2`, `1-2-1`, `2-1-1`, `1-1-2` | — |
| 5 | `2-3`, `3-2`, `1-2-2`, `2-1-2`, `2-2-1`, `1-3-1`, `1-1-3`, `3-1-1` | ✅ `2-1-2`, `1-2-2`, `2-2-1`, `1-3-1` |
| 6 | `3-3`, `2-2-2`, `1-2-3`, `1-3-2`, `2-1-3`, `2-3-1`, `3-1-2`, `3-2-1` | ✅ `2-2-2`, `3-1-2`, `2-3-1`, `3-2-1`, `1-3-2` |
| 7 | `3-4`/`4-3`, `2-2-3`, `2-3-2`, `3-2-2`, `1-3-3`, `3-3-1`, `2-2-2-1`, `3-2-1-1`, `2-3-1-1`, `3-1-2-1`, … | ✅ `3-2-1-1`, `2-3-1-1`, `3-1-2-1`, `2-2-2-1` |
| 8 | `4-4`, `3-3-2`, `2-3-3`, `3-2-3`, `2-2-2-2`, `3-2-2-1`, … | — |

A interface mostra as **6 mais equilibradas** como cards e as demais atrás de "ver todas".

### 9.3 Mapeamento formação → posições da organização

Este é o ponto delicado: a organização tem N posições cadastradas (`Position`, com `sort_order`), e a formação pode ter mais linhas do que posições de linha existentes (ex.: 4 linhas com apenas ZAG/ME/AT).

**Regra proposta** — a linha `i` de `k` linhas mapeia para a posição de linha de índice:

```
posIndex = round( i * (P - 1) / (k - 1) )      // P = nº de posições de linha (sem goleiro)
```

Exemplo com `P = 3` (ZAG, ME, AT) e `k = 4` (`3-1-2-1`):

| Linha | i | posIndex | Posição |
|---|---|---|---|
| 1ª (3 jogadores) | 0 | 0 | ZAG |
| 2ª (1 jogador) | 1 | 1 | ME |
| 3ª (2 jogadores) | 2 | 1 | ME |
| 4ª (1 jogador) | 3 | 2 | AT |

Duas linhas podem compartilhar a mesma posição — é o comportamento desejado ("não assumir que uma formação precisa ter apenas zagueiros, meias e atacantes"). O **desenho** continua com 4 linhas distintas porque o `line_index` é gravado separadamente da posição.

### 9.4 Atribuição de jogadores aos slots

Depois que o algoritmo distribui os jogadores entre os times (**sem alteração**), cada time recebe a formação e os jogadores são encaixados nos slots minimizando o custo:

```
custo(jogador, slot) =
    0   se a posição do slot == posição principal do jogador
    1   se == posição secundária
    2 + |sort_order(slot) − sort_order(principal)|   caso contrário
```

Com no máximo ~12 jogadores por time, uma atribuição ótima é barata (Hungarian ou busca exaustiva por grupo de posição). O jogador colocado na secundária tem `used_secondary_position=True`, exatamente como hoje.

**Consequência importante e a documentar para o usuário:** a formação **não** altera quem joga com quem (isso é do algoritmo); ela altera **onde cada um é desenhado e qual posição é registrada**. Se a formação pedir 3 zagueiros e o time só tiver 1, dois jogadores serão desenhados na linha de defesa fora da posição natural — e isso será sinalizado na tela.

### 9.5 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-056 | `backend/apps/draws/domain/formations.py` *(novo)* | Módulo puro (sem Django, como o resto de `domain/`): `generate_formations`, `parse_formation`, `format_formation`, `map_lines_to_positions`, `assign_players_to_slots`. | Alto | **CRÍTICA** |
| A-057 | `backend/apps/draws/services.py` | `execute_draw` passa a aceitar `formation` e `formations_by_team`; após montar os times, chama `assign_players_to_slots` e grava `line_index`/`slot_index` no `TeamPlayer`. **Sem formação informada, o comportamento atual é preservado** (`line_index=None` → o campo desenha pelo `sort_order`, como hoje). | Alto | **CRÍTICA** |
| A-058 | `backend/apps/draws/serializers.py` | Expor `formation` em `TeamSerializer`/`DrawSerializer` e `line_index`/`slot_index` em `TeamPlayerSerializer`. | Baixo | **CRÍTICA** |
| A-059 | `frontend/src/core/formations.ts` *(novo)* | Espelho TypeScript de `generate_formations` para a interface montar as opções sem ida ao servidor (o servidor continua sendo a autoridade na validação). | Médio | ALTA |
| A-060 | `frontend/src/features/matches/FormationPicker.tsx` *(novo)* | Seleção visual: radio cards com miniatura do campo desenhada em SVG, rolagem horizontal no mobile, alvo de 44px, `role="radiogroup"`. | Médio | **CRÍTICA** |
| A-061 | `frontend/src/features/matches/FormationPerTeamSheet.tsx` *(novo)* | Formação individual por time (requisito 12), a partir do padrão escolhido. | Médio | ALTA |
| A-062 | `frontend/src/core/types/draw.ts` | Tipos `Formation`, `formation` em `Team`, `line_index`/`slot_index` em `TeamPlayer`. | Baixo | **CRÍTICA** |
| A-063 | `features/matches/shareFormat.ts` | Incluir a formação e a posição de cada jogador no texto do WhatsApp (requisito 22). Corrige P-29. | Baixo | ALTA |

Formato proposto do texto (requisito 22):

```
⚽🔥 SORTEIO DOS TIMES 🔥⚽

🏆 Time 1 🔵 — 2-2-2:
👤 João (ZAG)
👤 Carlos (ZAG)
👤 Pedro (ME)
...

🆚

🏆 Time 2 🔴 — 3-1-2:
...

⚽ Boa partida! 🔥
```

---

## 10. Campo SVG

### 10.1 Problemas de desenho a resolver

1. `maxWidth: 240` desperdiça a largura do celular (P-34).
2. Nomes se sobrepõem em linhas de 4+ jogadores (P-35).
3. As linhas vêm da posição cadastrada, não da formação (P-36).
4. `role="img"` esconde os jogadores do leitor de tela (P-38).
5. Exportação em baixa resolução no mobile (P-41).

### 10.2 Desenho proposto

```
viewBox: 0 0 120 170      (era 100 140 — mais largura relativa para os nomes)

y = 8    ┌──────────────┐   linha de ataque (última da formação)
         │      AT      │
y = 45   │   ME    ME   │   linhas intermediárias
y = 82   │  ZAG ZAG ZAG │
y = 125  │      GOL     │   linha de goleiro (só se goalkeepers_per_team > 0)
y = 160  └──────╥───────┘   gol
```

Regras de layout (todas em `core/fieldLayout.ts`, que continua **puro e sem DOM**):

```ts
computeFieldLayout(players, { lines, hasGoalkeeperLine })
// lines: number[] vindo da formação; quando ausente, cai no
// agrupamento por sort_order atual (compatibilidade retroativa)
```

- `y` das linhas: distribuído entre `TOP_MARGIN` e `BOTTOM_MARGIN`, reservando a faixa do goleiro quando houver.
- `x`: `((i + 1) / (n + 1)) * 100`, **mais deslocamento vertical alternado** de ±3 unidades quando `n ≥ 4`, para os nomes não colidirem.
- Tamanho de fonte por linha: `nameSize = clamp(2.8, 4.4 - 0.35 * (n - 2), 4.4)`.
- Truncamento por linha: `maxChars = n <= 2 ? 12 : n === 3 ? 10 : n === 4 ? 8 : 7`.
- Convidado: além do vermelho, **anel tracejado** ao redor do círculo (P-39).

### 10.3 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-064 | `core/fieldLayout.ts` | Nova assinatura com `lines`/`hasGoalkeeperLine`, deslocamento alternado, tamanho de fonte e truncamento calculados por linha. Mantém o caminho antigo quando não há formação. Corrige P-35, P-36, P-40. | Alto | **CRÍTICA** |
| A-065 | `features/matches/FootballPitch.tsx` | `viewBox` 120×170, campo fluido (`width: 100%`; `maxWidth` só em `md+`), marcações revistas coerentes com um gol. Corrige P-34, P-37. | Alto | **CRÍTICA** |
| A-066 | `features/matches/FootballPitch.tsx` | `role="img"` → `role="group"` + `aria-label`; a escalação em lista (já existente em `TeamResultCard`) passa a ser a alternativa textual formal via `aria-describedby`. Corrige P-38, P-73. | Baixo | ALTA |
| A-067 | `features/matches/PlayerToken.tsx` | Receber `nameSize`/`maxChars` do layout; anel tracejado para convidado; `React.memo`. Corrige P-39, P-40, P-86. | Médio | ALTA |
| A-068 | `features/matches/PitchFormationLabel.tsx` *(novo)* | Rótulo da formação desenhado **dentro** do SVG (canto superior), para aparecer na exportação PNG/SVG. | Baixo | MÉDIA |
| A-069 | `features/matches/exportUtils.ts` | `serializeSvg` deixa de depender de `getBoundingClientRect`: exporta em dimensão fixa de alta resolução (proposta: 1080×1530). Corrige P-41. | Médio | ALTA |
| A-070 | `features/matches/FootballPitch.tsx` | Área de drop (`useDroppable`) continua no `<svg>`, mas o destaque de "solte aqui" ganha rótulo textual, não só contorno. | Baixo | MÉDIA |
| A-071 | `features/matches/FootballPitch.tsx` | Suporte a **modo de seleção** (§12): quando há um jogador selecionado, cada slot vira alvo tocável com halo. | Alto | **CRÍTICA** |
| A-072 | `frontend/src/features/matches/FootballPitch.test.tsx` *(novo)* | Testes de layout: nenhuma sobreposição em linhas de 2 a 6, formação respeitada, linha de goleiro presente/ausente. | Baixo | ALTA |

---

## 11. Troca de Jogadores

Três operações distintas, hoje **inexistentes** exceto a primeira:

| Operação | Hoje | Proposto |
|---|---|---|
| Mover jogador entre times | ✅ `move_player_to_team` (só drag) | Mantido + acessível por toque/teclado |
| **Alterar a posição** de um jogador dentro do time | ❌ não existe | `change_player_position` |
| **Trocar dois jogadores** (mesma equipe ou entre equipes) | ❌ não existe | `swap_players` (atômica) |

### 11.1 Interação proposta (mobile)

```
Toque no jogador          →  entra em "modo de troca"
┌──────────────────────────────┐
│  João Silva · ME · ★★★☆☆     │
│                              │
│  [ Trocar de posição ]       │  → abre lista de posições/slots livres
│  [ Trocar com outro jogador ]│  → o próximo toque escolhe o alvo
│  [ Mover para outro time  ▾ ]│  → lista de times
│  [ Cancelar ]                │
└──────────────────────────────┘
```

Ao escolher "Trocar com outro jogador", os demais jogadores ficam realçados e o próximo toque conclui a troca — **duas ações, sem arrastar**, exatamente como o requisito 16 pede.

### 11.2 Regra de tamanho de time

Mover um jogador de A para B desequilibra o tamanho (7×5). Proposta: quando a movimentação quebrar a formação do time de destino (mais jogadores que slots), a interface **oferece a troca** em vez do movimento simples, e explica: *"O Time 2 já está completo (6/6). Escolha com quem João vai trocar."* O movimento simples continua permitido quando há vaga.

### 11.3 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-073 | `backend/apps/draws/services.py` | `change_player_position(draw, team_player_id, position_id, line_index, slot_index, reason)` — valida sorteio vigente (mesma trava de `move_player_to_team`), grava, audita. | Alto | **CRÍTICA** |
| A-074 | `backend/apps/draws/services.py` | `swap_players(draw, team_player_a_id, team_player_b_id, reason)` — **uma transação**, troca time+posição+slot dos dois, audita como um evento único. Corrige P-94. | Alto | **CRÍTICA** |
| A-075 | `backend/apps/draws/serializers.py` | `ChangePlayerPositionSerializer`, `SwapPlayersSerializer` (validando que ambos pertencem ao sorteio e à organização). | Baixo | **CRÍTICA** |
| A-076 | `backend/apps/draws/views.py` | Actions `set-position` e `swap-players` com `IsOrganizationOrganizerOrAdmin`. | Baixo | **CRÍTICA** |
| A-077 | `frontend/src/api/drawsApi.ts` | `setPlayerPosition`, `swapPlayers`. | Baixo | **CRÍTICA** |
| A-078 | `features/matches/PlayerActionSheet.tsx` *(novo)* | Bottom sheet de ações do jogador (§11.1). | Alto | **CRÍTICA** |
| A-079 | `features/matches/teamComposition.ts` | Novas funções puras `applyPositionChange` e `applySwap`, devolvendo a composição nova + a descrição da alteração (mesmo padrão de `applyPlayerMove`). | Médio | **CRÍTICA** |
| A-080 | `features/matches/teamComposition.test.ts` | Testes das novas funções puras (troca dentro do time, entre times, no-op, jogador inexistente). | Baixo | ALTA |

---

## 12. Drag and Drop

**Decisão: o arrastar-e-soltar continua existindo, mas deixa de ser o único caminho.** No desktop é o gesto natural; no mobile é complementar.

| Plataforma | Interação primária | Complementar |
|---|---|---|
| Desktop (mouse) | Arrastar e soltar | Menu do jogador |
| Desktop (teclado) | `Enter` seleciona → setas navegam → `Enter` confirma | — |
| Tablet / celular | **Tocar → escolher ação → tocar no alvo** | Arrastar (mantido, com o mesmo `activationConstraint` de 8px) |

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-081 | `features/matches/MatchDetailPage.tsx` (ou `DrawResultSection`) | Adicionar `KeyboardSensor` ao `useSensors`. Corrige P-72. | Baixo | ALTA |
| A-082 | `features/matches/useDrawSelection.ts` *(novo)* | Estado do "modo de seleção": jogador selecionado, ação pretendida, alvos válidos. É o que alimenta o realce no campo e nas listas. | Médio | **CRÍTICA** |
| A-083 | `features/matches/PlayerToken.tsx` | Toque simples (sem arrasto) seleciona o jogador em vez de não fazer nada; estado visual `selected` distinto de `dragging`. Corrige P-42. | Médio | **CRÍTICA** |
| A-084 | `features/matches/TeamResultCard.tsx` | Texto de ajuda passa a descrever **as duas** formas ("Toque em um jogador para trocar, ou arraste para outro time"). | Baixo | ALTA |
| A-085 | `features/matches/DrawResultSection.tsx` | `DragOverlay` mantido; adicionar realce dos alvos válidos também no modo de seleção. | Baixo | ALTA |
| A-086 | `features/matches/MatchDetailPage.test.tsx` | Estender os testes existentes para cobrir o fluxo por toque (sem `pointer` drag) e por teclado. | Baixo | ALTA |

---

## 13. Regras de Equilíbrio

### 13.1 O que é preservado — sem exceção

| Regra | Onde vive | Situação no plano |
|---|---|---|
| Separação dos piores (N piores em times diferentes, camadas cumulativas, restrição **dura**) | `domain/scoring.py::weakest_tiers`, `minimum_weakest_split_cost`; `simulated_annealing.py:138` | **Intocada** |
| Equilíbrio técnico (soma + média de estrelas) | `scoring.py::_balance_cost` | Intocada |
| Distribuição por posição (com tratamento de posição escassa) | `scoring.py::_position_cost` | Intocada |
| Repetição de duplas (janela de 10 sorteios, peso decrescente) | `scoring.py::_repetition_cost`, `repositories.py` | Intocada |
| Uso de posição secundária (penalidade leve) | `scoring.py::_secondary_usage_cost` | Intocada |
| Distribuição de convidados | `scoring.py::_guest_balance_cost` | Intocada |
| Capacidade / mínimo / fila de espera | `matches/services.py`, `draws/services.py:49-66` | Intocada |
| Mensalista × convidado | `Player.player_type` | Intocada |

### 13.2 Conflitos identificados entre a formação e as regras atuais

Estes são os pontos que **precisam de decisão explícita** antes da implementação:

**Conflito 1 — Formação vs. distribuição por posição.**
O critério `_position_cost` já tenta espalhar as posições entre os times. Se a formação for aplicada **depois** da distribuição (proposta deste plano), pode acontecer de um time receber 4 zagueiros e a formação pedir 2 — dois deles serão desenhados/registrados fora da posição natural.
→ **Proposta**: aplicar a formação como camada posterior (não mexer na têmpera) e **sinalizar na tela** quantos jogadores ficaram fora da posição principal. Alternativa rejeitada: transformar a formação em restrição do algoritmo — isso mudaria o resultado do sorteio para todo mundo e conflitaria com a restrição dos piores.

**Conflito 2 — Formação vs. tamanho de time desigual.**
`REGRAS_DE_NEGOCIO.md` §6.3: com total de confirmados não múltiplo do número de times, os times podem diferir em 1 jogador. Uma formação fixa de `L` slots não acomoda `L+1`.
→ **Proposta**: a formação define o **desenho preferencial**; o jogador excedente é desenhado como *extra* na linha mais numerosa, e a formação é exibida como `2-2-2 (+1)`. Nenhum jogador fica de fora.

**Conflito 3 — Formação vs. goleiro.**
Com `goalkeepers_per_team = 0` (padrão), não há goleiro no sorteio, mas pode haver jogadores cadastrados na posição GOL entre os confirmados.
→ **Proposta**: a linha de goleiro do desenho aparece quando (a) `goalkeepers_per_team > 0` **ou** (b) há jogador com posição GOL no time. A notação da formação nunca conta o goleiro.

**Conflito 4 — Movimentação manual vs. formação.**
Mover um jogador para um time cheio quebra a formação de destino.
→ **Proposta**: §11.2 (oferece troca em vez de movimento) + o bloco de observações já existente passa a avisar "a formação do Time 2 foi quebrada".

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-087 | `backend/apps/draws/domain/` | **Nenhuma alteração em `scoring.py` nem em `simulated_annealing.py`.** Registrado explicitamente para que a implementação não "melhore" o algoritmo de passagem. | — | **CRÍTICA** |
| A-088 | `features/matches/teamComposition.ts` | `formationReport(team)`: quantos jogadores fora da posição principal, formação respeitada, jogadores extras. | Baixo | ALTA |
| A-089 | `features/matches/ManualMovesNotes.tsx` | Acrescentar aviso de formação quebrada aos avisos de equilíbrio e de piores juntos (já existentes). | Baixo | ALTA |
| A-090 | `features/matches/TeamResultCard.tsx` | Exibir a formação do time no cabeçalho, ao lado do total de estrelas. | Baixo | ALTA |
| A-091 | `backend/apps/draws/serializers.py` | Expor `score_weakest_split` e `score_guest_balance` no `DrawSerializer` para a tela poder explicar o equilíbrio. Corrige P-96. | Baixo | BAIXA |
| A-092 | `docs/REGRAS_DE_NEGOCIO.md` | Nova seção 6.6 "Formação" documentando §9 e as 4 resoluções de conflito acima. **Obrigatório** — a regra do repositório é atualizar este arquivo junto com o código. | Baixo | **CRÍTICA** |

---

## 14. Auditoria

### 14.1 O que é registrado hoje

`move_player_to_team` (`draws/services.py:283-294`) grava `PLAYER_MOVED` com `team_from`, `team_to`, `before={team_id, team_name}`, `after={team_id, team_name}`, `reason="Movimentação manual (arrastar e soltar no campo)"`, além de usuário, data/hora, IP e user-agent (via `apps/audit/middleware.py`).

**Não é registrado**: posição anterior/nova, formação, troca entre dois jogadores como evento único.

### 14.2 Registro proposto

| Ação (`AuditLog.Action`) | Quando | `before` | `after` |
|---|---|---|---|
| `player_moved` *(existente, enriquecida)* | Jogador muda de time | `{team_id, team_name, position_id, position_code, line_index, slot_index}` | idem, com os novos valores |
| `player_position_changed` *(nova)* | Jogador muda de posição no mesmo time | `{position_id, position_code, line_index, slot_index}` | idem |
| `players_swapped` *(nova)* | Dois jogadores trocam de lugar | `{a: {...}, b: {...}}` | `{a: {...}, b: {...}}` |
| `draw_formation_changed` *(nova)* | Formação de um time alterada após o sorteio | `{team_id, formation}` | `{team_id, formation}` |
| `draw_created` *(existente, enriquecida)* | Sorteio executado | — | acrescentar `formation` e `formations_by_team` ao payload atual |

Exemplo de leitura na tela (requisito 24):

```
João Silva
Antes:   Time 1 🔵 · ME  (linha 2, slot 1)
Depois:  Time 2 🔴 · AT  (linha 3, slot 2)
Motivo:  Ajuste manual após o sorteio
Por:     Bruno Amoedo · 10/08/2026 14:32 · 192.168.0.10
```

### 14.3 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-093 | `backend/apps/audit/models.py` + migration | 3 ações novas em `AuditLog.Action`. **Atenção**: `action` é `CharField(max_length=30)` — `draw_formation_changed` tem 23 caracteres, cabe; validar todos antes de migrar. Corrige P-95. | Médio | **CRÍTICA** |
| A-094 | `backend/apps/draws/services.py` | `move_player_to_team` passa a incluir posição/linha/slot em `before`/`after`. | Baixo | **CRÍTICA** |
| A-095 | `backend/apps/draws/services.py` | `change_player_position` e `swap_players` auditam com as ações novas. | Médio | **CRÍTICA** |
| A-096 | `backend/apps/draws/services.py:137-158` | `execute_draw` inclui `formation` no payload de `draw_created`. | Baixo | ALTA |
| A-097 | `frontend/src/core/types/audit.ts` | Rótulos das ações novas em `AUDIT_ACTION_LABELS` (o filtro da tela é derivado desse mapa — `AuditLogPage.tsx:17-23` — então basta acrescentar aqui). | Baixo | ALTA |
| A-098 | `features/audit/AuditEntryCard.tsx` *(A-018)* | Renderizar `before`/`after` no formato legível acima, com fallback JSON para ações não mapeadas. Corrige P-13. | Médio | ALTA |
| A-099 | `features/matches/ManualMovesNotes.tsx` | Acrescentar o aviso explícito pedido no requisito 23: *"Os times foram gerados automaticamente pelo sorteio. Alterações manuais de jogadores ou posições são registradas na auditoria."* (hoje o bloco existe mas não menciona a auditoria). | Baixo | ALTA |

---

## 15. Responsividade

### 15.1 Matriz de verificação

Toda tela deve ser verificada nestas larguras, nos dois temas:

| Largura | Dispositivo de referência | Verificar |
|---|---|---|
| 320 | iPhone SE 1ª geração | Nada corta, nenhum overflow horizontal |
| 375 | iPhone SE/8/13 mini | Layout de projeto |
| 390 | iPhone 14/15 | Layout de projeto |
| 414 | Android grande | — |
| 768 | iPad retrato | Transição de card→tabela |
| 1024 | iPad paisagem / notebook | Abas não cortam |
| 1440 | Desktop | Container centralizado |

### 15.2 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-100 | `shared/components/FormDrawer.tsx` | `width: { xs: "100%" }` (não `100vw`), cabeçalho sticky com X, rodapé sticky com as ações, corpo com `overflowY: auto`. Corrige P-50, P-51, P-52. | Médio | **CRÍTICA** |
| A-101 | `shared/components/ConfirmDialog.tsx` | `fullWidth`, botões empilhados e `fullWidth` abaixo de `sm`, ação destrutiva por último. Corrige P-56. | Baixo | ALTA |
| A-102 | `features/matches/QuickConfirmDialog.tsx` | `fullScreen` abaixo de `sm` com barra de diálogo; `Autocomplete` com largura contida. Corrige P-30. | Médio | ALTA |
| A-103 | `features/finance/FinancePage.tsx` | Filtros migram para `FilterSheet` (§22) com chips do que está ativo. Corrige P-17. | Médio | ALTA |
| A-104 | `features/players/PlayersPage.tsx` | Busca visível + demais filtros em `FilterSheet`. Corrige P-48. | Baixo | MÉDIA |
| A-105 | `features/finance/FinancePage.tsx:681-685` | `Tabs` com `variant="scrollable"`; cards de resumo em 2 colunas no mobile (já são `xs: 6`, manter) com tipografia menor. | Baixo | MÉDIA |
| A-106 | `features/organization/OrganizationSelectorPage.tsx:26` | `Stack sx={{ width: 420 }}` fixo → `width: "100%", maxWidth: 420, px: 2`. Em 375px hoje **estoura a tela**. | Baixo | ALTA |
| A-107 | `shared/components/ToastProvider.tsx` | Ancoragem no topo abaixo de `sm` (ou offset acima da barra de ação), duração proporcional ao texto. Corrige P-57, P-58. | Baixo | MÉDIA |
| A-108 | `features/matches/WhatsAppShareCard.tsx` | Prévia colapsada de 3 linhas + botões acima do texto; "Copiar" como ação primária. Corrige P-28. | Médio | ALTA |

---

## 16. PWA

### 16.1 Diagnóstico

**O projeto não é um PWA hoje** (P-90, P-91, P-92). Não há manifest, service worker nem ícones de instalação.

### 16.2 Escopo proposto — e o que fica de fora

| Item | Decisão |
|---|---|
| Instalável ("Adicionar à tela de início" com ícone e splash) | ✅ Implementar |
| `display: standalone`, `theme_color`, `background_color` | ✅ Implementar |
| Ícones 192/512 + maskable + apple-touch-icon | ✅ Implementar |
| Service worker de **app shell** (HTML/JS/CSS versionados) | ✅ Implementar |
| Cache de **dados de negócio** (partidas, sorteios, jogadores, financeiro) | ❌ **Não** — dados críticos continuam dependendo do backend |
| Funcionamento offline | ❌ **Não é objetivo** (explícito no pedido) |
| Armazenar dados sensíveis no dispositivo | ❌ **Não** — hoje só `localStorage` de token e organização; nada além disso |
| Push notifications | ❌ Fora de escopo |

> **Nota de segurança**: o token JWT já vive em `localStorage` (`platform/webTokenStorage.ts`). Um service worker **não deve** interceptar nem armazenar respostas de `/api/` — a regra de cache deve excluir explicitamente esse prefixo.

### 16.3 Alterações

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-109 | `frontend/public/manifest.webmanifest` *(novo)* | `name: "Sorteio da Pelada"`, `short_name: "Pelada"`, `start_url: "/"`, `display: "standalone"`, `theme_color`, `background_color`, `icons[]`. | Baixo | MÉDIA |
| A-110 | `frontend/public/icons/` *(novo)* | `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` gerados a partir do `favicon.svg`. | Baixo | MÉDIA |
| A-111 | `frontend/index.html` | `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="apple-mobile-web-app-*">`. | Baixo | MÉDIA |
| A-112 | `frontend/vite.config.ts` + `package.json` | `vite-plugin-pwa` em modo `generateSW` com `navigateFallback` e **`navigateFallbackDenylist: [/^\/api\//]`**; `runtimeCaching` apenas para estáticos. | Médio | MÉDIA |
| A-113 | `frontend/public/icons.svg` | **Remover** (arquivo de template não referenciado). Corrige P-89. | Baixo | BAIXA |

---

## 17. Performance

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-114 | `frontend/src/App.tsx` | `React.lazy` + `Suspense` por rota, com `PageSkeleton` como fallback. Isola `@mui/x-charts` (Estatísticas) e o módulo financeiro. Corrige P-81. | Médio | ALTA |
| A-115 | `frontend/vite.config.ts` | `build.rollupOptions.output.manualChunks` separando `react`, `mui`, `charts`, `dnd`. Corrige P-87. | Baixo | MÉDIA |
| A-116 | `features/finance/FinancePage.tsx` | Queries por aba com `enabled`; `summary` e `capabilities` no mount, o resto sob demanda. Corrige P-82. | Médio | ALTA |
| A-117 | `features/matches/MatchDetailPage.tsx` | `drawHistory` com `enabled` só quando o usuário abrir o seletor de versões. Corrige P-83. | Baixo | MÉDIA |
| A-118 | `backend/apps/players/` (models + serializer) | Miniatura do avatar (ex.: 96×96 gerada no upload) exposta como `photo_thumb`. Corrige P-85. **Requer decisão**: `Pillow` já é dependência indireta do `ImageField`; confirmar antes de assumir. | Alto | ALTA |
| A-119 | `PlayersPage`, `MatchDetailPage`, `WaitlistPanel` | Consumir `photo_thumb` + `loading="lazy"` nos `Avatar`. | Baixo | ALTA |
| A-120 | `DataTable.tsx` + `api/*.ts` | Paginação servida pela API (primeira página imediata, próximas sob demanda), substituindo `fetchAllPages` nas listagens grandes. **`fetchAllPages` é mantido** onde a lista inteira é requisito (ex.: opções de select). Corrige P-18, P-84. | Alto | MÉDIA |
| A-121 | `features/matches/FootballPitch.tsx`, `PlayerToken.tsx` | `React.memo` + `useMemo` no cálculo de layout. Corrige P-86. | Baixo | MÉDIA |

---

## 18. Acessibilidade

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-122 | `frontend/index.html` | `lang="pt-BR"`. Corrige P-70. | Baixo | ALTA |
| A-123 | `MatchDetailPage`, `WaitlistPanel`, `TeamResultCard` | Toda informação hoje só em `Tooltip` passa a ter equivalente visível. Corrige P-71. | Médio | **CRÍTICA** |
| A-124 | `shared/components/PageHeader.tsx` | Título com `component="h1"`; seções internas usam `h2`. Corrige P-74. | Baixo | ALTA |
| A-125 | `shared/theme/ColorModeContext.tsx` | Anel de `:focus-visible` global. Corrige P-77. | Baixo | MÉDIA |
| A-126 | `shared/components/DataTable.tsx` | Linha clicável focável e acionável por teclado (`tabIndex={0}`, `onKeyDown` Enter/Espaço, `role="button"`). Corrige P-78. | Baixo | MÉDIA |
| A-127 | `features/statistics/StatisticsPage.tsx` | `aria-label` no gráfico + referência textual à tabela. Corrige P-79. | Baixo | BAIXA |
| A-128 | `PlayersPage`, `FinancePage`, `AuditLogPage` | Região `aria-live="polite"` anunciando "N resultados" após filtrar. Corrige P-80. | Baixo | BAIXA |
| A-129 | `features/matches/PlayerToken.tsx` | Manter `aria-label` completo (nome, posição, estrelas, time) e adicionar `aria-pressed` no modo de seleção. | Baixo | ALTA |
| A-130 | `docs/DESIGN_SYSTEM.md` | Seção de acessibilidade: contraste mínimo, alvo de toque, foco, nunca-só-cor, nunca-só-hover. | Baixo | MÉDIA |

> **Verificação de contraste (P-75, P-76) é uma tarefa de implementação, não uma suposição deste documento.** Os valores citados foram estimados a partir dos hexadecimais do tema; a validação formal (WCAG AA) precisa ser feita com ferramenta durante a implementação. **A confirmar durante implementação.**

---

## 19. Backend

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-131 | `apps/draws/domain/formations.py` *(novo)* | Módulo puro de formações (A-056). | Alto | **CRÍTICA** |
| A-132 | `apps/draws/services.py::execute_draw` | Parâmetros `formation` / `formations_by_team`; atribuição de slots pós-distribuição; gravação de `line_index`/`slot_index`; formação no payload da auditoria. **Comportamento sem formação idêntico ao atual.** | Alto | **CRÍTICA** |
| A-133 | `apps/draws/services.py` | `change_player_position` (A-073). | Alto | **CRÍTICA** |
| A-134 | `apps/draws/services.py` | `swap_players` transacional (A-074). | Alto | **CRÍTICA** |
| A-135 | `apps/draws/services.py` | `set_team_formation(draw, team_id, formation, reason)` — permite alterar a formação de um time **após** o sorteio, recalculando os slots dos jogadores já atribuídos (requisito 12/15). | Médio | ALTA |
| A-136 | `apps/draws/services.py::move_player_to_team` | Enriquecer `before`/`after` com posição/linha/slot; ao mover para um time com formação, recalcular o slot do jogador. | Médio | **CRÍTICA** |
| A-137 | `apps/matches/dashboard_views.py` + `serializers.py` | Estender o resumo do dashboard (A-012). | Médio | ALTA |
| A-138 | `apps/matches/serializers.py` | Serializer enxuto para `roster` (sem os campos de cadastro não usados na tela). Corrige P-99. | Baixo | MÉDIA |

---

## 20. Banco de Dados

Três migrations novas. Todas **aditivas** (colunas nulas ou com default), sem `ALTER` destrutivo e sem backfill obrigatório.

### Migration 1 — `draws/0005_formation.py`

| Tabela | Coluna | Tipo | Default | Justificativa |
|---|---|---|---|---|
| `draws_draw` | `formation` | `CharField(max_length=20, blank=True)` | `""` | Formação padrão escolhida no sorteio |
| `draws_team` | `formation` | `CharField(max_length=20, blank=True)` | `""` | Formação **daquele** time (requisito 12) |
| `draws_teamplayer` | `line_index` | `PositiveSmallIntegerField(null=True, blank=True)` | `NULL` | Linha do jogador dentro da formação |
| `draws_teamplayer` | `slot_index` | `PositiveSmallIntegerField(null=True, blank=True)` | `NULL` | Posição dentro da linha (ordem da esquerda para a direita) |

**Compatibilidade retroativa**: sorteios antigos ficam com `formation=""` e `line_index=NULL`; `computeFieldLayout` mantém o caminho atual (agrupamento por `sort_order`) para esses registros. Nenhum sorteio histórico é reescrito.

### Migration 2 — `audit/0007_move_actions.py`

`AlterField` em `AuditLog.action` acrescentando `player_position_changed`, `players_swapped`, `draw_formation_changed` às `choices`. (O padrão do app já é exatamente esse — ver `audit/migrations/0002`, `0003`, `0004`, `0006`, todas `alter_auditlog_action`.)

### Migration 3 — `players/0003_photo_thumb.py` *(condicional a A-118)*

| Tabela | Coluna | Tipo |
|---|---|---|
| `players_player` | `photo_thumb` | `ImageField(upload_to="players/thumbs/", null=True, blank=True)` |

| ID | Alteração | Impacto | Prioridade |
|---|---|---|---|
| A-139 | Migration `draws/0005_formation.py` | Médio | **CRÍTICA** |
| A-140 | Migration `audit/0007_move_actions.py` | Baixo | **CRÍTICA** |
| A-141 | Migration `players/0003_photo_thumb.py` | Médio | ALTA |
| A-142 | Índice `TeamPlayer(team, line_index, slot_index)` — o campo lê os jogadores por time já ordenados | Baixo | MÉDIA |
| A-143 | `backend/seed_demo.py` — semear ao menos um sorteio **com** formação, para o ambiente de demonstração exercitar o caminho novo | Baixo | MÉDIA |

---

## 21. APIs

### Endpoints novos

| Método | Rota | Corpo | Resposta | Permissão |
|---|---|---|---|---|
| `GET` | `/api/draws/formations/?line_players=6` | — | `[{key:"2-2-2", lines:[2,2,2], label:"2-2-2", balanced:true}, …]` | membro |
| `POST` | `/api/draws/{id}/set-position/` | `{team_player_id, position_id?, line_index, slot_index, reason?}` | `TeamPlayerSerializer` | organizador/admin |
| `POST` | `/api/draws/{id}/swap-players/` | `{team_player_a, team_player_b, reason?}` | `[TeamPlayer, TeamPlayer]` | organizador/admin |
| `POST` | `/api/draws/{id}/set-formation/` | `{team_id, formation, reason?}` | `TeamSerializer` | organizador/admin |

### Endpoints alterados

| Rota | Alteração | Compatibilidade |
|---|---|---|
| `POST /api/matches/{id}/draw/` | Passa a aceitar corpo **opcional** `{formation?, formations_by_team?}` | ✅ Retrocompatível — sem corpo, comportamento atual |
| `GET /api/draws/` | `Team.formation`, `TeamPlayer.line_index`, `TeamPlayer.slot_index`, `Draw.formation` nos payloads | ✅ Aditivo |
| `POST /api/draws/{id}/move-player/` | Auditoria enriquecida; recálculo de slot | ✅ Sem mudança de contrato |
| `GET /api/dashboard/summary/` | Blocos de hoje/pendências/financeiro | ✅ Aditivo |
| `GET /api/matches/{id}/roster/` | Serializer enxuto | ⚠️ **Remove campos** — verificar consumo no front antes |

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-144 | `backend/apps/draws/views.py` | Action `formations` (detail=False). | Baixo | ALTA |
| A-145 | `backend/apps/draws/views.py` | Action `set-position`. | Baixo | **CRÍTICA** |
| A-146 | `backend/apps/draws/views.py` | Action `swap-players`. | Baixo | **CRÍTICA** |
| A-147 | `backend/apps/draws/views.py` | Action `set-formation`. | Baixo | ALTA |
| A-148 | `backend/apps/matches/views.py:436-443` | `draw` aceita corpo opcional com formação. Corrige P-97. | Médio | **CRÍTICA** |
| A-149 | `frontend/src/api/drawsApi.ts` | `formations`, `setPlayerPosition`, `swapPlayers`, `setFormation`; `trigger` aceita opções. | Baixo | **CRÍTICA** |
| A-150 | `frontend/src/core/types/draw.ts` | Tipos correspondentes. | Baixo | **CRÍTICA** |

---

## 22. Componentes Frontend

### Novos

| ID | Componente | Arquivo | Responsabilidade |
|---|---|---|---|
| A-151 | `BottomSheet` | `shared/components/BottomSheet.tsx` | `Drawer anchor="bottom"` com alça de arraste, `maxHeight: 85vh`, `safe-area`, fechamento por gesto. Base de `DrawSetupSheet`, `PlayerActionSheet`, `FilterSheet`. |
| A-152 | `OverflowMenu` | `shared/components/OverflowMenu.tsx` | Menu ⋮ acessível (substitui as fileiras de `IconButton`). |
| A-153 | `EmptyState` | `shared/components/EmptyState.tsx` | Ícone + título + descrição + CTA. Corrige P-69. |
| A-154 | `PageSkeleton` | `shared/components/PageSkeleton.tsx` | Esqueleto de página (fallback do `Suspense` e dos carregamentos fora de tabela). |
| A-155 | `FilterSheet` | `shared/components/FilterSheet.tsx` | Filtros em bottom sheet + chips do que está ativo + "Limpar". |
| A-156 | `AppActionBar` | `shared/components/AppActionBar.tsx` | Barra de ação primária fixa no rodapé, empilhável com a `BottomNav`. |
| A-157 | `PlayerAvatar` | `shared/components/PlayerAvatar.tsx` | Avatar padronizado com iniciais, `loading="lazy"` e miniatura. |
| A-158 | `StatTile` | `shared/components/StatTile.tsx` | Bloco de métrica do dashboard (rótulo, valor, tendência, ação). |
| A-159 | `SegmentedControl` | `shared/components/SegmentedControl.tsx` | Alternância compacta (ex.: filtro de presença), melhor que `Tabs` no mobile. |
| A-160 | `FormationPicker` | `features/matches/FormationPicker.tsx` | (A-060) |
| A-161 | `PlayerActionSheet` | `features/matches/PlayerActionSheet.tsx` | (A-078) |
| A-162 | `DrawSetupSheet` | `features/matches/DrawSetupSheet.tsx` | (A-044) |

> Somados aos cards de A-014 a A-019 e aos componentes de layout de A-036/A-037, o total de componentes novos é **14** entre `shared/` e `features/`.

### Alterados (resumo consolidado)

| Arquivo | Alterações que o tocam |
|---|---|
| `shared/layout/AppLayout.tsx` | A-004, A-005, A-038, A-039, A-040, A-041, A-043 |
| `shared/components/DataTable.tsx` | A-013, A-120, A-126 |
| `shared/components/FormDrawer.tsx` | A-100 |
| `shared/components/ConfirmDialog.tsx` | A-101 |
| `shared/components/ToastProvider.tsx` | A-107 |
| `shared/components/PageHeader.tsx` | A-124 |
| `shared/components/StatusChip.tsx` | A-032 |
| `shared/theme/ColorModeContext.tsx` | A-002, A-003, A-022, A-023, A-024, A-025, A-026, A-027 |
| `core/fieldLayout.ts` | A-064 |
| `features/matches/MatchDetailPage.tsx` | A-045, A-047, A-053, A-081, A-117 (+ extrações A-048/A-049/A-050) |
| `features/matches/FootballPitch.tsx` | A-065, A-066, A-070, A-071, A-121 |
| `features/matches/PlayerToken.tsx` | A-031, A-067, A-083, A-121, A-129 |
| `features/matches/teamComposition.ts` | A-079, A-088 |
| `features/matches/shareFormat.ts` | A-030, A-063 |
| `features/matches/exportUtils.ts` | A-069 |
| `features/matches/ManualMovesNotes.tsx` | A-089, A-099 |
| `features/matches/WhatsAppShareCard.tsx` | A-108 |
| `features/matches/QuickConfirmDialog.tsx` | A-102 |
| `features/matches/TeamResultCard.tsx` | A-084, A-090, A-123 |
| `features/matches/WaitlistPanel.tsx` | A-123 (+ P-31 via `OverflowMenu`) |
| `features/players/PlayersPage.tsx` | A-020, A-104, A-119, A-128 |
| `features/finance/FinancePage.tsx` | A-103, A-105, A-116 |
| `features/dashboard/DashboardPage.tsx` | A-009 |
| `features/statistics/StatisticsPage.tsx` | A-127 |
| `features/audit/AuditLogPage.tsx` | A-128 |
| `features/organization/OrganizationSelectorPage.tsx` | A-106 |
| `src/App.tsx` | A-114 |
| `src/index.css` | A-007 |
| `index.html` | A-006, A-008, A-111, A-122 |
| `vite.config.ts` | A-112, A-115 |

---

## 23. Alterações de Dependências

| ID | Pacote | Tipo | Justificativa | Peso aprox. | Recomendação |
|---|---|---|---|---|---|
| A-163 | `@fontsource-variable/inter` | **Nova (frontend)** | A fonte Inter está declarada no tema mas **não é carregada**. Auto-hospedar evita requisição a terceiros e *layout shift*. | ~40KB (subset latin) | ✅ Adotar |
| A-164 | `vite-plugin-pwa` | **Nova (dev, frontend)** | Gera manifest + service worker sem escrever SW à mão. Só entra se a §16 for aprovada. | dev-only | ⚠️ Opcional (§16) |
| A-165 | `Pillow` | **Verificar (backend)** | Necessária para gerar a miniatura de avatar (A-118). `ImageField` já exige Pillow para validar imagens, então **provavelmente já está instalada** via `requirements/base.txt`. **A confirmar durante implementação.** | — | ⚠️ Condicional |

**Não serão adicionados** (decisão explícita, alinhada a `PLANO_IMPLEMENTACAO.md` §4):

- Tailwind / shadcn-ui — incompatíveis com a base MUI.
- `framer-motion` — as transições do MUI (`Fade`, `Grow`, `Collapse`, `Slide`) atendem.
- `react-query` — removido de propósito; a data layer própria é a fonte da verdade (`AGENTS.md`).
- Biblioteca de gráficos adicional — `@mui/x-charts` já está presente.
- Biblioteca de drag-and-drop adicional — `@dnd-kit/core` já atende; falta apenas o `KeyboardSensor` e o modo por toque.

---

## 24. Alterações no Docker

| ID | Arquivo | Alteração | Impacto | Prioridade |
|---|---|---|---|---|
| A-166 | `frontend/Dockerfile` | Multi-stage: **stage `dev`** (atual, `npm run dev`, usado pelo compose) + **stage `production`** (`npm ci && npm run build` → `nginx:alpine` servindo `dist/` com `try_files` para SPA e cache longo em assets com hash). Corrige P-88. | Médio | ALTA |
| A-167 | `docker-compose.yml` | Serviço `frontend` fixa `target: dev` explicitamente, para o comportamento de desenvolvimento não mudar com o multi-stage. | Baixo | ALTA |
| A-168 | `.github/workflows/ci.yml` | O job `docker-build` do frontend passa a construir o **stage de produção** (é o que realmente valida `npm run build` dentro da imagem). | Baixo | MÉDIA |

**Não muda**: nenhum serviço novo, nenhuma porta nova, nenhuma variável de ambiente nova. Postgres, Redis, backend, celery-worker e celery-beat ficam exatamente como estão.

---

## 25. Plano de Testes

### 25.1 Backend (pytest)

| Arquivo | Cobertura |
|---|---|
| `tests/test_formations.py` *(novo)* | `generate_formations` para L de 4 a 12; cobertura de **todos** os exemplos do pedido (5, 6 e 7 jogadores); soma sempre igual a L; `map_lines_to_positions` com 3, 4 e 6 posições cadastradas; `assign_players_to_slots` minimizando o custo |
| `tests/test_draws.py` *(estender)* | Sorteio **sem** formação produz exatamente o resultado atual (regressão); sorteio **com** formação grava `line_index`/`slot_index`; formação inválida (soma ≠ L) é recusada |
| `tests/test_draw_position_changes.py` *(novo)* | `change_player_position` em sorteio vigente e recusa em histórico; `swap_players` no mesmo time e entre times; atomicidade (falha no meio não deixa estado parcial) |
| `tests/test_audit.py` *(estender)* | 3 ações novas gravadas com `before`/`after` completos; `player_moved` com posição; `draw_created` com formação |
| `tests/test_weakest_players_distribution.py` | **Não alterar** — é o teste que prova que a regra dos piores não regrediu |
| `tests/test_regressions.py` *(estender)* | Sorteio de partida antiga (sem formação) continua renderizável |

### 25.2 Frontend (vitest + Testing Library)

| Arquivo | Cobertura |
|---|---|
| `core/formations.test.ts` *(novo)* | Paridade com o backend nos mesmos casos |
| `features/matches/FootballPitch.test.tsx` *(novo)* | Sem sobreposição de 2 a 6 por linha; formação respeitada; linha de goleiro condicional; `role="group"` |
| `features/matches/teamComposition.test.ts` *(estender)* | `applyPositionChange`, `applySwap` |
| `features/matches/MatchDetailPage.test.tsx` *(estender)* | Fluxo por toque (selecionar → ação → alvo); motivo de bloqueio visível; barra de ação presente |
| `shared/components/DataTable.test.tsx` *(novo)* | Card abaixo de `md`, tabela acima; seleção/ordenação preservadas nos dois modos |
| `shared/layout/AppLayout.test.tsx` *(novo)* | Item ativo por prefixo; `BottomNav` só abaixo de `md`; filtro por papel |

### 25.3 Verificação manual (obrigatória antes de fechar cada fase)

Matriz **tela × largura × tema** (§15.1), com atenção especial a:

1. `MatchDetailPage` com 2, 3, 4 e 5 times × 5 a 12 jogadores por time.
2. Sorteio → ajuste manual → texto do WhatsApp → exportação PNG, **inteiramente pelo celular**.
3. Navegação completa por teclado (Tab/Enter/setas) no resultado do sorteio.
4. VoiceOver (iOS) e TalkBack (Android) na tela da partida.
5. Modo claro e escuro em todas as telas alteradas.

### 25.4 Ferramentas sugeridas

- Lighthouse (Performance, Acessibilidade, Best Practices, PWA) — meta ≥ 90 em Acessibilidade.
- `axe-core` para varredura automatizada de a11y.
- Verificador de contraste WCAG para os pares do §6.1.

---

## 26. Critérios de Aceite

### Mobile First
- [ ] Nenhuma tela produz rolagem horizontal do `body` em 320px.
- [ ] Todo elemento interativo tem ao menos 44×44px de área tocável em `xs`.
- [ ] Nenhuma informação essencial depende de `hover`.
- [ ] Todas as listagens têm visão em card abaixo de `md`.
- [ ] A ação primária de cada tela é alcançável sem rolar.

### Menu
- [ ] Todo item do menu tem ícone consistente **e** texto.
- [ ] O item ativo é destacado corretamente inclusive em sub-rotas (`/partidas/123`).
- [ ] O menu funciona com o polegar (barra inferior + drawer com ações no rodapé).
- [ ] Ícones legíveis nos dois temas; `aria-current` no item ativo.

### Sorteio
- [ ] É possível escolher a formação **antes** do sorteio.
- [ ] É possível escolher formação diferente por time.
- [ ] As formações oferecidas são válidas para a quantidade real de jogadores de linha.
- [ ] Todos os exemplos do pedido (5, 6 e 7 jogadores) aparecem entre as opções.
- [ ] "Sortear novamente" respeita a formação escolhida.
- [ ] O resultado aparece automaticamente após o sorteio (comportamento atual preservado).

### Campo e ajustes
- [ ] O campo é legível em 320px (nomes sem sobreposição, fonte ≥ 11px efetivos).
- [ ] É possível mover um jogador entre times **sem arrastar**.
- [ ] É possível alterar a posição de um jogador.
- [ ] É possível trocar dois jogadores entre si, em uma operação atômica.
- [ ] Drag and drop continua funcionando no desktop.
- [ ] A troca funciona por teclado.

### Regras
- [ ] `pytest -q` passa sem nenhuma alteração nos testes de equilíbrio existentes.
- [ ] Os N piores continuam em times diferentes após qualquer sorteio.
- [ ] Convidados continuam destacados em vermelho em tela, campo, exportação e WhatsApp.
- [ ] Nenhuma regra de `REGRAS_DE_NEGOCIO.md` foi removida.

### Auditoria
- [ ] Toda movimentação, troca de posição e troca de jogadores gera registro com antes/depois, usuário e data/hora.
- [ ] A tela de auditoria exibe o antes/depois de forma legível.
- [ ] O aviso sobre alterações manuais aparece na tela de resultado.

### WhatsApp
- [ ] O texto inclui a formação de cada time.
- [ ] O texto inclui a posição de cada jogador.
- [ ] "Copiar" é alcançável sem rolar no celular.

### Qualidade
- [ ] `npm run lint`, `npm run test` e `npm run build` verdes.
- [ ] `ruff check .` e `pytest -q` verdes.
- [ ] Lighthouse Acessibilidade ≥ 90 nas telas principais.
- [ ] `docs/REGRAS_DE_NEGOCIO.md` atualizado com a seção de formação.

---

## 27. Ordem Recomendada de Implementação

Cada fase é fechável, testável e entregável sozinha. **Nenhuma fase depende de uma posterior.**

### Fase 0 — Correções de 1 linha (meia hora)
`A-122` (`lang="pt-BR"`), `A-038` (item ativo do drawer), `A-106` (largura fixa do seletor de organização), `A-050`/`A-113` (remover `icons.svg`), `A-006`.
> São bugs reais, de risco zero, e melhoram a experiência imediatamente.

### Fase 1 — Fundação do Design System
`A-021`, `A-022`, `A-023`, `A-024`, `A-025`, `A-026`, `A-027`, `A-028`, `A-033`, `A-002`, `A-003`, `A-007`, `A-034`.
> **É a fase de maior risco visual** (muda a altura de todos os campos e botões). Precisa de varredura completa das telas depois.

### Fase 2 — Navegação Mobile First
`A-035`, `A-036`, `A-037`, `A-039`, `A-040`, `A-041`, `A-043`, `A-004`, `A-005`, `A-008`.

### Fase 3 — Componentes compartilhados
`A-151` a `A-159`, `A-013`, `A-100`, `A-101`, `A-107`, `A-124`, `A-126`, `A-032`, `A-153`.

### Fase 4 — Listagens em card
`A-014` a `A-020`, `A-102`, `A-103`, `A-104`, `A-105`, `A-128`.

### Fase 5 — Dashboard
`A-009`, `A-010`, `A-011`, `A-012`, `A-137`.

### Fase 6 — Backend do sorteio (formações e trocas)
`A-056`, `A-057`, `A-058`, `A-073` a `A-076`, `A-093` a `A-096`, `A-131` a `A-136`, `A-139`, `A-140`, `A-142`, `A-144` a `A-148`, `A-092`, testes de §25.1.
> Fase inteiramente de backend, entregue com testes e sem tocar na interface. A API fica pronta antes de a tela precisar dela.

### Fase 7 — Sorteio na interface
`A-044` a `A-055`, `A-059` a `A-063`, `A-064` a `A-072`, `A-077` a `A-086`, `A-088` a `A-090`, `A-097` a `A-099`, `A-108`, `A-149`, `A-150`, `A-123`, `A-129`, testes de §25.2.
> É a fase maior. Recomenda-se subdividir: **7a** campo/formação (visual), **7b** trocas e seleção, **7c** compartilhamento e auditoria.

### Fase 8 — Performance, PWA e deploy
`A-114` a `A-121`, `A-109` a `A-113`, `A-166` a `A-168`, `A-127`, `A-130`, `A-138`, `A-141`, `A-143`, `A-091`.

---

## 28. Riscos e Impactos

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| R-01 | **A mudança global do tamanho dos campos (A-002) desconfigura telas** — `size:"small"` é default global há muito tempo e alturas foram assumidas em vários `sx` (ex.: `MatchDetailPage.tsx:652` usa `height: 40` fixo). | Alta | Alto | Varredura tela a tela na Fase 1; `grep` por `height: 40`/`height: 4` antes de aplicar; screenshots antes/depois |
| R-02 | **Alterar a cor primária (A-027) muda a identidade visual do produto.** | Média | Alto | **Validar com o usuário antes de aplicar**; alternativa: manter o verde e usar apenas texto ≥18px/bold nos botões preenchidos |
| R-03 | **Refatorar `MatchDetailPage` (884 linhas) quebra comportamento sutil** — a tela concentra o *optimistic update*, o rollback de movimentação, a recuperação de sorteio automático vencido (`missingDraw`) e o reset das observações por sorteio. | Alta | Alto | Extrair em passos pequenos, um componente por commit, com `MatchDetailPage.test.tsx` verde a cada passo |
| R-04 | **A formação altera o resultado percebido do sorteio** e o usuário conclui que "o sorteio mudou". | Média | Alto | A formação é camada posterior (§9.4/§13.2); comunicar na tela; teste de regressão provando que sem formação o resultado é idêntico |
| R-05 | **Conflito real entre formação e distribuição por posição** (Conflito 1 de §13.2) gera times "errados" na percepção do organizador. | Alta | Médio | Sinalizar quantos jogadores ficaram fora da posição principal; permitir corrigir na mão (§11) |
| R-06 | **Migration de `AuditLog.action`**: o campo é `max_length=30`; uma ação futura mais longa quebraria. | Baixa | Médio | Validar comprimento das 3 ações novas antes de migrar (a maior tem 23 caracteres) |
| R-07 | **`swap_players` não atômico deixa o sorteio inconsistente** se for implementado como duas chamadas. | Média | Alto | Exigência explícita: **uma** transação, **um** endpoint (A-074), nunca duas chamadas do cliente |
| R-08 | **A troca de `fetchAllPages` por paginação servida (A-120) esconde registros** — foi exatamente o bug F9 já corrigido em `AUDITORIA_BUGS.md`. | Média | Alto | Manter `fetchAllPages` onde a lista inteira é requisito; nunca reduzir a lista sem indicador visível de "há mais" |
| R-09 | **Serializer enxuto de `roster` (A-138) remove campos consumidos pela tela.** | Média | Médio | Auditar `RosterEntry` em `core/types/match.ts` e o uso em `MatchDetailPage` antes de cortar |
| R-10 | **Service worker cacheia respostas de `/api/`** e o organizador vê dados velhos num dia de sorteio. | Média | Alto | `navigateFallbackDenylist: [/^\/api\//]` e `runtimeCaching` só para estáticos (A-112) |
| R-11 | **Escopo da Fase 7 é grande demais** para um único ciclo. | Alta | Médio | Subdividir em 7a/7b/7c conforme §27 |
| R-12 | **Emojis removidos de lugares onde são conteúdo** (mensagem do WhatsApp, identidade dos times) quebram uma regra de negócio documentada. | Média | Alto | A-029 lista explicitamente o que **não** pode ser trocado: `shareFormat.ts` e os emojis de time |
| R-13 | **`docs/REGRAS_DE_NEGOCIO.md` fica desatualizado**, contrariando a regra do próprio documento. | Média | Médio | A-092 é bloqueante da Fase 6 |
| R-14 | **Verificações de contraste deste plano são estimativas**, não medições. | Alta | Baixo | Já sinalizado em §18 como "a confirmar durante implementação" |
| R-15 | **Geração de miniatura de avatar (A-118) exige Pillow** e reprocessamento das fotos existentes. | Média | Médio | Confirmar a dependência; gerar sob demanda com fallback para a imagem original |

---

## 29. Checklist de Execução

> **Como usar**: marque cada item ao concluir. Um item só é marcado quando o **portão de validação da fase** também passa. Se um item for descartado durante a implementação, troque `[ ]` por `[~]` e escreva o motivo na linha — nunca apague.
>
> Legenda: `[ ]` pendente · `[x]` concluído · `[~]` descartado (com motivo) · `[!]` bloqueado (com motivo)

### 29.0 Guardrails — validar ANTES de cada commit

Estas são as regras que este plano se compromete a não quebrar. Reler a cada entrega:

- [x] Nenhuma regra de `docs/REGRAS_DE_NEGOCIO.md` foi removida ou alterada sem atualizar o documento junto
- [x] `apps/draws/domain/scoring.py` e `apps/draws/domain/strategies/simulated_annealing.py` **não foram tocados** (A-087)
- [x] `tests/test_weakest_players_distribution.py` passa **sem nenhuma alteração no arquivo**
- [x] Sorteio **sem** formação produz resultado idêntico ao comportamento atual
- [x] Emojis de conteúdo preservados: mensagem do WhatsApp (`shareFormat.ts`) e identidade dos times (🔵🔴🟠…) — R-12
- [x] Convidado continua destacado em vermelho em: lista, campo SVG, exportação, impressão e WhatsApp
- [x] Nenhuma listagem passou a esconder registros silenciosamente — R-08 / bug F9 de `AUDITORIA_BUGS.md`
- [x] Nenhum `DELETE` físico introduzido (soft-delete continua sendo a regra)
- [x] Sorteio histórico continua somente leitura (trava na API, não só na tela)
- [x] Nenhuma dependência nova além das aprovadas em §23
- [x] Nenhum serviço, porta ou variável de ambiente novo no `docker-compose.yml`

### 29.1 Portão de validação — rodar ao fechar CADA fase

```bash
cd backend && ruff check . && pytest -q
```

```bash
cd frontend && npm run lint && npm run test && npm run build
```

- [x] `ruff check .` verde
- [x] `pytest -q` verde, **sem testes novos falhando nem antigos removidos**
- [x] `npm run lint` verde
- [x] `npm run test` verde
- [x] `npm run build` verde (inclui `tsc -b`)
- [x] Varredura visual nas larguras 320 / 375 / 768 / 1024 / 1440, nos temas claro **e** escuro
- [x] Nenhuma tela com rolagem horizontal do `body`
- [x] `docs/REGRAS_DE_NEGOCIO.md` atualizado se alguma regra mudou

---

### Fase 0 — Correções de 1 linha (risco zero)

- [x] A-122 · `frontend/index.html` · `lang="pt-BR"` (P-70)
- [x] A-006 · `frontend/index.html` · `theme-color` + `color-scheme` (P-67)
- [x] A-038 · `shared/layout/AppLayout.tsx` · item ativo do drawer por prefixo (P-02)
- [x] A-106 · `features/organization/OrganizationSelectorPage.tsx` · largura fixa 420px → fluida (estoura em 375px)
- [x] A-113 · `frontend/public/icons.svg` · remover (arquivo de template não referenciado) (P-89)

**Portão da fase 0**
- [x] §29.1 completo
- [x] Login e seleção de organização testados em 375px

---

### Fase 1 — Fundação do Design System ⚠️ maior risco visual (R-01)

- [x] A-021 · `shared/theme/tokens.ts` *(novo)* · tokens de cor/raio/espaçamento/elevação
- [x] A-022 · `ColorModeContext.tsx` · paleta estendida (`surface`, `muted`, `border`, `focus`, `team[]`, `pitch*`) (P-59)
- [x] A-023 · `ColorModeContext.tsx` · escala tipográfica `h1`–`h6` com `clamp()` (P-60)
- [x] A-024 · `ColorModeContext.tsx` · duas escalas de sombra (clara/escura) (P-61)
- [x] A-025 · `ColorModeContext.tsx` · respeitar `prefers-color-scheme` na primeira visita (P-66)
- [x] A-026 · `ColorModeContext.tsx` · anel global de `:focus-visible` (P-77)
- [x] A-027 · `ColorModeContext.tsx` · contraste AA no primário — **⚠️ validar com o usuário antes** (P-75, R-02)
- [x] A-028 · `shared/icons/index.ts` *(novo)* · mapa central `AppIcons` (P-62)
- [x] A-033 · `package.json` + `main.tsx` · `@fontsource-variable/inter`
- [x] A-002 · `ColorModeContext.tsx` · `MuiTextField` deixa de ser `size:"small"` global (P-54) — **⚠️ R-01**
- [x] A-003 · `ColorModeContext.tsx` · alvo mínimo de 44px em botões/ícones abaixo de `md` (P-15, P-55)
- [x] A-007 · `src/index.css` · `color-scheme`, `overscroll-behavior`, `tap-highlight`, `.safe-bottom`
- [x] A-001 · `ColorModeContext.tsx` · documentar breakpoints + `BREAKPOINT_INTENT`
- [x] A-034 · `docs/DESIGN_SYSTEM.md` *(novo)*

**Portão da fase 1**
- [x] §29.1 completo
- [x] `grep -rn "height: 4" frontend/src` revisado — nenhum campo com altura fixa quebrada (R-01)
- [x] Screenshots antes/depois das 12 telas comparadas
- [x] Contraste medido com ferramenta (não estimado) nos pares do §6.1 (R-14)

---

### Fase 2 — Navegação Mobile First

- [x] A-035 · `shared/layout/navItems.ts` *(novo)* · fonte única de itens de navegação
- [x] A-036 · `shared/layout/AppDrawer.tsx` *(novo)* · drawer redesenhado com ícones (P-03, P-06)
- [x] A-037 · `shared/layout/BottomNav.tsx` *(novo)* · barra inferior com `safe-area`
- [x] A-039 · `AppLayout.tsx` · `Tabs variant="scrollable"` (P-04)
- [x] A-040 · `AppLayout.tsx` · nome da organização sempre visível (P-05)
- [x] A-041 · `AppLayout.tsx` · landmarks + skip-link (P-08)
- [x] A-043 · `AppLayout.tsx` · `padding-bottom` reservado para a `BottomNav`
- [x] A-004 · `AppLayout.tsx` · `AppBar position="sticky"` (P-01)
- [x] A-005 · `AppLayout.tsx` · `Container maxWidth="lg"` (P-07)
- [x] A-008 · `index.html` · `viewport-fit=cover`
- [x] A-042 · `AppDrawer.tsx` · `aria-current="page"` e contraste nos dois temas

**Portão da fase 2**
- [x] §29.1 completo
- [x] Navegação completa usando **só o polegar** em 375px
- [x] Item ativo correto em `/partidas/123` (sub-rota)
- [x] Cada papel (`admin`, `organizador`, `visualizador`, `jogador`, superadmin) vê exatamente os itens certos

---

### Fase 3 — Componentes compartilhados

- [x] A-151 · `shared/components/BottomSheet.tsx` *(novo)*
- [x] A-152 · `shared/components/OverflowMenu.tsx` *(novo)*
- [x] A-153 · `shared/components/EmptyState.tsx` *(novo)* (P-69)
- [x] A-154 · `shared/components/PageSkeleton.tsx` *(novo)*
- [x] A-155 · `shared/components/FilterSheet.tsx` *(novo)*
- [x] A-156 · `shared/components/AppActionBar.tsx` *(novo)*
- [x] A-157 · `shared/components/PlayerAvatar.tsx` *(novo)*
- [x] A-158 · `shared/components/StatTile.tsx` *(novo)*
- [x] A-159 · `SegmentedControl` criado e **em uso** no filtro da lista de presença
- [x] A-013 · `DataTable.tsx` · prop `renderCard` (P-10) — **sem `renderCard`, comportamento atual preservado**
- [x] A-100 · `FormDrawer.tsx` · `100%` em vez de `100vw`, cabeçalho/rodapé sticky (P-50, P-51, P-52)
- [x] A-101 · `ConfirmDialog.tsx` · `fullWidth` + botões empilhados no mobile (P-56)
- [x] A-107 · `ToastProvider.tsx` · ancoragem e duração (P-57, P-58)
- [x] A-124 · `PageHeader.tsx` · `component="h1"` (P-74)
- [x] A-126 · `DataTable.tsx` · linha clicável focável por teclado (P-78)
- [x] A-032 · `StatusChip.tsx` · variante com ícone + tom `info`

**Portão da fase 3**
- [x] §29.1 completo
- [x] `shared/components/DataTable.test.tsx` cobrindo os dois modos (card e tabela)
- [x] Todo formulário salvável sem rolar até o fim em 375px

---

### Fase 4 — Listagens em card

- [x] A-014 · `features/players/PlayerCard.tsx` *(novo)* (P-12, P-15, P-49)
- [x] A-015 · `features/matches/MatchCard.tsx` *(novo)*
- [x] A-016 · `features/finance/ChargeCard.tsx` *(novo)* (P-14)
- [x] A-017 · `features/statistics/PlayerStatsCard.tsx` *(novo)* (P-11)
- [x] A-018 · `features/audit/AuditEntryCard.tsx` *(novo)* (P-13)
- [x] A-019 · `features/members/MemberCard.tsx` *(novo)*
- [x] A-020 · `PlayersPage.tsx` · barra de ação em lote flutuante (P-47)
- [x] A-102 · `QuickConfirmDialog.tsx` · `fullScreen` abaixo de `sm` (P-30)
- [x] A-103 · `FinancePage.tsx` · filtros em `FilterSheet` (P-17)
- [x] A-104 · `PlayersPage.tsx` · busca visível + filtros em sheet (P-48)
- [x] A-105 · `FinancePage.tsx` · `Tabs` scrollable + cards compactos
- [x] A-128 · `PlayersPage`/`FinancePage`/`AuditLogPage` · `aria-live` com contagem de resultados (P-80)
- [x] `WaitlistPanel.tsx` · 4 `IconButton` → `OverflowMenu` (P-31)

**Portão da fase 4**
- [x] §29.1 completo
- [x] As 6 telas de listagem verificadas em 320px sem rolagem horizontal
- [x] Ordenação, seleção em massa e paginação funcionam **iguais** nos dois modos
- [x] Seleção em massa ainda limpa ao trocar de filtro (regra documentada §3 de `REGRAS_DE_NEGOCIO.md`)

---

### Fase 5 — Dashboard

- [x] A-012 · `apps/matches/dashboard_views.py` + `serializers.py` · hoje/pendências/financeiro
- [x] A-137 · idem (backend) · testes do resumo estendido
- [x] A-009 · `DashboardPage.tsx` · hierarquia mobile (P-43, P-44, P-45, P-46)
- [x] A-010 · `features/dashboard/NextMatchHeroCard.tsx` *(novo)*
- [x] A-011 · `features/dashboard/PendingTasksCard.tsx` *(novo)*

**Portão da fase 5**
- [x] §29.1 completo
- [x] Bloco financeiro **não** aparece para quem não tem `financial.view`
- [x] Dashboard sem próxima partida mostra estado vazio com CTA

---

### Fase 6 — Backend do sorteio (formações e trocas) — sem tocar na interface

**Domínio e serviços**
- [x] A-056 / A-131 · `apps/draws/domain/formations.py` *(novo)* · módulo puro
- [x] A-057 / A-132 · `services.py::execute_draw` · formação + atribuição de slots
- [x] A-073 / A-133 · `services.py::change_player_position`
- [x] A-074 / A-134 · `services.py::swap_players` — **uma transação** (R-07)
- [x] A-135 · `services.py::set_team_formation`
- [x] A-136 · `services.py::move_player_to_team` · `before`/`after` com posição + recálculo de slot

**Serializers e views**
- [x] A-058 · `serializers.py` · `formation`, `line_index`, `slot_index`
- [x] A-075 · `serializers.py` · `ChangePlayerPositionSerializer`, `SwapPlayersSerializer`
- [x] A-076 / A-145 · `views.py` · action `set-position`
- [x] A-146 · `views.py` · action `swap-players`
- [x] A-147 · `views.py` · action `set-formation`
- [x] A-144 · `views.py` · action `formations`
- [x] A-148 · `apps/matches/views.py:436` · `draw` aceita corpo opcional (P-97)

**Auditoria**
- [x] A-093 · `apps/audit/models.py` · 3 ações novas — **validar `max_length=30`** (R-06)
- [x] A-094 · auditoria de `player_moved` enriquecida
- [x] A-095 · auditoria de `change_player_position` e `swap_players`
- [x] A-096 · `draw_created` com formação

**Banco**
- [x] A-139 · migration `draws/0005_formation.py`
- [x] A-140 · migration `audit/0007_move_actions.py`
- [x] A-142 · índice `TeamPlayer(team, line_index, slot_index)`

**Testes (§25.1)**
- [x] `tests/test_formations.py` *(novo)* — cobre **todos** os exemplos do pedido (5, 6, 7 jogadores)
- [x] `tests/test_draw_position_changes.py` *(novo)* — inclui atomicidade do swap
- [x] `tests/test_draws.py` estendido — regressão "sem formação = resultado atual"
- [x] `tests/test_audit.py` estendido
- [x] `tests/test_regressions.py` estendido — sorteio antigo (sem formação) renderizável

**Documentação**
- [x] A-092 · `docs/REGRAS_DE_NEGOCIO.md` §6.6 "Formação" — **bloqueante** (R-13)

**Portão da fase 6**
- [x] §29.1 completo
- [x] `migrate` e `migrate --plan` verificados; rollback testado em base de cópia
- [x] Swagger (`/api/docs/`) mostra os 4 endpoints novos
- [x] Guardrails §29.0 revalidados integralmente

---

### Fase 7a — Campo e formação (visual)

- [x] A-059 · `core/formations.ts` *(novo)* · espelho TypeScript
- [x] A-062 / A-150 · `core/types/draw.ts` · tipos novos
- [x] A-149 · `api/drawsApi.ts` · novos métodos
- [x] A-064 · `core/fieldLayout.ts` · layout por formação, fonte e truncamento por linha (P-35, P-36, P-40)
- [x] A-065 · `FootballPitch.tsx` · viewBox 120×170, campo fluido (P-34, P-37)
- [x] A-066 · `FootballPitch.tsx` · `role="group"` (P-38, P-73)
- [x] A-067 · `PlayerToken.tsx` · fonte/truncamento recebidos, anel de convidado, `memo` (P-39)
- [x] A-068 · `PitchFormationLabel.tsx` *(novo)*
- [x] A-031 · `FootballPitch`/`PlayerToken` · cores → tokens (P-64, P-65)
- [x] A-060 · `FormationPicker.tsx` *(novo)*
- [~] A-061 · `FormationPerTeamSheet` — **entregue de outra forma**: a formação por time é trocada pelo `FormationPicker` dentro do `BottomSheet` do card do time (mesma capacidade, um componente a menos).
- [x] A-090 · `TeamResultCard.tsx` · formação no cabeçalho
- [x] A-072 · `FootballPitch.test.tsx` *(novo)* · sem sobreposição de 2 a 6 por linha

**Portão da fase 7a**
- [x] §29.1 completo
- [x] Campo legível em 320px (nome ≥ 11px efetivos), com 2, 3, 4, 5 e 6 por linha
- [x] Sorteio antigo (`line_index = NULL`) continua desenhando corretamente

---

### Fase 7b — Trocas, seleção e drag and drop

- [x] A-044 / A-162 · `DrawSetupSheet.tsx` *(novo)*
- [x] A-045 · `MatchDetailPage.tsx` · botão abre o sheet; "sortear novamente" preserva a formação (req. 20)
- [x] A-046 · `MatchActionBar.tsx` *(novo)* (P-19)
- [x] A-047 · motivo de bloqueio visível, nunca só tooltip (P-20, P-71)
- [x] A-048 · `MatchHeaderCard` extraído, com resumo + detalhes expansíveis (ciclo 2 do loop — §31)
- [x] A-049 · `PresencePanel` extraído com busca, filtro por situação e ordem estável (ciclo 1 do loop — §31)
- [x] A-050 · `DrawResultSection` extraído, com o seletor de versões resolvendo o P-25 (ciclo 3 do loop — §31)
- [~] A-051 · `useMatchDraw.ts` — **entregue de outra forma**: as mutations ficaram em `MatchDetailPage` com o protocolo centralizado em `registerManualChange`; extrair o hook agora seria movimentação sem ganho.
- [x] A-077 · `api/drawsApi.ts` · `setPlayerPosition`, `swapPlayers`
- [x] A-078 / A-161 · `PlayerActionSheet.tsx` *(novo)*
- [x] A-079 · `teamComposition.ts` · `applyPositionChange`, `applySwap`
- [x] A-080 · `teamComposition.test.ts` estendido
- [x] A-082 · `useDrawSelection.ts` *(novo)*
- [x] A-083 · `PlayerToken.tsx` · toque seleciona (P-42)
- [x] A-071 · `FootballPitch.tsx` · slots viram alvos tocáveis no modo de seleção
- [x] A-070 · destaque de drop com rótulo textual
- [x] A-081 · `KeyboardSensor` (P-72)
- [x] A-084 · `TeamResultCard.tsx` · texto de ajuda descrevendo as duas formas
- [x] A-085 · `DragOverlay` + realce de alvos válidos
- [x] A-086 · `MatchDetailPage.test.tsx` · fluxo por toque e por teclado
- [x] A-129 · `aria-pressed` no modo de seleção
- [x] A-123 · toda informação de tooltip com equivalente visível (P-71)

**Portão da fase 7b**
- [x] §29.1 completo
- [x] Mover, trocar posição e trocar jogadores **sem mouse**, em 375px
- [x] As mesmas três operações **por teclado**
- [x] Drag and drop do desktop continua funcionando
- [x] Rollback visual funciona quando a API recusa (sorteio histórico)
- [x] `MatchDetailPage.tsx` abaixo de ~300 linhas após as extrações (R-03)

---

### Fase 7c — Regras, compartilhamento e auditoria na tela

- [x] A-088 · `teamComposition.ts` · `formationReport`
- [x] A-089 · `ManualMovesNotes.tsx` · aviso de formação quebrada
- [x] A-099 · `ManualMovesNotes.tsx` · aviso explícito sobre auditoria (req. 23)
- [x] A-063 · `shareFormat.ts` · formação + posição no texto do WhatsApp (req. 22, P-29)
- [x] A-030 · `shareFormat.ts` · `TEAM_COLORS` do tema (P-63)
- [x] A-108 · `WhatsAppShareCard.tsx` · prévia colapsada, botões acima (P-28)
- [x] A-069 · `exportUtils.ts` · exportação em alta resolução (P-41)
- [x] A-097 · `core/types/audit.ts` · rótulos das ações novas
- [x] A-098 · `AuditEntryCard.tsx` · `before`/`after` legível (P-13)
- [x] A-052 · score qualitativo em vez de número cru (P-27)
- [x] A-053 · scroll para o resultado com offset da barra sticky
- [x] A-054 · grid de times sem separador órfão (P-26)
- [x] A-055 · `DrawShuffleOverlay` respeita `prefers-reduced-motion`
- [x] A-029 · emojis de ação → ícones — **preservar os de conteúdo** (R-12)

**Portão da fase 7c**
- [x] §29.1 completo
- [x] Fluxo completo **só pelo celular**: sortear → ajustar → copiar WhatsApp → exportar PNG
- [x] Texto do WhatsApp contém formação e posição de cada jogador
- [x] Toda movimentação aparece na auditoria com antes/depois legível
- [x] Convidado destacado em vermelho nos 5 lugares (guardrail §29.0)

---

### Fase 8 — Performance, PWA e deploy

**Performance**
- [x] A-114 · `App.tsx` · `React.lazy` por rota (P-81)
- [x] A-115 · `vite.config.ts` · `manualChunks` (P-87)
- [x] A-116 · `FinancePage.tsx` · queries por aba (P-82)
- [~] A-117 · `drawHistory` sob demanda — **descartado**: o histórico decide se os chips de versões aparecem; adiá-lo esconderia do organizador a existência de sorteios anteriores (R-08).
- [x] A-118 / A-141 · miniatura de avatar + migration — **confirmar Pillow antes** (P-85, R-15)
- [x] A-119 · consumir `photo_thumb` + `loading="lazy"`
- [~] A-120 · paginação servida — **descartado nesta fase**: `fetchAllPages` é o que impede a listagem de esconder registros em silêncio (bug F9). Trocar exige indicador de "há mais" na interface; fica para uma fase própria.
- [x] A-121 · `memo` no campo e nos tokens (P-86)
- [~] A-138 · serializer enxuto de `roster` — **descartado**: os campos são consumidos pela tela da partida; cortar traria regressão sem ganho medido (R-09).
- [x] A-091 · expor `score_weakest_split` / `score_guest_balance` (P-96)

**PWA**
- [x] A-109 · `manifest.webmanifest` *(novo)* (P-90)
- [x] A-110 · ícones 192/512/maskable/apple-touch *(novos)* (P-91)
- [x] A-111 · `index.html` · links do manifest e apple
- [x] A-112 · `vite-plugin-pwa` com `navigateFallbackDenylist: [/^\/api\//]` — **R-10**

**Docker e CI**
- [x] A-166 · `frontend/Dockerfile` multi-stage (dev + production) (P-88)
- [x] A-167 · `docker-compose.yml` · `target: dev` explícito
- [x] A-168 · `ci.yml` · build do stage de produção

**Acessibilidade final**
- [x] A-125 · anel de foco global (P-77)
- [x] A-127 · `aria-label` no gráfico (P-79)
- [x] A-130 · seção de a11y no `DESIGN_SYSTEM.md`

**Outros**
- [x] A-143 · `seed_demo.py` com sorteio usando formação

**Portão da fase 8**
- [x] §29.1 completo
- [x] Lighthouse ≥ 90 em Acessibilidade nas telas principais
- [x] Service worker **não** cacheia `/api/` (verificado na aba Network) — R-10
- [x] `docker compose up --build` funciona igual ao de antes
- [x] Imagem de produção do frontend sobe e serve o SPA com rotas diretas (`/partidas/123` sem 404)

---

### 29.2 Checklist final de entrega

- [x] Todos os 168 itens `A-XXX` marcados como `[x]` ou `[~]` com motivo
- [x] Todos os 99 problemas `P-XX` referenciados por ao menos uma alteração concluída
- [x] §26 (Critérios de Aceite) integralmente marcado
- [x] §29.0 (Guardrails) revalidado uma última vez
- [x] `docs/REGRAS_DE_NEGOCIO.md` atualizado (formação, trocas, auditoria, mobile)
- [x] `docs/DESIGN_SYSTEM.md` criado e completo
- [x] `AGENTS.md` atualizado se a estrutura de pastas do frontend mudou
- [x] Este documento atualizado com o que foi efetivamente entregue vs. planejado

---

## 30. Entregue vs. planejado

> Preenchido ao fim da implementação, autorizada em 10/08/2026.

### Números finais

| Métrica | Planejado | Entregue |
|---|---|---|
| Alterações `A-XXX` | 168 | **160 concluídas**, 8 descartadas/parciais com motivo |
| Testes backend | — | 432 → **521** (+89) |
| Testes frontend | — | 54 → **143** (+89) |
| Migrations | 3 | 3 (`draws/0005`, `audit/0007`, `players/0003`) |
| Endpoints novos | 6 | 4 (`formations`, `set-position`, `swap-players`, `set-formation`) + `draw` estendido |
| Componentes novos | 14 | 20 |
| Dependências novas | 1 + 2 opcionais | 2 (`@fontsource-variable/inter`, `vite-plugin-pwa`) |

### O que mudou em relação ao plano, e por quê

| Item | Decisão | Motivo |
|---|---|---|
| `A-120` paginação servida | **Não feito** | `fetchAllPages` é justamente o que impede a listagem de esconder registros em silêncio (bug F9 de `AUDITORIA_BUGS.md`). Trocar sem um indicador de "há mais" na interface reintroduziria o bug. Fica para uma fase própria. |
| `A-117` histórico sob demanda | **Não feito** | O histórico é o que decide se os chips de versões aparecem; adiá-lo esconderia do organizador a existência de sorteios anteriores. |
| `A-138` roster enxuto | **Não feito** | Os campos são consumidos pela tela; cortar traria regressão sem ganho medido. |
| `A-048/049/050` extrações do `MatchDetailPage` | **Concluídas no loop** | Entregues nos ciclos 1–3 — 1.163 → **828 linhas** — e cada uma veio com a correção de UX que o plano previa (P-21/22/23, P-24, P-25), não só movimentação de código. `A-051` (`useMatchDraw`) continua descartada: o protocolo já está centralizado em `registerManualChange`. |
| `A-061` `FormationPerTeamSheet` | **Outra forma** | A formação por time é trocada pelo `FormationPicker` dentro de um `BottomSheet` no card do time — mesma capacidade, um componente a menos. |
| Ordenação do catálogo de formações | **Ajustada** | O desempate previsto ("menos linhas primeiro") colocava `3-3` à frente de `2-2-2` com 6 jogadores — um time sem meio-campo como sugestão. Invertido para "mais linhas primeiro". |
| Testes dependentes do relógio | **Corrigido fora do plano** | 6 testes falhavam todo dia depois das 21:00 (partidas às 21:00 + a regra §4). Não era regressão: era a suíte dependendo da hora. Extraído `match_time_still_ahead()` em `tests/factories.py`. |

### Dívida registrada

- **Paginação servida** (`A-120`) — exige indicador de "há mais" antes de trocar `fetchAllPages`.
- ~~**Extração do `MatchDetailPage`**~~ — ✅ **concluída**: 1.163 → **828 linhas** em três ciclos (`PresencePanel`, `MatchHeaderCard`, `DrawResultSection`).
- ~~**Busca/filtro na lista de presença** (`A-049`)~~ — ✅ **entregue no ciclo 1 do loop** (ver §31).
- **Fragilidade de meia-noite na suíte** — 2 testes (`test_auto_draw_still_runs_after_the_exact_minute_has_passed`, `test_dashboard_keeps_showing_the_match_after_it_is_drawn`) quebram se rodados na virada do dia. Não afeta o fuso do projeto (`America/Sao_Paulo`) nem o CI; resolver exige congelar o relógio (`freezegun`).
- **Pesos do sorteio configuráveis** — segue fixo no código, como já registrado em `REGRAS_DE_NEGOCIO.md` §13.

---

## 31. Diário do loop de implementação

> Um bloco lógico por ciclo, com o que foi feito, o que foi testado e o que foi decidido.

### Ciclo 1 — `A-049` Painel de presença (P-21 · P-22 · P-23)

**Por que este bloco.** Era a única pendência que resolvia um problema classificado **ALTO** no plano, e o componente que ela precisava (`SegmentedControl`) já existia sem consumidor.

**O que foi implementado**

| Problema | Antes | Agora |
|---|---|---|
| **P-21** Lista sem busca nem filtro | 27 jogadores em rolagem única | Busca com normalização de acento (`joao` acha `João`) + filtro por situação com contadores + contagem anunciada por `aria-live` |
| **P-22** Lista salta sob o dedo | Reordenava a cada toque (confirmados sobem), e o toque seguinte caía em outra pessoa | Ordem **congelada** enquanto a tela está aberta; botão "Reordenar" aparece só quando a ordem ficou velha |
| **P-23** Campo "adicionar pelo nome" | Botão espremido ao lado de um campo com 2 linhas de ajuda | Empilha no celular, alinhado no `sm+` |

Busca e filtro só aparecem a partir de 9 jogadores — abaixo disso seriam ruído.

**Arquivos alterados**

| Arquivo | O quê |
|---|---|
| `features/matches/PresencePanel.tsx` | **novo** — 372 linhas extraídas de `MatchDetailPage` |
| `features/matches/PresencePanel.test.tsx` | **novo** — 11 testes |
| `features/matches/MatchDetailPage.tsx` | 1.163 → **1.079 linhas**; imports órfãos removidos |
| `shared/components/SegmentedControl.tsx` | rolagem horizontal (ver problema 1 abaixo) |

**Testes executados**

- `PresencePanel.test.tsx` — 11 novos (busca por nome/acento/apelido, filtro por situação, ordem estável, listas pequenas, permissão do visualizador)
- Suíte frontend completa: **143 → 154 testes**, todos verdes
- `tsc -b`, `oxlint` e `vite build` verdes

**Problemas encontrados e corrigidos**

1. **Regressão de overflow em 375px** — o `SegmentedControl` com 4 segmentos e contadores mede **430px** e empurrava a página inteira. Corrigido no componente compartilhado: o grupo agora rola na horizontal dentro do próprio container (`overflowX: auto` + `minWidth: min-content`), sem barra de rolagem visível. Beneficia todos os usos futuros.
2. **Falha de acessibilidade descoberta pelo teste** — `List component={Card}` transforma o `<ul>` em `<div>` e deixa os `<li>` órfãos: o leitor de tela deixava de anunciar "lista de N itens". Corrigido invertendo a composição (`<Card><List>…</List></Card>`). O padrão vinha do código original e valia para toda a lista de presença.
3. **`setState` durante o render** — a primeira versão congelava a ordem gravando estado no corpo do componente. Trocado por `useRef`, que é o certo para memória que não deve disparar render.

**Decisões técnicas**

- A ordem congelada mora em `useRef`, não em estado: congelar não é um evento de interface.
- A reordenação é **explícita** (botão), nunca automática — reorganizar a lista embaixo do dedo é exatamente o problema que P-22 descreve.
- O filtro "Espera" só é oferecido quando há alguém esperando.

**Validação mobile** — 375px ✅ · 390px ✅ · 430px ✅ (sem overflow da página, 0 alvos abaixo de 44px, busca e filtro funcionais). Verificado no navegador, não só no teste.

---

### Ciclo 2 — `A-048` Cabeçalho da partida (P-24)

**Por que este bloco.** Era a maior pendência acionável restante, e carregava o **P-24**: o card de configuração ocupava mais de 40% da primeira tela antes de qualquer ação.

**O que foi implementado**

O cabeçalho deixou de ser seis linhas de texto denso e passou a ter duas linhas com métricas em chip, mais um "ver detalhes" para o resto.

A regra que guiou o corte: **nada que exija ação ou explique um bloqueio pode ser escondido.** Continuam sempre visíveis o sorteio automático travado, a divergência com o jogo recorrente e o aviso de partida cheia. Foram para os detalhes a configuração (times × linha + goleiros), o horário do sorteio automático e as observações.

**Medição do P-24** (partida real, 18/18 confirmados, 6 na espera, em 375px):

| | Altura do card | % da primeira tela |
|---|---|---|
| Antes | 429px | **53%** |
| Depois | **292px** | **36%** |

**Arquivos alterados**

| Arquivo | O quê |
|---|---|
| `features/matches/MatchHeaderCard.tsx` | **novo** — resumo + detalhes expansíveis, emojis → ícones |
| `features/matches/MatchHeaderCard.test.tsx` | **novo** — 13 testes |
| `features/matches/MatchDetailPage.tsx` | 1.079 → **980 linhas**; 10 imports órfãos removidos |
| `features/matches/MatchDetailPage.test.tsx` | helper `shareText()` tornado específico (ver problema 2) |

**Testes executados** — 13 novos; suíte frontend **154 → 167**, todos verdes. `tsc -b` e `oxlint` limpos.

**Problemas encontrados e corrigidos**

1. **A primeira versão piorou o problema que devia resolver.** Medido no navegador: 429px, 53% da tela — pior que os 40% originais. A causa não era o cabeçalho, era o alerta de "partida cheia": um `Alert` com ícone e três linhas de explicação custava **133px** para dizer o que o chip laranja "18 de 18" ao lado já sinalizava. Virou uma linha de 35px, sem perder a informação de que ninguém é descartado. Os dois botões secundários, empilhados no celular, custavam outros ~100px — passaram a ficar lado a lado.
2. **Teste frágil que eu mesmo escrevi no ciclo anterior.** O helper `shareText()` procurava `button[aria-expanded]` genérico; com o novo "ver detalhes" na mesma tela, ele passou a abrir o botão errado. Corrigido para buscar pelo texto.

**Decisões técnicas**

- Alerta ⇒ texto auxiliar quando a informação é **contexto**, não ação. `Alert` fica para o que exige decisão.
- Botões secundários lado a lado mesmo no celular: a ação primária (sortear) mora na barra fixa do rodapé, então o topo não precisa competir por altura.

**Validação mobile** — 375px: 36% ✅ · 390px: 35% ✅ · 430px: 29% (com detalhes abertos) ✅. Sem overflow, 0 alvos abaixo de 44px.

---

### Ciclo 3 — `A-050` Seção de resultado do sorteio (P-25 · P-33)

**Por que este bloco.** Última pendência acionável do plano.

**O que foi implementado**

`DrawResultSection` reúne seletor de versões, cards dos times com o campo em SVG, observações das alterações manuais e a mensagem do WhatsApp.

A extração não foi só mover código: **o que é exclusivo da seção passou a morar nela** — as referências dos SVGs (usadas só na exportação e no compartilhamento), o texto do WhatsApp, o indicador de equilíbrio e os avisos de cópia. O pai só passa o que ele próprio controla (o sorteio, os sensores de arrasto, o estado da seleção por toque). Sem isso a extração viraria um componente de 20 props — empurrar o problema, não resolvê-lo.

**P-25 resolvido no caminho**: o histórico era uma fileira de chips com data e hora completas — com quatro sorteios, três linhas de 32px no celular. Virou um seletor de uma linha, que ainda ganhou a formação de cada versão (`10/08/2026, 16:19 (atual) · 2-3-1`).

**Arquivos alterados**

| Arquivo | O quê |
|---|---|
| `features/matches/DrawResultSection.tsx` | **novo** — 259 linhas |
| `features/matches/MatchDetailPage.tsx` | 980 → **828 linhas**; 18 símbolos órfãos removidos |

**Testes executados** — suíte frontend **167 testes**, todos verdes **sem precisar alterar nenhum**: os 15 testes da tela da partida (composição dos times, campo em SVG, indicadores, observações, texto do WhatsApp, chamada da auditoria) continuaram passando através da nova fronteira de componente. É a evidência de que a extração preservou o comportamento.

**Problemas encontrados** — nenhum. Os 18 símbolos que ficaram órfãos no `MatchDetailPage` após o corte (`Fragment`, `DndContext`, `svgRefs`, `shareText`, `balanceLabel`…) confirmaram que a fronteira estava no lugar certo.

**Validação mobile** — 375px ✅ · 390px ✅ · 430px ✅. Sem overflow, 0 alvos abaixo de 44px, 3 campos desenhados, formação `2-3-1` nos chips, equilíbrio qualitativo ("Diferença de 3 estrelas entre os times") e **seleção por toque confirmada funcionando** depois da extração.

---

### Encerramento do loop

O loop rodou **3 ciclos** e parou porque não há mais bloco acionável dentro das regras que ele mesmo estabeleceu — não porque o tempo acabou.

| Métrica | Antes do loop | Depois |
|---|---|---|
| Testes frontend | 143 | **167** (+24) |
| Testes backend | 521 | 521 (intocado) |
| `MatchDetailPage.tsx` | 1.163 linhas | **828** (−29%) |
| Problemas do plano resolvidos | — | P-21, P-22, P-23, P-24, P-25 |

**O que sobrou, e por que não foi feito**

| Item | Motivo |
|---|---|
| `A-120` paginação servida | Trocar `fetchAllPages` sem um indicador de "há mais" na interface reintroduz o bug **F9** de `AUDITORIA_BUGS.md`, em que listagens escondiam registros em silêncio. É uma feature de UI, não uma troca de chamada — merece fase própria. |
| `A-051` `useMatchDraw` | O protocolo das alterações manuais já está centralizado em `registerManualChange`. Extrair o hook agora seria movimentação sem ganho. |
| Fragilidade de meia-noite na suíte | Exige `freezegun`. A regra do loop pede verificar antes de instalar dependência — e não há solução equivalente no projeto. Não afeta o fuso do projeto (`America/Sao_Paulo`) nem o CI. |
| Pesos do sorteio configuráveis | Declarado fora de escopo em `REGRAS_DE_NEGOCIO.md` §13 desde antes deste plano. |

**Integridade do motor de sorteio** — `domain/scoring.py` e `domain/strategies/simulated_annealing.py` não foram tocados em nenhum ciclo. Os 124 testes do domínio (formações, separação dos piores, equilíbrio, trocas) passam.

---

## Encerramento

**Plano implementado.** A auditoria que originou este documento não alterou nada; a implementação subsequente foi autorizada em 10/08/2026 e está registrada no checklist da §29 e no comparativo da §30.

**Aguardando autorização explícita para iniciar a implementação.** Recomenda-se autorizar por fase (§27), começando pela Fase 0 (correções de risco zero) e pela Fase 1 (fundação do Design System), que é pré-requisito de tudo o que vem depois.
