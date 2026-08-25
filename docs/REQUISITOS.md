# Sistema Inteligente de Sorteio para Futebol — Requisitos & Roadmap

> Documento vivo. Atualizar conforme decisões mudarem ao longo das fases.

## 1. Visão do Produto

SaaS multi-tenant para organização de "peladas" de futebol, com foco em sorteio inteligente de times equilibrados. Backend Django/DRF (API-only) + frontend React desacoplado, preparado para app mobile (Expo) reaproveitando a mesma API e boa parte da lógica de frontend.

Decisões de arquitetura já validadas:
- **Multi-tenant**: uma instalação serve várias organizações ("peladas"), isolamento por `organization_id`.
- **Tempo real**: apenas client-side (React state); sem WebSocket/Django Channels.
- **Cobrança**: `Organization`/`Plan` modelados como stub, sem lógica de billing nesta fase.

## 2. Requisitos Funcionais

### 2.1 Jogadores
- Cadastro: nome, apelido, foto, telefone, observações.
- Tipo: Mensalista ou Convidado.
- Status: Ativo ou Inativo.
- Nível técnico: 1 a 5 estrelas (inteiro internamente).
- Posições: tabela própria (seed inicial: GOL, ZAG, ME, AT), extensível no futuro. Cada jogador tem posição principal e posição secundária (opcional).

### 2.2 Jogos Recorrentes
- Nome, dia da semana, horário do jogo, horário do sorteio, ativo/inativo.
- Cada jogo recorrente gera automaticamente uma partida (`Match`) por ocorrência.

### 2.3 Configuração por Partida
- Quantidade de times, quantidade mínima e máxima de jogadores configuráveis **por partida** (não fixo em 2 times — algoritmo deve funcionar para N times).
- **O sorteio respeita sempre essa configuração**: nunca sorteia mais que o máximo. ✅ Entregue na Fase 3.
- Partidas avulsas (manuais) criadas pela interface, com nome, local, observações e horário de sorteio próprios. ✅ Entregue na Fase 2 do plano de evolução.

### 2.4 Confirmação de Presença
- Jogadores confirmam presença por partida; somente confirmados entram no sorteio.
- Na tela da partida: confirmar/desmarcar todos de uma vez e adicionar um jogador pelo nome (mensalista reconhecido ou convidado novo). ✅ Entregue na Fase 2 do plano de evolução.

### 2.5 Sorteio — Automático e Manual
- Automático: Celery dispara no horário configurado, valida quantidade mínima, executa o sorteio, salva resultado e audita.
- Manual: botão para o organizador disparar a qualquer momento (quando mínimo atingido).

### 2.6 Algoritmo de Sorteio (núcleo do sistema)
Estratégia: **Simulated Annealing** (via interface de estratégia, permitindo Genetic Algorithm/Hill Climbing no futuro). Função de score multi-critério:

1. **Equilíbrio técnico**: minimizar diferença de estrelas totais entre times.
2. **Distribuição por posição**: aproximar ao ideal (`total_da_posição / N_times`) por time.
   - **Posições escassas (ex.: goleiro)**: na prática normalmente só existem **2 goleiros**, independente de o jogo ter 2, 3 ou 4 times. Não é realista exigir 1 goleiro por time nesse caso. O algoritmo detecta quando `quantidade_da_posição < teams_count` e ajusta o alvo para "distribuir os disponíveis no maior número de times diferentes possível", sem penalizar times que ficam sem especialista na posição. A penalidade passa a ser calculada contra o que é fisicamente possível, não contra uma meta fixa de 1-por-time.
3. **Repetição**: penalizar pares de jogadores que jogaram juntos recentemente (histórico configurável de quantos sorteios passados considerar), incentivando times diferentes a cada semana.
4. **Uso de posição secundária**: pequena penalidade ao preencher com posição secundária em vez da principal.

Processo: solução inicial gulosa (snake draft por estrelas/posição) → busca local por trocas entre times com critério de aceitação de Metropolis → resfriamento geométrico → guarda sempre a melhor solução vista (elitismo) → milhares de iterações conforme o tamanho da partida.

### 2.7 Resultado do Sorteio
- Exibir por time: jogadores, posição, estrelas, total de estrelas, diferença técnica, índice de equilíbrio, distribuição por posição.
- Campo de futebol em **SVG gerado dinamicamente** (não imagem estática) por time, com jogadores posicionados automaticamente por posição, mostrando nome, posição e estrelas.
- Atualização instantânea no navegador ao mover jogadores (sem reload) — resolvido inteiramente no frontend via estado do React.
- Exportação: SVG, PNG, compartilhar no WhatsApp, imprimir.

### 2.8 Alteração dos Times Pós-Sorteio
- Organizador pode mover/trocar jogadores entre times via drag-and-drop.

### 2.9 Auditoria
- Toda alteração registra: usuário, data/hora, IP, time origem, time destino, jogador removido/adicionado, estado antes/depois, motivo.
- **Nunca apagar histórico** (log append-only).

### 2.10 Histórico
- Consulta de qualquer sorteio antigo: times, SVG, alterações, auditoria, versão original vs. versão final.

### 2.11 Dashboard
- Próxima partida, confirmados, mensalistas, convidados, ativos, últimos sorteios, últimas alterações, botão sortear, botão confirmar presença, resumo estatístico.
- **Estado atual**: o dashboard entrega apenas próxima partida, confirmados e os contadores de jogadores. Últimos sorteios, últimas alterações e resumo estatístico estão previstos para a Fase 8 do [plano de evolução](./PLANO_IMPLEMENTACAO.md).

### 2.12 Estatísticas
- Mais vitórias/derrotas, maior sequência de vitórias/derrotas, mais presente/ausente, quantidade de jogos/convites, aproveitamento, ranking de presença e vitórias, histórico individual, média de estrelas dos times em que participou, tempo desde o último jogo.
- **Requisito derivado**: para calcular vitórias/derrotas é necessário registrar o placar de cada partida — modelado como `TeamResult` (goals_scored, goals_conceded, resultado), preenchido pelo organizador após o jogo.

### 2.13 Permissões
- **Administrador**: acesso total.
- **Organizador**: gerencia partidas, confirma presença, realiza sorteios, altera times.
- **Visualizador**: somente consulta.

## 3. Requisitos Não Funcionais

- Python 3.13 + Django 5.1–5.2, DRF, PostgreSQL, JWT, Celery, Redis, Docker/Docker Compose.
- React, Vite, TypeScript, React Router, React Query, MUI, React Hook Form, Axios.
- SOLID, Clean Architecture, Clean Code, DRY, Repository Pattern, Services, DTOs, Validators.
- Testes unitários e de integração, Swagger/OpenAPI, `.env`, logs estruturados, CI/CD preparado.
- Frontend 100% desacoplado do backend — comunicação só via API REST; nenhuma regra de negócio no cliente.
- Preparado para app mobile (Expo) reaproveitando lógica de frontend e a mesma API.

## 4. Modelagem de Dados (resumo — detalhamento em [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md) §8)

Tenancy/Auth: `Plan`, `Organization`, `User`, `Membership`.
Jogadores: `Position`, `Player`.
Jogos: `RecurringGame`, `Match`, `Confirmation`.
Sorteio: `Draw`, `Team`, `TeamPlayer` (com snapshot de posição/estrelas), `TeamResult`.
Auditoria: `AuditLog` (append-only).
Configuração: `OrganizationSettings` — **ainda não implementado**; previsto para a Fase 7 (mensalidades) do plano de evolução.

## 5. Melhorias Recomendadas (além do solicitado)

- ✅ Lista de espera automática quando confirmados excedem o máximo — **entregue na Fase 3** (ver `REGRAS_DE_NEGOCIO.md` §5.1).
- Soft-delete generalizado (nunca perder histórico).
- Throttling/rate limiting na API.
- i18n preparado.
- Observabilidade (Sentry, logs estruturados, health-check).
- Feature flags por Plan.

## 6. Roadmap por Fases

| Fase | Entrega | Status |
|---|---|---|
| 0 — Fundação | Este documento, monorepo, Docker Compose, Django base (JWT/Swagger/pytest), frontend base (Vite/TS/MUI/router/react-query), CI skeleton | ✅ Concluída |
| 1 — Núcleo & Pessoas | Organization/Membership/Plan(stub), Position (seed), Player CRUD, permissões por papel, isolamento multi-tenant | ✅ Concluída |
| 2 — Jogos & Confirmação | RecurringGame CRUD, geração automática de Match, Confirmation (API+UI), Dashboard v1 | ✅ Concluída |
| 3 — Motor de Sorteio | Domínio do algoritmo (SA + estratégias + scoring), DrawService, sorteio manual, histórico de pares, Celery Beat | ✅ Concluída |
| 4 — Times, SVG & Edição | Team/TeamPlayer, SVG do campo no frontend, drag-and-drop, exportação | ✅ Concluída |
| 5 — Auditoria & Histórico | Captura de auditoria, tela de histórico, diff antes/depois | ✅ Concluída |
| 6 — Estatísticas | Placar (TeamResult), agregações, rankings, gráficos | ✅ Concluída |
| 7 — Polimento Comercial | Tema claro/escuro, responsividade, papel visualizador, Swagger completo, CI/CD completo | ✅ Concluída |
| 8 — Futuro | Pagamentos, integração WhatsApp, app mobile Expo, painel administrativo avançado | ⏳ Fora do escopo atual |

**Pendências conhecidas para produção real**: testes automatizados de frontend (Vitest) ainda não configurados — cobertura de UI hoje é via verificação manual no navegador a cada fase; backend tem **114 testes automatizados** cobrindo isolamento multi-tenant, permissões, tasks Celery, a lista de espera/capacidade e as regras de negócio críticas.

**Camada de dados do frontend**: o estado de servidor deixou de usar React Query e passou a ser servido por uma camada própria em `core/data/` (`queryStore` + `useApiQuery`/`useApiMutation`), com a mesma semântica de chave hierárquica, invalidação por prefixo e deduplicação de requisições — sem dependência externa e sem nenhuma API de browser, mantendo `core/` reaproveitável por um app Expo.

A evolução do produto além destas fases (Design System, partidas manuais, fila de espera, mensalidades, sorteio público etc.) é planejada e acompanhada em [`PLANO_IMPLEMENTACAO.md`](./PLANO_IMPLEMENTACAO.md).
