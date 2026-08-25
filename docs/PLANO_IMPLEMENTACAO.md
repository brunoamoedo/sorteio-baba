# Plano de Implementação — Evolução para SaaS Profissional

> Documento vivo de planejamento e acompanhamento. Cada fase é marcada como concluída aqui, e a documentação em `/docs` (principalmente [`REGRAS_DE_NEGOCIO.md`](./REGRAS_DE_NEGOCIO.md) e [`REQUISITOS.md`](./REQUISITOS.md)) é atualizada junto, ao final de cada fase.
>
> **Status geral (revisado em 14/08/2026, conferindo o plano contra o código):**
> F0 Auditoria ✅ · F1 Design System ✅ · F2 Partidas Manuais & Jogos Recorrentes ✅ · F3 Fila de Espera ✅ · Auditoria de Correções ✅ · F4 Resultado do Sorteio ✅ · **F5 Sorteio Avulso ✅** · **F6 Sorteio Público ⏳ não iniciada** · F7 Mensalidades ✅ **entregue por outro caminho** (ver nota abaixo) · F8 Dashboard 🟡 parcial · F9 Responsividade/Performance/Acessibilidade 🟡 parcial · F10 Testes ✅
>
> **Próxima: F5 (Sorteio Avulso).**
>
> ⚠️ **A F7 deste plano foi superada.** O módulo financeiro não foi construído com os models `Payment` + `PlayerMonthlyAdjustment` + `OrganizationSettings` desenhados aqui: ele nasceu maior, no app `apps/finance/`, com competência, congelamento de valor histórico, multa, soft-delete e auditoria append-only. A fonte da verdade do que existe é [`REGRAS_DE_NEGOCIO.md`](./REGRAS_DE_NEGOCIO.md) §14 e os planos [`PLANO_IMPLEMENTACAO_FINANCEIRO_CONFIRMACOES.md`](./PLANO_IMPLEMENTACAO_FINANCEIRO_CONFIRMACOES.md) e [`PLANO_IMPLEMENTACAO_MENSALIDADES_LOGINS.md`](./PLANO_IMPLEMENTACAO_MENSALIDADES_LOGINS.md) — **não** a §10/F7 abaixo, mantida como registro do desenho original.
>
> Baseline de qualidade atual (14/08/2026): **723 testes backend** e **250 testes frontend** passando, `ruff check` limpo, `tsc --noEmit` limpo, `npm run lint` sem erro, `npm run build` verde.
>
> A rodada de auditoria e correções está registrada em [`AUDITORIA_BUGS.md`](./AUDITORIA_BUGS.md) — 39 achados mapeados, causa raiz e correção de cada um.

---

## Sumário

0. [Visão Geral e Objetivos](#0-visão-geral-e-objetivos)
1. [Arquitetura](#1-arquitetura)
2. [Auditoria Técnica](#2-auditoria-técnica)
3. [Observações sobre a Documentação Existente](#3-observações-sobre-a-documentação-existente)
4. [Decisões de Arquitetura para a Evolução](#4-decisões-de-arquitetura-para-a-evolução)
5. [Design System](#5-design-system)
6. [Backend — Detalhamento por Módulo](#6-backend--detalhamento-por-módulo)
7. [Frontend — Detalhamento](#7-frontend--detalhamento)
8. [Banco de Dados — Detalhamento](#8-banco-de-dados--detalhamento)
9. [Roadmap e Cronograma](#9-roadmap-e-cronograma)
10. [Funcionalidades, Critérios de Aceite e Checklists](#10-funcionalidades-critérios-de-aceite-e-checklists)
11. [Decisões Confirmadas e Perguntas em Aberto](#11-decisões-confirmadas-e-perguntas-em-aberto)

---

## 0. Visão Geral e Objetivos

### 0.1 O que é o sistema

SaaS multi-tenant para organização de "peladas" de futebol. Cada organização (pelada) gerencia seus jogadores, seus jogos recorrentes, a confirmação de presença de cada partida e — o núcleo do produto — o **sorteio inteligente de times equilibrados** por Simulated Annealing, com auditoria completa, histórico e estatísticas.

Público-alvo: o organizador da pelada (papel Organizador/Admin) e os jogadores (papel Visualizador ou acesso público futuro).

### 0.2 Estado atual (o que já funciona hoje)

As Fases 0–7 do projeto original (ver [`REQUISITOS.md`](./REQUISITOS.md)) estão concluídas: multi-tenancy, papéis/permissões, CRUD de jogadores, jogos recorrentes com geração automática de partidas, confirmação de presença (manual e por lista de nomes colada do WhatsApp), motor de sorteio, times com campo em SVG e drag-and-drop, auditoria append-only, placar e estatísticas, tema claro/escuro e Swagger. Detalhamento funcional em [`REGRAS_DE_NEGOCIO.md`](./REGRAS_DE_NEGOCIO.md).

### 0.3 Objetivos desta evolução

1. **Elevar a qualidade visual e de UX** ao nível de um produto comercial (referências: Stripe, Linear, Notion, Vercel) — via Design System próprio sobre o MUI, sem trocar a base tecnológica.
2. **Cobrir os buracos operacionais** que hoje obrigam o organizador a improvisar: partida avulsa/manual, fila de espera quando lota, controle de mensalidades.
3. **Ampliar o alcance**: página pública do sorteio (sem login, com QR code) para divulgação no grupo.
4. **Manter tudo que já funciona**: nenhuma regra de negócio existente muda silenciosamente; toda alteração de comportamento entra com o comportamento atual como valor padrão.
5. **Manter a documentação técnica viva** — este arquivo, `REGRAS_DE_NEGOCIO.md` e `REQUISITOS.md` atualizados ao fim de cada fase.

### 0.4 Não-objetivos (fora de escopo)

- App mobile nativo (Expo) — a API e a camada `core/` do frontend continuam preparadas, mas o app não é construído aqui.
- Cobrança automatizada/gateway de pagamento (o módulo de mensalidades é **controle**, não processamento de pagamento).
- WebSocket/Django Channels (a página pública usa polling; ver seção 11).
- Migração para Tailwind/shadcn (ver seção 4, decisão 1).

---

## 1. Arquitetura

### 1.1 Visão macro

```
┌──────────────┐    REST/JSON + JWT     ┌──────────────────┐
│  Frontend    │  X-Organization-Id     │  Django + DRF    │
│  React/Vite  │ ─────────────────────► │  (API-only)      │
│  TS + MUI    │                        └────────┬─────────┘
└──────────────┘                                 │
                                        ┌────────┴─────────┐
                                        │   PostgreSQL     │
                                        └──────────────────┘
                                                 │
                                   ┌─────────────┴──────────────┐
                                   │  Celery + Celery Beat      │
                                   │  (Redis como broker)       │
                                   │  · generate_upcoming_matches│
                                   │  · auto_draw_tick (1/min)  │
                                   └────────────────────────────┘
```

### 1.2 Backend — camadas

| Camada | Onde vive | Responsabilidade |
|---|---|---|
| Domínio puro | `apps/draws/domain/` | Algoritmo de sorteio: dataclasses e estratégias **sem nenhuma dependência de Django**. Testável isoladamente. |
| Services | `apps/*/services.py` | Regras de negócio e orquestração transacional. Único lugar que escreve regra. |
| Repositories | `apps/*/repositories.py` | Consultas complexas reutilizáveis (ex.: `PairHistoryRepository`). |
| Validators | `apps/matches/validators.py` | Validações de configuração reutilizadas por serializers e services. |
| Serializers/Views | `apps/*/serializers.py`, `views.py` | Contrato HTTP. Views não contêm regra de negócio — delegam a services. |
| Infra comum | `common/` | `BaseModel`/`OrganizationOwnedModel` (soft-delete), permissions por papel, mixins de escopo multi-tenant, paginação, exceções. |

**Isolamento multi-tenant** (a defesa mais importante do sistema): `HasOrganizationContext` resolve a organização a partir do JWT + header `X-Organization-Id`, valida contra `Membership` ativa e injeta em `request.organization`. `OrganizationScopedViewSetMixin` filtra todo queryset por ela e injeta na criação. A organização **nunca** vem do corpo da requisição.

### 1.3 Frontend — camadas

| Camada | Pasta | Responsabilidade |
|---|---|---|
| `core/` | tipos, `httpClient`, storages, `fieldLayout` | Lógica agnóstica de plataforma — reaproveitável por um app Expo. |
| `platform/` | storages web | Implementações específicas de web (localStorage). |
| `api/` | `*Api.ts` | Um módulo por domínio, tipado, sobre o `apiClient` (Axios com interceptors de JWT/organização). |
| `features/` | por domínio | Páginas e componentes de feature. |
| `shared/` | `components/`, `layout/`, `theme/` | Design System: componentes genéricos e tema. |
| `routes/` | guards | `ProtectedRoute` (autenticado) e `RequireOrganization` (organização selecionada). |

Estado de servidor é sempre React Query (nunca duplicado em `useState`); formulários são React Hook Form.

---

## 2. Auditoria Técnica

> Auditoria original feita na Fase 0 e **revalidada linha a linha nesta revisão** (todos os models/services/views/serializers de `accounts`, `players`, `matches`, `draws`, `audit`, `statistics`, `common`; todas as páginas e componentes do frontend; `docker-compose.yml`; `config/settings/base.py`; suíte de testes). Itens já resolvidos aparecem marcados.

### 2.1 Arquitetura e Organização — ✅ Sólida

- O `domain/` do motor de sorteio é 100% framework-agnostic (dataclasses puras, sem Django) — cumpre o requisito de Clean Architecture e não precisa ser tocado pelas novas features.
- Multi-tenancy por `organization_id` + header, com permission classes por papel, funcionando e coberto por testes.
- Padrão de app Django por domínio está limpo e será **mantido**: features novas entram como apps novos (`finance`) ou extensões pontuais em apps existentes (fila de espera em `matches`).
- **Achado**: não há camada `Repository` explícita em `matches`/`draws` além de `PairHistoryRepository` — services acessam o ORM diretamente. Não é problema hoje (é simples e testável); a decisão é **manter esse nível de simplicidade** também no módulo financeiro, em vez de introduzir uma camada só para ele (inconsistência pior que a ausência).

### 2.2 Performance

- **Achado**: `get_player_statistics` carrega **todos** os jogadores e **todos** os `TeamPlayer`/`Confirmation` da organização em memória a cada request — sem cache, sem paginação. Rápido hoje; não escala indefinidamente. → Fase 9.
- **Achado**: `MatchViewSet.roster` retorna **todos** os jogadores ativos sem paginação e instancia um `PlayerSerializer` por jogador. Aceitável para dezenas de jogadores; monitorar.
- Sem N+1 grave identificado: `MatchViewSet.queryset` já usa `select_related`/`prefetch_related`.
- **Achado**: `matchesApi.list` lê apenas `data.results` da primeira página (`page_size = 20`). Com mais de 20 partidas, a tela de Partidas **silenciosamente esconde** as mais antigas. → tratado na Fase 2 (ordenação/filtro) e definitivamente na Fase 9 (paginação real no `DataTable`).
- Frontend não usa `React.memo`/virtualização — sem impacto no volume atual.
- **Sem cache de aplicação** (Redis existe no compose, mas só como broker do Celery).

### 2.3 Banco de Dados

- Modelagem consistente: todo model de negócio herda `BaseModel` (soft-delete) ou `OrganizationOwnedModel`. **Mantido** em todos os models novos.
- **Achado**: `Confirmation` tem `UniqueConstraint(fields=["match", "player"])` **sem** `condition=Q(is_deleted=False)` (diferente de `Match`, que tem). Uma confirmação soft-deletada e recriada para o mesmo par colidiria no banco. Hoje não ocorre porque `set_confirmation` nunca deleta — mas é inconsistência a corrigir quando a fila de espera mexer nesse model. → Fase 3.
- **Achado**: `Confirmation` herda `BaseModel` (sem `organization`), escopo garantido apenas via `match`. Correto e intencional, mas significa que qualquer consulta direta a `Confirmation` **precisa** passar por `match`/`player` para não cruzar organizações. Documentado aqui para não ser esquecido em features novas.
- Índices: só existe índice explícito em `AuditLog (organization, -created_at)`. Adequado hoje; ao crescer `Confirmation`/`TeamPlayer`/`Payment`, criar índices nas FKs de consulta frequente.
- Sem particionamento/arquivamento — desnecessário no estágio atual.

### 2.4 APIs

- Padrão RESTful consistente (`ModelViewSet` + `@action` para operações não-CRUD) — **manter** para os endpoints novos.
- Paginação, filtro, busca e ordenação configurados globalmente; Swagger via `drf-spectacular` funcionando; throttling global (1000/dia usuário, 100/dia anônimo).
- **Achado**: `MatchViewSet` já é um `ModelViewSet` completo — criar partida avulsa via `POST /api/matches/` **já funcionava pela API**, mas não havia nenhuma interface para isso e nenhum teste cobrindo. → resolvido na Fase 2.
- **Achado**: não existe nenhuma rota `AllowAny`. O link público do sorteio é a primeira necessidade desse tipo e exige namespace isolado (`/api/public/...`). → Fase 6.

### 2.5 Frontend — UX / UI / Design System

- ✅ **Resolvido na Fase 1**: tema aprofundado (paleta light/dark própria, tipografia Inter, escala de sombras, overrides de `Button`/`Card`/`Paper`/`Dialog`/`TextField`/`Chip`/`Table`/`AppBar`), skeleton loading padronizado no `DataTable`, componentes `PageHeader`/`StatusChip`/`ConfirmDialog`/`DataTable`/`FormDrawer`/`ToastProvider`, favicon de bola de futebol.
- **Pendente**: `DashboardPage` (Fase 8) e a tela de resultado do sorteio + `FootballPitch` (Fase 4) ainda não usam o Design System — decisão consciente, já que serão refeitas.
- **Pendente**: o verde fixo `#2e7d32` do campo SVG e cores hardcoded no gráfico de Estatísticas ignoram o modo escuro. → Fase 4/8.

### 2.6 Responsividade

- Há preocupação real com mobile (nav vira `Drawer` abaixo de `md`, campo SVG limitado a `maxWidth: 220`), mas sem verificação sistemática nos breakpoints alvo (320/375/390/768/1024/1440/4K). → Fase 9.
- **Achado concreto**: `MatchDetailPage` usa `Grid size={{ xs: 12, md: 12 / draw.teams.length }}` — com 5+ times gera frações não inteiras (12/5 = 2.4). Revisar na Fase 4.
- Tabelas não têm tratamento específico para telas pequenas — viram rolagem horizontal "crua". → Fase 9.

### 2.7 Segurança

- Isolamento multi-tenant bem implementado e testado (organização resolvida do token+header, nunca do corpo).
- JWT com rotação de refresh token e blacklist configurados.
- **Achado**: `SECRET_KEY` tem default inseguro (`insecure-dev-key-change-me`). Aceitável em dev; **obrigatório** trocar em produção — item de checklist de deploy, não de código.
- **Achado**: `.env` do backend está no repositório de trabalho (não versionado pelo `.gitignore`, verificado) — manter assim.
- **Achado**: a futura rota pública (Fase 6) é a primeira superfície sem autenticação — exige token não sequencial (UUID), somente leitura, e serializer dedicado que não vaze dado de jogador.
- **Achado**: anexo de comprovante (Fase 7) é o primeiro upload de arquivo arbitrário — exige validação explícita de extensão/mimetype/tamanho (`ImageField` do `Player.photo` já valida imagem; `FileField` não valida nada sozinho).

### 2.8 Escalabilidade

- Celery + Redis já estruturados; as tasks novas (lembrete de mensalidade, promoção de fila) não exigem infra nova.
- A página pública em tempo real é a única peça que exigiria infra nova (ASGI/Channels) — evitada pela decisão de usar polling (seção 11).

### 2.9 Código Duplicado / Componentes Reutilizáveis

| Padrão duplicado | Onde aparecia | Situação |
|---|---|---|
| Tabela com cabeçalho + estado vazio | `PlayersPage`, `RecurringGamesPage`, `MatchesPage`, `StatisticsPage`, `AuditLogPage` | ✅ Extraído para `shared/components/DataTable` (Fase 1) |
| Drawer de formulário lateral | `PlayerFormDrawer`, `RecurringGameFormDrawer` | ✅ Extraído para `shared/components/FormDrawer` (Fase 1) |
| Diálogo de confirmação de exclusão | `PlayersPage` | ✅ Extraído para `shared/components/ConfirmDialog` (Fase 1) |
| Chip de status colorido | várias páginas, com cores inline | ✅ Extraído para `shared/components/StatusChip` (Fase 1) |
| Cabeçalho de página | quase toda página | ✅ Extraído para `shared/components/PageHeader` (Fase 1) |
| Cálculo `teams_count × (linha + 1 goleiro)` | `RecurringGame.save()` e (novo) formulário de partida | ✅ Centralizado em `compute_player_bounds` (Fase 2) |
| `authenticated_client` nos testes | repetido em 6 arquivos de teste | ⚠️ Aberto — candidato a fixture compartilhada (Fase 10) |

### 2.10 Acessibilidade

- **Achado**: `aria-label` só existe em casos pontuais. Botões de ícone (exportar, imprimir, compartilhar) em `MatchDetailPage` não têm. → Fase 9 (e novos componentes já nascem com).
- Contraste não validado formalmente contra WCAG AA.
- Navegação por teclado funciona nativamente via MUI, mas não foi testada explicitamente. Nenhum teste com leitor de tela.

### 2.11 Testes

- Backend: 59 testes (pytest-django + factory_boy) cobrindo isolamento multi-tenant, permissões por papel, domínio do sorteio, tasks Celery, auditoria e estatísticas. Padrão bom e consistente.
- **Achado**: frontend **sem nenhum teste automatizado** (Vitest não configurado). Cobertura de UI é verificação manual no navegador a cada fase. → Fase 10.
- **Achado**: `MatchViewSet` não tinha testes de criação/edição/remoção de partida (só as `@action`s). → resolvido na Fase 2.

### 2.12 Resumo Priorizado

| # | Achado | Prioridade | Complexidade | Impacto | Dependências | Fase |
|---|---|---|---|---|---|---|
| 1 | Ausência de Design System | Alta | Média | Alto — base de tudo | — | ✅ 1 |
| 2 | Componentes duplicados | Alta | Baixa | Alto | #1 | ✅ 1 |
| 3 | Sem UI/testes para partida avulsa | Alta | Baixa | Alto — bloqueia Sorteio Avulso | #1 | ✅ 2 |
| 4 | Geração de partidas sem antecedência configurável | Média | Baixa | Médio | — | ✅ 2 |
| 5 | `Confirmation` unique constraint sem filtro de soft-delete | Média | Baixa | Médio | — | 3 |
| 6 | Sem rota pública/`AllowAny` | Alta (bloqueante p/ Fase 6) | Média | Alto | — | 6 |
| 7 | Upload de arquivo sem validação de tipo/tamanho | Alta (quando existir) | Baixa | Alto (segurança) | — | 7 |
| 8 | Estatísticas sem cache/paginação | Baixa hoje | Média | Baixo curto prazo | — | 9 |
| 9 | Listas lendo só a 1ª página da API | Média | Média | Médio | #1 | 9 |
| 10 | Acessibilidade não auditada | Média | Baixa (incremental) | Médio | — | 9 |
| 11 | Responsividade não testada sistematicamente | Média | Baixa | Médio | — | 9 |
| 12 | Frontend sem testes automatizados | Média | Média | Alto (regressão) | — | 10 |
| 13 | Cores fixas ignorando dark mode (campo SVG, gráficos) | Baixa | Baixa | Médio | #1 | 4/8 |

---

## 3. Observações sobre a Documentação Existente

Inconsistências e desatualizações encontradas ao reler `/docs` (corrigidas nesta revisão ou registradas para correção):

| # | Documento | Observação | Ação |
|---|---|---|---|
| 1 | `REQUISITOS.md` §3 | "Django 3.13+/Python" — confuso: o projeto usa **Python 3.13 + Django 5.1–5.2** (`requirements/base.txt`). | ✅ Texto corrigido |
| 2 | `REQUISITOS.md` §4 | Apontava o ERD completo para `C:\Users\...\.claude\plans\temporal-hugging-crane.md` — caminho **externo ao repositório e não versionado**; qualquer outro desenvolvedor perde a referência. | ✅ Referência trocada para a seção 8 deste plano |
| 3 | `REQUISITOS.md` §4 | Listava `OrganizationSettings` como model existente — **ele nunca foi criado**. | ✅ Marcado como planejado (Fase 7) |
| 4 | `REQUISITOS.md` (rodapé) | Dizia "54 testes automatizados" — eram 59 antes desta fase, **71 depois**. | ✅ Corrigido |
| 5 | `REQUISITOS.md` §2.11 | Dashboard prometido com "últimos sorteios, últimas alterações, resumo estatístico" — o dashboard atual só mostra próxima partida + 4 contadores. | ✅ Lacuna registrada no próprio requisito; entrega na Fase 8 |
| 6 | `REGRAS_DE_NEGOCIO.md` §6.2 | Citava a variável de ambiente `DRAW_PAIRING_HISTORY_WINDOW`; o setting Django correspondente chama-se `DRAW_DEFAULT_PAIRING_HISTORY_WINDOW`. Ambos estão certos (a env var é lida com o nome curto), mas a diferença confunde. | ✅ Texto esclarecido |
| 7 | `REQUISITOS.md` §2.3 | "Quantidade de times, mínimo e máximo configuráveis por partida" constava como entregue, mas não havia interface para criar/editar partida. | ✅ Resolvido na Fase 2 |

---

## 4. Decisões de Arquitetura para a Evolução

Princípios seguidos em todas as fases (compromisso explícito com "preservar tudo que já funciona"):

1. **Nenhum framework novo de UI.** A estética Stripe/Linear/Notion/Vercel é alcançada **aprofundando o tema do MUI** (tokens, overrides, tipografia, sombras) — **não** haverá Tailwind nem shadcn/ui. Adotar shadcn exigiria trocar toda a base de componentes (é Tailwind + Radix, incompatível com MUI) e contradiria a preservação da arquitetura. ✅ Confirmado com o usuário.
2. **Domínio novo → app Django novo** (`finance`); **domínio existente → extensão pontual** (fila de espera em `matches`, link público em `matches`/`draws`).
3. **Nenhuma regra de negócio existente muda silenciosamente.** Quando uma feature nova altera comportamento atual, o comportamento antigo vira o **valor padrão** do novo campo — instalações existentes não mudam sem configuração explícita. (Aplicado na Fase 2 com `days_before_to_generate`, default 7 = comportamento anterior.)
4. **Todo model novo segue o padrão existente**: `OrganizationOwnedModel` (multi-tenant + soft-delete) por padrão.
5. **Testes automatizados obrigatórios em todo endpoint/regra nova no backend** (pytest-django + factory_boy). Frontend ganha Vitest na Fase 10.
6. **Toda validação de configuração é reutilizada, nunca duplicada** — `validators.py` é a fonte única (aplicado na Fase 2: partida manual e jogo recorrente compartilham `compute_player_bounds` e as regras de `validate_*_config`).

### Novas dependências previstas

**Backend:** nenhuma obrigatória. A Fase 7 usa `FileField` nativo; a Fase 6 usa polling (sem Channels).
**Frontend:** `qrcode.react` (Fase 6) é o único pacote novo estritamente necessário. Animações usam os `Transition`/`Fade`/`Grow`/`Collapse` já inclusos no MUI.

---

## 5. Design System

Objetivo: uma base de tokens e componentes consumida por todas as telas, para nunca mais haver botão/card/tabela reinventado tela a tela.

### 5.1 Tokens (tema MUI estendido) — ✅ Fase 1

- **Cores**: paleta primária verde (identidade de futebol) + paleta neutra completa (fundo/superfície/borda para light e dark), semânticas revisadas para contraste.
- **Tipografia**: fonte Inter, escala completa `h1`–`h6`/`subtitle`/`body`/`caption`/`overline` com pesos 400/500/600/700.
- **Espaçamento**: unidade base 8px do MUI, uso padronizado (2/3/4 unidades entre seções, sem valores mágicos).
- **Elevação**: 25 níveis de sombra suave, substituindo as sombras "duras" do default.
- **Border radius**: 12px em cards, 8–10px em botões/inputs.

### 5.2 Componentes padronizados

| Componente | Situação |
|---|---|
| `Button`, `TextField`/`Select`, `Card`, `Paper`, `Dialog`, `Chip`, `Table`, `AppBar` | ✅ Overrides globais no tema (Fase 1) |
| `PageHeader` (título + ação primária) | ✅ Fase 1 |
| `StatusChip` (mapa central de tons; convidado sempre vermelho) | ✅ Fase 1 |
| `ConfirmDialog` | ✅ Fase 1 |
| `DataTable` (ordenação, skeleton, estado vazio, linha clicável) | ✅ Fase 1 |
| `FormDrawer` | ✅ Fase 1 |
| `ToastProvider`/`useToast` | ✅ Fase 1 |
| Paginação no `DataTable` | 🟡 Existe, mas é **no cliente** — a paginação server-side continua pendente (Fase 9) |
| `PageSkeleton` (skeleton fora de tabela: dashboard, detalhe) | ✅ Fase 8 |
| `BulkActionBar` + `useSelection` (seleção múltipla) | ✅ Plano de mensalidades/logins |
| `BottomSheet`, `FilterSheet`, `SegmentedControl`, `StatTile`, `OverflowMenu`, `AppActionBar` | ✅ Plano mobile |

### 5.3 Dark Mode

Revisão das cores fixas que hoje ignoram o modo (verde `#2e7d32` do campo, cores do gráfico de Estatísticas) para tokens do tema. ✅ Feito no plano mobile: `shared/theme/tokens.ts` é a fonte única e **não há hex solto em componente**.

### 5.4 Identidade Visual

- ✅ Favicon de bola de futebol e título "Sorteio da Pelada" (Fase 1).
- ✅ Revisão de ícones — `shared/icons/index.ts` é o mapa único; emoji só onde é **conteúdo** (mensagem de WhatsApp e marcadores de time), nunca como ícone de ação.

---

## 6. Backend — Detalhamento por Módulo

### 6.1 App `matches` — ✅ alterado na Fase 2

**`Match`** ganhou:
- `name` (opcional) — identificação de partida avulsa ("Racha de sábado", "Amistoso contra o time do bairro").
- `location` (opcional) — local do jogo.
- `notes` (opcional) — observações livres.
- `draw_time` (opcional) — horário do sorteio próprio da partida. Quando preenchido, **tem precedência** sobre o `draw_time` do jogo recorrente; quando vazio, herda o do recorrente (comportamento anterior preservado).
- `__str__` passa a usar `name` quando existir.

**`RecurringGame`** ganhou:
- `days_before_to_generate` (padrão **7**) — com quantos dias de antecedência a próxima partida é criada. O padrão 7 reproduz exatamente o comportamento anterior (recorrência semanal: a próxima ocorrência está sempre a ≤ 7 dias, então gerava-se assim que a anterior passava).

**Pendente (fases seguintes):**
- `Match.public_token` (UUID único) — **movido para a Fase 6**, junto da feature que o consome, para não criar coluna órfã.
- `Confirmation`: corrigir `UniqueConstraint` com `condition=Q(is_deleted=False)` → Fase 3.
- `WaitlistEntry` (`OrganizationOwnedModel`): `match`, `player`, `position` → Fase 3.

**Serviços:**
- ✅ `compute_player_bounds(teams_count, min_line, max_line)` — fonte única do cálculo `times × (linha + 1 goleiro)`, usada por `RecurringGame.save()` e pelo serializer de `Match`.
- ✅ `ensure_next_match` respeita `days_before_to_generate`.
- ✅ `promote_from_waitlist`, `move_waitlist_entry`, `remove_from_waitlist` (Fase 3).
- ⏳ `get_public_draw_data(token)` → **Fase 6, não iniciada**.

**Permissões:** `MatchViewSet` — leitura (`list`/`retrieve`/`roster`) para qualquer membro; escrita (incluindo `create`/`update`/`destroy`) para Organizador/Admin. Endpoints de fila seguirão o mesmo padrão. Endpoint público será `AllowAny` **somente leitura**, com serializer dedicado.

### 6.2 App `draws` — ✅ alterado na Fase 2

- `auto_draw_tick` passa a considerar **também partidas avulsas** (sem jogo recorrente) que tenham `draw_time` próprio. Horário efetivo = `match.draw_time or match.recurring_game.draw_time`; partidas sem nenhum dos dois são ignoradas (nunca sorteiam automaticamente).

### 6.3 App novo: `finance` (Fase 7 — Mensalidades)

**Decisão de produto (confirmada)**: o valor da mensalidade é um **valor padrão único da organização** com **duas faixas por data** (valor com desconto até o dia de vencimento; valor cheio depois), configurado na criação da organização e editável. Por jogador existem apenas dois ajustes: **isenção** e **ajuste pontual num mês** (acréscimo ou desconto) — não um valor mensal livre por jogador.

- **`OrganizationSettings`** (OneToOne com `Organization`): `fee_due_day`, `fee_discount_amount`, `fee_full_amount`. Criado com valores padrão na mesma transação de `register_organization`; editável só por Admin.
- **`PlayerMonthlyAdjustment`** (`OrganizationOwnedModel`): `player`, `reference_month`, `amount` (positivo ou negativo), `reason`.
- **`Payment`** (`OrganizationOwnedModel`): `player`, `reference_month`, `amount`, `paid_at`, `method` (PIX/dinheiro/cartão/transferência/outro), `notes`, `attachment` (`FileField` com validação de extensão e tamanho). **Múltiplos pagamentos por mês são permitidos** — o mês fecha quando a soma atinge o esperado.
- **`Player.is_exempt`** (app `players`): flag simples de isenção.

**Cálculo de status** (`Pago`/`Pendente`/`Atrasado`/`Isento`) — sempre **derivado**, nunca armazenado:
1. `is_exempt` → **Isento**.
2. `valor_base` = `fee_discount_amount` se dentro do prazo, senão `fee_full_amount`.
3. `esperado` = `valor_base` + soma dos ajustes do mês.
4. `pago` = soma dos `Payment` do mês.
5. `pago ≥ esperado` → **Pago**; senão, dentro do prazo → **Pendente**; senão → **Atrasado**.

**Endpoints:** `GET/PATCH OrganizationSettings` (Admin); CRUD de `Payment` e `PlayerMonthlyAdjustment` (Organizador/Admin); resumo financeiro da organização.

### 6.4 Sorteio Público (Fase 6)

- Namespace isolado `api/public/draws/<public_token>/`, view `AllowAny`, sem JWT nem header de organização.
- **Serializer dedicado e enxuto** — nunca reaproveitar `MatchSerializer`/`DrawSerializer` completos: expõe data/hora, times e jogadores (nome de exibição, posição, estrelas, badge de convidado) e placar quando existir. Sem telefone, e-mail ou qualquer dado sensível.
- Atualização por **polling** via `refetchInterval` do React Query. O contrato de API não muda se um dia virar SSE/WebSocket.

### 6.5 Apps sem alteração estrutural prevista

`accounts`, `players`, `audit`, `statistics` — apenas consumidos pelas features novas (`audit` passa a registrar `payment_registered`, `waitlist_promoted` etc.).

---

## 7. Frontend — Detalhamento

### 7.1 Páginas e telas novas

| Tela | Rota | Fase |
|---|---|---|
| Criar/Editar Partida (drawer) | a partir de `/partidas` | ✅ 2 |
| Fila de Espera | seção em `MatchDetailPage` | ✅ 3 |
| Sorteio Avulso | `/sorteio-avulso` | ✅ 5 |
| Sorteio Público | `/sorteio/:token` (sem `AppLayout`) | ⏳ 6 — **não existe** |
| Mensalidades + Dashboard Financeiro | ✅ saiu como `/financeiro` (abas) + `/minhas-mensalidades` | 7 |

### 7.2 Componentes novos por feature

- ✅ `MatchFormDrawer` (Fase 2) — usa `FormDrawer`, com o mesmo modelo mental de "jogadores de linha por time + 1 goleiro" já usado em jogos recorrentes.
- ✅ `WaitlistPanel` (Fase 3).
- ✅ `TeamResultCard` (Fase 4); o `GuestBadge` saiu como `StatusChip` + anel tracejado no `PlayerToken`.
- ✅ `BulkNamesInput`, `MensalistaSearchAutocomplete` e `QuickConfirmResolutionList` (Fase 5) — extraídos do `QuickConfirmDialog` e usados pelas duas telas; o reconhecimento de nomes continua sendo só o do `quick-confirm`.
- ⏳ `PublicDrawView`, `PublicDrawCountdown`, `QrCodeBox` (**Fase 6, não iniciada**).
- ✅ Financeiro (Fase 7) — entregue como `FinancePage` com abas + `MyChargesPage`, `ChargeCard`, `ChargeTimeline`, `RegisterPaymentDialog`, `BulkActionDialogs`, `FeePlanDrawer`, `ExpenseFormDialog`, `MemberFinanceDrawer`.

### 7.3 Componentes reutilizados (não recriar)

`FootballPitch` / `PlayerToken` / `fieldLayout.ts` (o motor de posicionamento está correto — a Fase 4 melhora o **visual**, não a lógica), `exportUtils.ts`, `shareFormat.ts`, `QuickConfirmDialog`, `AppLayout`, `OrganizationContext`, `AuthContext`, `ProtectedRoute`, e todo o Design System da Fase 1.

### 7.4 Telas refeitas (não apenas ajustadas)

1. Resultado do Sorteio (`MatchDetailPage`, seção de resultado) — Fase 4.
2. Campo SVG (visual) — Fase 4.
3. Dashboard — Fase 8.

As demais telas já foram migradas para o Design System na Fase 1, mantendo sua estrutura de informação.

### 7.5 Responsividade e animações

Checklist manual por fase nos breakpoints 320/375/390/768/1024/1440 (+ verificação em 4K): nenhuma tabela com scroll horizontal sem contêiner, nenhum card ultrapassando a viewport, campo SVG dentro do limite, página pública funcional sem nav. Animações sutis (`Fade`/`Grow`, hover com elevação leve) — alinhadas à referência minimalista.

---

## 8. Banco de Dados — Detalhamento

### 8.1 Alterações já aplicadas

| Tabela | Alteração | Migration | Fase |
|---|---|---|---|
| `matches_match` | + `name`, `location`, `notes`, `draw_time` | `matches/0004_match_manual_fields_and_more.py` | ✅ 2 |
| `matches_recurringgame` | + `days_before_to_generate` (default 7 = comportamento anterior) | `matches/0004_match_manual_fields_and_more.py` | ✅ 2 |

### 8.2 Alterações planejadas

| Tabela | Alteração | Fase |
|---|---|---|
| `matches_confirmation` | Constraint única com `condition=Q(is_deleted=False)` | 3 |
| `matches_waitlistentry` (nova) | `match`, `player`, `position` + índice `(match, position)` | 3 |
| `matches_match` | + `public_token` (UUID único, indexado) | 6 |
| `accounts_organizationsettings` (nova) | `organization` (1–1), `fee_due_day`, `fee_discount_amount`, `fee_full_amount` | 7 |
| `finance_payment` (nova) | `player`, `reference_month`, `amount`, `paid_at`, `method`, `notes`, `attachment` + índice `(player, reference_month)` | 7 |
| `finance_playermonthlyadjustment` (nova) | `player`, `reference_month`, `amount`, `reason` + índice `(player, reference_month)` | 7 |
| `players_player` | + `is_exempt` (default `False`) | 7 |

### 8.3 Compatibilidade de migrações

Todas as colunas novas são **nullable ou com default**, portanto nenhuma migração exige backfill ou downtime. Nenhuma coluna existente foi renomeada ou removida.

---

## 9. Roadmap e Cronograma

> "Sessão" = uma sessão de trabalho assistido por IA neste fluxo, não semanas de um time humano. Serve para dimensionar tamanho relativo, não como compromisso de prazo.

| Fase | Objetivo | Etapa do pedido | Impacto | Dificuldade | Estimativa | Status |
|---|---|---|---|---|---|---|
| **0 — Auditoria** | Este documento | 1 | — | — | — | ✅ |
| **1 — Design System** | Tokens, overrides, componentes reutilizáveis, migração das telas, identidade | 2, 3 | Muito alto | Média | 2 sessões | ✅ |
| **2 — Partidas Manuais & Recorrentes flexíveis** | `Match` com nome/local/obs/horário de sorteio; tela de criar/editar partida; antecedência de geração configurável | 9 | Alto | Média | 1–2 sessões | ✅ |
| **3 — Fila de Espera** | `WaitlistEntry`, promoção automática, painel de fila | 6 | Alto | Média | 1–2 sessões | ✅ |
| **A — Auditoria de Correções** | 39 achados corrigidos: login, interceptor 401, exportação SVG, selects de formulário, paginação, placar derivado no servidor, throttling, tasks Celery | — | Muito alto | Alta | 1 sessão | ✅ |
| **4 — Resultado do Sorteio refeito** | Cards por time, animação/scroll, placar por gols, texto de WhatsApp, badge de convidado e SVG com tokens do tema | 4, 5 | Alto | Média-Alta | 2 sessões | ✅ |
| **M — Mobile First, UX/UI e Formações** | Fora do plano original: menu, formações por time, campo SVG, troca por toque e teclado, PWA — [`PLANO_MOBILE_UX_SORTEIO.md`](./PLANO_MOBILE_UX_SORTEIO.md) | — | Muito alto | Alta | — | ✅ |
| **F — Financeiro, Despesas e Confirmações** | Fora do plano original: ressincronização, multa, baixa em massa, despesas, confirmados para o Jogador — [`PLANO_IMPLEMENTACAO_FINANCEIRO_CONFIRMACOES.md`](./PLANO_IMPLEMENTACAO_FINANCEIRO_CONFIRMACOES.md) | — | Muito alto | Alta | — | ✅ |
| **L — Mensalidades em massa e Logins** | Fora do plano original: geração de login pelo telefone, primeiro acesso, reset — [`PLANO_IMPLEMENTACAO_MENSALIDADES_LOGINS.md`](./PLANO_IMPLEMENTACAO_MENSALIDADES_LOGINS.md) | — | Alto | Alta | — | ✅ |
| **5 — Sorteio Avulso** | Tela dedicada reaproveitando reconhecimento de nomes + autocomplete | 8 | Médio-Alto | Média | 1–2 sessões | ✅ |
| **6 — Sorteio Público** | Token público, endpoint `AllowAny`, tela sem login, QR code, polling | 10 | Médio | Média | 1–2 sessões | ⏳ **não iniciada** |
| **7 — Mensalidades** | App `finance` completo + telas | 7 | Alto | Alta | 3–4 sessões | ✅ **entregue por outro caminho** (falta isenção e anexo de comprovante) |
| **8 — Dashboard novo** | Redesenho com novos indicadores e gráficos | 11 | Médio-Alto | Média | 1–2 sessões | 🟡 Parcial |
| **9 — Responsividade, Performance e A11y** | Breakpoints, `aria-label`, contraste, cache/paginação | 12, 13, 14 | Médio | Baixa-Média | 1–2 sessões | 🟡 Parcial (falta paginação server-side e cache de estatísticas) |
| **10 — Testes e Hardening** | Vitest no frontend, resíduos da auditoria, revisão de duplicação | 15, 16 | Alto | Média | 1–2 sessões | ✅ |

### 9.1 Ordem de execução e por que ela é essa

Antes de cada fase, verificam-se: dependências técnicas, impacto no que existe, compatibilidade arquitetural, reuso de componentes, necessidade de migração e refatorações.

1. **Fase 1 antes de tudo**: qualquer tela criada antes do Design System precisaria ser refeita depois. Sem dependência de dados.
2. **Fase 2 antes da 3 e da 5**: a fila de espera opera sobre uma partida, e o Sorteio Avulso precisa criar partidas avulsas — ambas dependem de o modelo/tela de partida manual existir. Migração isolada e aditiva.
3. **Fase 3 antes da 5**: o Sorteio Avulso pode estourar o máximo de jogadores e cair na fila; a regra precisa existir antes.
4. **Fase 4 pode andar em paralelo conceitualmente com 2/3**, mas vem depois para já nascer sobre os componentes da Fase 1 e não ser refeita.
5. **Fase 6 depois da 4**: a tela pública reaproveita o card de time e o badge de convidado desenhados na Fase 4 — fazer antes duplicaria trabalho.
6. **Fase 7 isolada**: módulo novo, sem dependência das anteriores além do Design System; é a maior migração de banco, feita quando o resto estiver estável.
7. **Fase 8 depois da 7**: o dashboard novo mostra indicadores financeiros que só existem após a Fase 7.
8. **Fases 9 e 10 por último**: varrem todas as telas — rodá-las antes significaria revisitar telas ainda por criar.

### 9.2 Fase 2 — Entregas realizadas ✅

**Backend**
- `Match` ganhou `name`, `location`, `notes` e `draw_time`; `RecurringGame` ganhou `days_before_to_generate` (default 7). Migration `matches/0004_match_manual_fields_and_more.py`, 100% aditiva.
- `compute_player_bounds()` em `apps/matches/models.py` é a fonte única do cálculo `times × (linha + 1 goleiro)` — usada por `RecurringGame.save()` e pelo `MatchSerializer` (eliminou a duplicação que surgiria com a partida manual).
- `Match.effective_draw_time`: horário próprio da partida com precedência sobre o do jogo recorrente.
- `auto_draw_tick` deixou de filtrar por `recurring_game__isnull=False` e passou a usar `effective_draw_time` — partidas avulsas com horário próprio agora sorteiam sozinhas; partidas sem horário nenhum são ignoradas.
- `ensure_next_match` só cria a próxima partida dentro da janela de antecedência configurada.
- `MatchSerializer` expõe os campos novos + `recurring_game_name` e aceita `min/max_players_per_team_line` como entrada opcional (contrato antigo com totais absolutos continua válido).
- **Correção de segurança encontrada durante a fase**: o campo `recurring_game` do `MatchSerializer` aceitava o id de um jogo recorrente de **qualquer** organização. Agora o queryset é filtrado pela organização da requisição, com teste cobrindo a tentativa de vínculo cruzado.

**Agilidade na confirmação de presença** (pedido durante a fase, entregue junto)
- Endpoint novo `POST /api/matches/{id}/set-all-confirmations/` + serviço `set_all_confirmations` — aplica o mesmo status a todos os jogadores ativos da organização. Passa pelo `set_confirmation` jogador a jogador de propósito, para que a auditoria de cada mudança continue sendo gravada.
- Tela da partida ganhou: contador "X de Y", botões **Confirmar todos** / **Desmarcar todos** (o segundo com `ConfirmDialog`, por ser destrutivo) e um campo **Adicionar jogador pelo nome**.
- O campo de adicionar reaproveita o endpoint `quick-confirm` (reconhecimento de nomes) em vez de criar um caminho novo: digitar o nome de um mensalista confirma o mensalista, não cria convidado duplicado. Verificado no navegador: "bruno alvez" foi casado com "Bruno Alves" sem criar jogador novo.
- `MatchDetailPage` teve as três invalidações de query repetidas extraídas para um único `invalidateConfirmations()`.

**Frontend**
- `MatchFormDrawer` novo, sobre o `FormDrawer` do Design System, com o mesmo modelo mental "linha + goleiro" da tela de jogos recorrentes e cálculo reativo do total.
- `MatchesPage`: botão "Nova partida", coluna "Partida" (nome próprio → jogo recorrente → "Avulsa") com o local abaixo, ações de editar/remover com `aria-label`, `ConfirmDialog` e toasts.
- `RecurringGameFormDrawer`: campo de antecedência de geração com explicação do padrão.
- `MatchDetailPage`: título com o nome da partida, local, observações e horário do sorteio automático.

**Decisões técnicas registradas**
- `public_token` **não** entrou nesta fase: seria coluna sem consumidor até a Fase 6, onde entra junto da feature.
- O banco continua guardando `min_players`/`max_players` como totais absolutos; a faixa "por time" é entrada de interface, convertida no serializer. Preserva o schema e o contrato de API existentes.
- `days_before_to_generate` limitado a 1–7 na interface, já que a recorrência é semanal.
- **O formulário de partida não pede mínimo** (decisão do usuário): partida nova nasce com `min_players = times × 2` (1 de linha + goleiro), o piso prático do algoritmo. O valor não é um campo escondido do formulário — é derivado no momento do envio, e ao **editar** uma partida existente o mínimo dela é preservado, para que ajustar o local de uma partida de jogo recorrente não afrouxe a trava do sorteio. A tela de Jogos Recorrentes continua com mínimo configurável.

**Testes executados**
- Backend: **75 testes passando** (59 anteriores + 16 novos), `ruff check` limpo.
- Frontend: `tsc --noEmit` limpo, `oxlint` sem novos avisos, `vite build` OK.
- Verificação manual no navegador: criação de partida avulsa (3 times × 4–6 de linha → 15–21 jogadores, gravados corretamente), exibição na listagem e no detalhe, remoção com soft-delete confirmado no banco, e campo de antecedência no drawer de jogo recorrente.

---

## 10. Funcionalidades, Critérios de Aceite e Checklists

> Cada funcionalidade tem seu próprio checklist de acompanhamento. Marcar aqui é parte do "definition of done" da fase.

### F1 — Design System ✅

**Critérios de aceite**
- Tema com paleta, tipografia, sombras e radius próprios em light e dark.
- Nenhuma tela (exceto as que serão refeitas) monta tabela/drawer/chip manualmente.
- Toda tabela mostra skeleton durante o carregamento e mensagem própria quando vazia.
- `tsc --noEmit`, lint e build limpos; testes backend inalterados.

**Checklist**
- [x] Tokens de cor (light/dark), tipografia Inter, 25 sombras, radius
- [x] Overrides: `Button`, `Card`, `Paper`, `Dialog`, `TextField`/`OutlinedInput`, `Chip`, `TableCell`/`TableRow`, `AppBar`
- [x] `PageHeader`, `StatusChip`, `ConfirmDialog`, `DataTable`, `FormDrawer`, `ToastProvider`
- [x] Migração de `PlayersPage`, `PlayerFormDrawer`, `RecurringGamesPage`, `RecurringGameFormDrawer`, `MatchesPage`, `AuditLogPage`, `StatisticsPage`
- [x] Confirmação de exclusão em Jogos Recorrentes (não existia)
- [x] Favicon de bola + título da aba
- [x] `tsc --noEmit` limpo · `oxlint` sem novos avisos · `vite build` OK · 59 testes backend passando
- [x] Verificação visual em light e dark mode

### F2 — Partidas Manuais e Jogos Recorrentes flexíveis ✅

**Critérios de aceite**
1. O organizador cria uma partida avulsa pela interface, informando nome, data, horário, local, observações, número de times, máximo de jogadores de linha por time e horário do sorteio (opcional).
2. O total de jogadores da partida é calculado como `times × (linha + 1 goleiro)` — **mesma regra** dos jogos recorrentes, sem duplicar código. O mínimo não é configurado na partida: vale `times × 2`, preservado quando a partida já tinha outro valor.
3. O organizador edita e remove partidas (remoção é soft-delete); partidas geradas por jogo recorrente também podem ser editadas.
4. Uma partida avulsa com `draw_time` preenchido participa do sorteio automático no horário; sem `draw_time`, nunca sorteia sozinha.
5. Uma partida vinculada a jogo recorrente sem `draw_time` próprio continua usando o horário do recorrente (**comportamento anterior preservado**).
6. O jogo recorrente define com quantos dias de antecedência sua próxima partida é criada; o padrão (7) reproduz exatamente o comportamento anterior.
7. Visualizador não cria, edita nem remove partidas (403).
8. Nenhum teste existente quebra.

**Checklist — Backend**
- [x] Campos `name`, `location`, `notes`, `draw_time` em `Match`
- [x] Campo `days_before_to_generate` em `RecurringGame` (default 7)
- [x] Migration aditiva `matches/0004_*` (sem backfill, sem downtime)
- [x] `compute_player_bounds` como fonte única do cálculo (usado por `RecurringGame.save()` e pelo serializer de `Match`)
- [x] `validate_match_config` reaproveitado na criação manual (sem duplicar regra)
- [x] `MatchSerializer` expõe os campos novos + `recurring_game_name` e aceita `min/max_players_per_team_line` como entrada opcional
- [x] `ensure_next_match` respeita `days_before_to_generate`
- [x] `auto_draw_tick` considera partidas avulsas com `draw_time` próprio, com precedência sobre o recorrente
- [x] Testes: criação manual (sucesso), cálculo dos totais, validações (times < 2, mínimo > máximo), permissão de visualizador, antecedência respeitada e não respeitada, sorteio automático de partida avulsa, precedência do `draw_time`

**Checklist — Frontend**
- [x] `Match`/`RecurringGame` atualizados em `core/types/match.ts`
- [x] `matchesApi.create/update/remove`
- [x] `MatchFormDrawer` sobre o `FormDrawer` do Design System
- [x] `MatchesPage`: botão "Nova partida", colunas de nome/local, ações editar/remover, `ConfirmDialog`, toasts
- [x] `RecurringGameFormDrawer`: campo de antecedência de geração
- [x] `MatchDetailPage`: exibe nome, local, observações e horário do sorteio
- [x] `tsc --noEmit` limpo · `vite build` OK

**Checklist — Documentação**
- [x] `REGRAS_DE_NEGOCIO.md` atualizado (partida avulsa, antecedência, precedência do horário de sorteio)
- [x] `REQUISITOS.md` atualizado (inconsistências da seção 3 corrigidas)
- [x] Decisões técnicas registradas neste plano (seção 6.1/6.2 e 8.1)

### F3 — Fila de Espera ✅

**Decisões de produto confirmadas com o usuário**
- Ordem da fila: **ordem de inscrição**, com **prioridade para mensalistas**.
- Promover alguém da fila **não refaz o sorteio** — o organizador decide quando recalcular.

**Critérios de aceite**
1. Ao confirmar um jogador quando a partida já atingiu `max_players` confirmados, ele entra na fila (não é confirmado) e a API deixa isso explícito na resposta. ✅
2. Ao cancelar (`declined`) uma confirmação existente havendo fila, o primeiro da fila é promovido automaticamente e os demais reordenados. ✅
3. O organizador reordena, remove e promove manualmente entradas da fila. ✅
4. Cada promoção gera registro de auditoria. ✅
5. `Confirmation` passa a ter constraint única com filtro de soft-delete. ✅
6. Visualizador não altera a fila (403). ✅

**Checklist**
- [x] Model `WaitlistEntry` + índice `(match, position)` + constraint com filtro de soft-delete
- [x] Migration da constraint de `Confirmation` (`matches/0005_waitlistentry_and_more.py`)
- [x] `compute_match_capacity` — fonte única de "times × (linha + goleiro)", exposta na API como `capacity`
- [x] `set_confirmation` desviando para a fila ao atingir o máximo, em **todos** os caminhos (toggle, confirmar todos, adicionar pelo nome, lista de nomes)
- [x] `promote_from_waitlist`, `move_waitlist_entry`, `remove_from_waitlist`, `fill_open_slots`, `enforce_match_capacity`
- [x] Ações de auditoria `waitlist_added` e `waitlist_promoted`
- [x] Endpoints `waitlist`, `waitlist/promote`, `waitlist/move`, `waitlist/remove` + permissões no padrão existente
- [x] 25 testes (capacidade 2/3/4 times, excedeu o máximo, prioridade de mensalista, cancelamento promove, reordenação, isolamento multi-tenant, permissão de visualizador)
- [x] `WaitlistPanel` em `MatchDetailPage` + contador de capacidade + badge de posição no roster
- [x] Documentação atualizada (`REGRAS_DE_NEGOCIO.md` §5.1)
- [x] Verificado no navegador: 16 confirmados numa partida de 14 vagas → 14 sorteados, 2 na espera, promoção automática ao desmarcar alguém

### F4 — Resultado do Sorteio refeito ✅ **CONCLUÍDA** (os três itens que faltavam saíram no [`PLANO_MOBILE_UX_SORTEIO.md`](./PLANO_MOBILE_UX_SORTEIO.md))

**Critérios de aceite**
1. Cada time aparece em um card dedicado com "Time N {emoji}", total de estrelas, placar (quando houver) e ações próprias. ✅
2. Convidados exibem badge vermelho na tela, no SVG, no PNG exportado, na impressão e na mensagem de compartilhamento. ✅ — `player_type` exposto em [draws/serializers.py:16](../backend/apps/draws/serializers.py:16) e [matches/serializers.py:313](../backend/apps/matches/serializers.py:313).
3. O campo SVG respeita o tema (sem verde fixo) e mantém legibilidade em light e dark. ✅ — `FootballPitch.tsx` desenha com os tokens de `shared/theme/tokens.ts`.
4. A lógica de posicionamento (`fieldLayout`) **não** é alterada — só o visual. ✅ (não foi tocada)
5. Layout correto de 2 a 6 times, sem frações estranhas de grid. ✅ (flex `1 1 300px` no lugar de `12/N`)

**Checklist**
- [x] `TeamResultCard` (faixa de cor por time, escalação em lista, placar, ações de exportação)
- [x] `shareFormat` com paleta de cor por time (`getTeamColor`) alinhada aos emojis
- [x] Separador "⚽ VS ⚽" entre os cards
- [x] Grid revisto para N times (o cálculo `12 / teams.length` da auditoria §2.6 foi eliminado)
- [x] Animação de embaralhamento durante o sorteio (`DrawShuffleOverlay`) + rolagem automática até o resultado
- [x] Botões com emoji e botão principal em destaque ("🎲 Sortear Times" / "🔄 Sortear Novamente")
- [x] "⚽ Lançar Placar" por gols, com vitória/empate/derrota derivados
- [x] Seção "📲 Resultado para WhatsApp" com cópia em um clique (`WhatsAppShareCard`)
- [x] Toasts de feedback em todas as ações
- [x] Verificação responsiva em 375px (sem overflow horizontal)
- [x] Documentação atualizada (`REGRAS_DE_NEGOCIO.md` §7 e §10)
- [x] `GuestBadge` (convidado em vermelho) — entregue como chip "Convidado" + anel tracejado no campo (`StatusChip`, `PlayerToken`), nunca só cor
- [x] SVG do campo redesenhado com tokens do tema (dark mode) — `FootballPitch.tsx`
- [x] `exportUtils` cobrindo o badge no PNG/impressão — `exportUtils.ts` + `shareFormat.ts`

### F5 — Sorteio Avulso ✅ **CONCLUÍDA**

**Critérios de aceite**
1. Em uma única tela é possível colar a lista de nomes, buscar mensalistas por autocomplete, misturar mensalistas e convidados e ajustar antes de sortear. ✅
2. O reconhecimento de nomes usa o mesmo backend do `quick-confirm` (sem lógica duplicada). ✅ — **nenhuma linha de backend foi escrita nesta fase**.
3. Ao sortear, uma partida avulsa é criada com os confirmados. ✅

**Checklist**
- [x] `BulkNamesInput` extraído do `QuickConfirmDialog` (reuso) — `BulkNamesInput.tsx`, com `splitNames()`
- [x] `MensalistaSearchAutocomplete` — `MensalistaSearchAutocomplete.tsx`, usado pelas **duas** telas (montar a lista aqui; corrigir a linha errada no diálogo)
- [x] `QuickConfirmResolutionList` extraída junto — é a conferência do que o servidor entendeu de cada linha, e reescrevê-la na tela nova seria reescrever a única defesa contra a lista entrar errada em campo
- [x] Página `/sorteio-avulso` + rota + item de menu (admin e organizador; o visualizador não cria partida nem sorteia)
- [x] Integração com criação de partida manual (F2) — `matchesApi.create` com a mesma faixa por time do formulário de partida
- [x] Testes — `DrawAvulsoPage.test.tsx` (10 casos)
- [x] Documentação atualizada — `REGRAS_DE_NEGOCIO.md` §5.2

**Decisões tomadas na implementação**
- **A partida é criada ao conferir, não ao sortear.** Conferir a lista exige um `match` (é o que o `quick-confirm` recebe), e inventar um segundo caminho de reconhecimento só para a prévia duplicaria a regra. A partida avulsa aparece em Partidas e pode ser cancelada por lá — o texto da tela diz isso.
- **A capacidade nasce do tamanho da lista** (`capacityForList`): 14 nomes em 2 times viram 7 de linha por time. Com um teto fixo, colar 16 nomes mandaria dois para a lista de espera sem ninguém ter pedido — numa tela cujo objetivo é sortear quem está ali, agora.
- **O resultado continua sendo da tela da partida.** Sortear navega para `/partidas/:id`; uma segunda tela de resultado (formação, campo, placar, WhatsApp) seria uma segunda tela para manter.

### F6 — Sorteio Público ⏳

**Critérios de aceite**
1. `Match.public_token` é UUID não sequencial e único.
2. `GET /api/public/draws/<token>/` funciona sem JWT e sem header de organização, somente leitura.
3. A resposta não contém telefone, e-mail, observações nem qualquer dado de outra partida/organização.
4. Token inválido retorna 404 sem vazar existência.
5. A tela pública funciona sem `AppLayout`, mostra QR code, estado "ainda não sorteado" e atualiza por polling.
6. Rate limit adequado para tráfego de divulgação.

**Checklist**
- [ ] Campo `public_token` + migration + índice
- [ ] Serializer público dedicado (revisado campo a campo)
- [ ] View `AllowAny` em namespace isolado + throttle próprio
- [ ] Testes (token válido/inválido, ausência de dados sensíveis, isolamento entre organizações)
- [ ] `PublicDrawView`, `PublicDrawCountdown`, `QrCodeBox` + rota fora do layout autenticado
- [ ] Documentação atualizada

### F7 — Mensalidades ✅ **entregue por outro caminho** (desenho abaixo superado)

> O módulo saiu maior e diferente do previsto aqui: `apps/finance/` com `MembershipFeePlan`, `PlayerMonthlyFee`, `Charge`, `Payment`, `Expense` e `RecurringExpense`, competência (`reference`) separada da data de pagamento, valor histórico congelado na cobrança, multa por atraso, ressincronização opt-in, operações em massa e auditoria append-only. Ler [`REGRAS_DE_NEGOCIO.md`](./REGRAS_DE_NEGOCIO.md) §14, não os critérios abaixo.
>
> **Legenda dos itens:** `[~]` = substituído pelo que foi construído · `[ ]` = continua pendente de verdade.

**Critérios de aceite**
1. `OrganizationSettings` é criado com valores padrão ao registrar a organização e só o Admin edita.
2. O status de cada jogador/mês é **derivado** (nunca armazenado) segundo a regra da seção 6.3.
3. Múltiplos pagamentos no mesmo mês somam; o mês fecha ao atingir o esperado.
4. Ajustes pontuais entram no cálculo do mês correspondente.
5. Jogador isento nunca aparece como pendente/atrasado.
6. Anexo aceita só PDF/imagem dentro do tamanho máximo; qualquer outro é rejeitado com erro claro.
7. Visualizador não lança pagamento; Organizador não edita `OrganizationSettings`.
8. Todo lançamento gera auditoria.

**Checklist**
- [~] App `finance` + models `Payment` e `PlayerMonthlyAdjustment` + índices → app `finance` existe; `Payment` existe; `PlayerMonthlyAdjustment` **não** — o ajuste por jogador virou `PlayerMonthlyFee` (vigência por competência), que é configuração *e* histórico
- [~] `OrganizationSettings` em `accounts` + criação automática no registro → virou `MembershipFeePlan` no próprio app `finance` (valor base, periodicidade, dia de vencimento, multa)
- [ ] `Player.is_exempt` — **pendente**: não existe isenção; hoje se resolve com valor zero, o que não é a mesma coisa
- [ ] Validação de upload (extensão, mimetype, tamanho) — **pendente**: não há anexo de comprovante em `Payment`
- [~] Serviço de cálculo de status + resumo financeiro → `_sync_charge_status`, `financial_summary()`, `expenses_summary()`
- [x] Endpoints + permissões — `apps/finance/urls.py` + `apps/finance/permissions.py` (`CanEditFee`, `CanManageFinancial`)
- [~] Testes de todas as combinações de status + permissões + upload inválido → cobertos menos o upload, que não existe: `test_finance*.py` (7 arquivos)
- [~] Tela `/mensalidades` + `PaymentForm`, `PaymentHistoryList`, `FinancialSummaryCards` → virou `/financeiro` com abas (Mensalistas, Mensalidades, Despesas) + `/minhas-mensalidades` para o Jogador
- [x] Documentação atualizada — `REGRAS_DE_NEGOCIO.md` §14

### F8 — Dashboard novo 🟡 **parcial**

**Critérios de aceite**
1. Mostra próxima partida com confirmados, últimos sorteios, últimas alterações de auditoria, resumo estatístico e indicadores financeiros — cobrindo o que `REQUISITOS.md` §2.11 prometia.
2. Skeleton durante o carregamento; gráficos respeitam o tema em ambos os modos.
3. Ações rápidas (confirmar presença, sortear) acessíveis do dashboard.

**Checklist**
- [x] Endpoint de resumo ampliado (sem N+1) — `apps/matches/dashboard_views.py`, com `select_related`; entrega próxima partida, pendências, elenco e financeiro do mês
- [x] Cards com tokens do tema — `NextMatchHeroCard`, `PendingTasksCard`, `StatTile`. **Gráficos não foram feitos** (o dashboard é de números e ações, não de visualização)
- [x] `PageSkeleton` — usado no carregamento
- [x] Verificação responsiva
- [ ] **Pendente:** últimos sorteios, últimas alterações de auditoria e resumo estatístico no dashboard (critério de aceite 1)
- [ ] Documentação atualizada

### F9 — Responsividade, Performance e Acessibilidade 🟡 **parcial**

**Critérios de aceite**
1. Nenhuma tela quebra em 320/375/390/768/1024/1440 nem fica esticada em 4K.
2. Todo botão de ícone tem `aria-label`; contraste validado em AA nos dois modos.
3. Listas grandes usam paginação real (não só a primeira página da API).
4. Estatísticas não carregam a organização inteira em memória a cada request.

**Checklist**
- [x] Varredura de breakpoints tela a tela — feita em 320/375/768/1024/1440, temas claro e escuro ([`PLANO_MOBILE_UX_SORTEIO.md`](./PLANO_MOBILE_UX_SORTEIO.md) §29)
- [x] `aria-label` e navegação por teclado — `aria-current` no menu, `aria-live` na contagem de filtros, linha de tabela focável, troca de jogadores por teclado (A-042, A-126, A-128, A-129, A-086)
- [ ] **Paginação server-side no `DataTable`** — pendente: hoje a paginação é no cliente ([DataTable.tsx:139](../frontend/src/shared/components/DataTable.tsx:139) fatia as linhas já carregadas)
- [ ] **Cache/otimização de estatísticas** — pendente: `apps/statistics/services.py` já agrega no banco (`annotate`/`select_related`), mas não há cache
- [ ] **Lighthouse Acessibilidade ≥ 90** — nunca medido
- [ ] Documentação atualizada

### F10 — Testes e Hardening ✅ **CONCLUÍDA**

**Critérios de aceite**
1. Vitest configurado com testes dos componentes críticos do Design System e das telas de maior risco.
2. Resíduos da auditoria fechados.
3. Nenhuma duplicação nova introduzida pelas fases anteriores.

**Checklist**
- [x] Vitest + Testing Library configurados e no CI — `frontend/vitest.config.ts` + `src/test/setup.ts`; o job de frontend do CI roda `npm run test`
- [x] Testes de `DataTable`, fluxo de sorteio e telas de maior risco — 18 arquivos, 250 casos (`DataTable.test.tsx`, `MatchDetailPage.test.tsx`, `DrawSetupSheet.test.tsx`, `PresencePanel.test.tsx`, os quatro do financeiro, `AppLayout.test.tsx`, `useSelection.test.ts`). `FormDrawer` e `StatusChip` ficaram sem teste dedicado — são casca fina, exercitados através das telas
- [~] Fixture compartilhada `authenticated_client` nos testes backend → resolvido por `tests/factories.py` (factory_boy) + helpers `cliente(...)` locais, sem `conftest.py`
- [x] Revisão final de duplicação
- [x] Documentação atualizada

---

## 11. Decisões Confirmadas e Perguntas em Aberto

### 11.1 Confirmadas com o usuário

1. **Estética**: aprofundar o tema do MUI — **sem** Tailwind/shadcn. ✅
2. **Tempo real da página pública**: polling via React Query; WebSocket fica como melhoria futura opcional. ✅
3. **Mensalidades — valor**: valor padrão único da organização com duas faixas por data; ajustes pontuais por jogador. ✅
4. **Mensalidades — múltiplos pagamentos por mês**: permitido; o mês fecha quando a soma atinge o esperado. ✅

### 11.2 Decisões tomadas nesta revisão (registradas para validação)

5. **`days_before_to_generate` padrão 7**: é o valor que reproduz exatamente o comportamento anterior para recorrência semanal. Se a intenção for gerar as partidas com menos antecedência, basta reduzir o valor por jogo recorrente.
6. **`Match.public_token` movido da Fase 2 para a Fase 6**: evita criar uma coluna sem consumidor por várias fases. Custo: uma migration a mais na Fase 6 (aditiva, sem downtime).
7. **Partida avulsa usa o mesmo modelo mental "linha + goleiro"** dos jogos recorrentes na interface, mas o banco continua guardando os totais absolutos (`min_players`/`max_players`), preservando o schema e o contrato de API existentes.

### 11.3 Ainda em aberto (não bloqueiam as próximas fases)

8. **Local do Dashboard Financeiro**: dentro de `/mensalidades` ou como seção do Dashboard geral? Tendência: seção própria em `/mensalidades`, com 2–3 números-chave também no Dashboard. Decido na Fase 7/8 se não houver preferência.
9. **Rate limit da página pública**: o throttle anônimo atual (100/dia por IP) pode ser insuficiente se o link circular num grupo grande. Na Fase 6 defino uma taxa dedicada, salvo preferência contrária.
