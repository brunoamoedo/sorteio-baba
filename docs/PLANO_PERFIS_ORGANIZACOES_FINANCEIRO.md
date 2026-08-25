# Plano — Perfis de Usuário, Multi-Organizações e Módulo Financeiro

> Documento de execução. Cada fase tem status próprio; ao concluir uma fase,
> as regras dela migram para [`REGRAS_DE_NEGOCIO.md`](./REGRAS_DE_NEGOCIO.md),
> que continua sendo a fonte da verdade do comportamento do sistema.

## 1. Diagnóstico — o que já existia

Boa parte do pedido já estava implementada. O levantamento antes de escrever
qualquer código:

| Pedido | Situação encontrada |
|---|---|
| Múltiplas organizações independentes | ✅ `Organization` + isolamento por `organization_id` em toda query |
| Usuário em várias organizações com perfis diferentes | ✅ `Membership(user, organization, role)` — é a tabela de associação pedida |
| APIs validando permissão no servidor | ✅ `resolve_organization` + `HasOrganizationContext` + classes por papel |
| Auditoria com usuário/org/data/ação/detalhes | ✅ `AuditLog` append-only, com IP e antes/depois |
| Gerente da organização | ⚠️ Existia como `organizador`; faltavam as permissões financeiras |
| Super Administrador | ❌ Inexistente — `resolve_organization` exigia `Membership` |
| Perfil Jogador | ❌ Inexistente — o papel mais restrito (`visualizador`) via tudo |
| Jogador independente da organização | ⚠️ Conflito de modelagem (ver §2) |
| Módulo financeiro | ❌ Inexistente (`Plan` é billing do SaaS, não mensalidade de jogador) |
| Jogador logado ver "minhas partidas" | ❌ `Player.user` existia mas nunca foi usado |

## 2. Decisão de arquitetura — identidade do jogador

O sistema tem **duas noções de pessoa**: `User` (login global, já multi-org) e
`Player` (ficha esportiva, presa a uma organização, com nível, posições, tipo e
status).

O pedido dizia que o jogador não deve pertencer a uma organização. Mas os
atributos dele **são por organização** — a mesma pessoa pode ser 5★ e mensalista
numa pelada e 3★ e convidado em outra. Um cadastro compartilhado apagaria essa
distinção e faria um dado vazar de uma organização para outra.

**Decisão tomada:** a identidade global é o `User`; o `Player` continua sendo o
**perfil daquela pessoa naquela organização**, agora ligado ao login pelo campo
`Player.user` (que já existia e estava sem uso).

```
User "João Busquets"  ← UM login, um cadastro
 ├── Membership(Arena Norte,  gerente)  + Player(Arena Norte,  5★, ZAG, mensalista)
 ├── Membership(Liga Empr.,   jogador)  + Player(Liga Empr.,   3★, AT,  convidado)
 └── Membership(Fut. Quinta,  jogador)  + Player(Fut. Quinta,  4★, ME,  mensalista)
```

Alternativa descartada: quebrar `Player` em `Person` + `PlayerProfile`. Chega ao
mesmo resultado, mas obriga a reescrever as três FKs (`Confirmation`,
`WaitlistEntry`, `TeamPlayer`), as estatísticas, o sorteio e o reconhecimento de
nomes — muito mais risco pelo mesmo ganho.

Também descartada: um `Player` único e realmente compartilhado, porque forçaria
o mesmo nível e o mesmo tipo em todas as peladas.

## 3. Perfis

Quatro papéis **convivendo** (o Visualizador não foi removido — ele serve a quem
só acompanha, sem confirmar presença):

| Papel | Onde mora |
|---|---|
| **Super Administrador** | `User.is_superadmin` — transversal, **não** é papel de organização |
| **Gerente** | `Membership.role in (admin, organizador)` |
| **Jogador** | `Membership.role = jogador` (novo) |
| **Visualizador** | `Membership.role = visualizador` |

O Super Admin fica fora de `ROLE_CHOICES` de propósito: ele não pertence a
organização nenhuma, e amarrá-lo a uma `Membership` seria contraditório.

### Matriz de permissões

| Ação | Super Admin | Gerente | Jogador | Visualizador |
|---|:--:|:--:|:--:|:--:|
| Criar/editar/excluir organização | ✅ | ❌ | ❌ | ❌ |
| Ver todas as organizações | ✅ | ❌ | ❌ | ❌ |
| Gerenciar usuários e perfis | ✅ | só da org | ❌ | ❌ |
| Jogadores, partidas, recorrências, sorteio | ✅ | ✅ | ❌ | 👁️ |
| Confirmar **a própria** presença | ✅ | ✅ | ✅ | ❌ |
| Confirmar presença **de terceiros** | ✅ | ✅ | ❌ | ❌ |
| Auditoria da organização | ✅ | ✅ | ❌ | 👁️ |
| Auditoria global | ✅ | ❌ | ❌ | ❌ |
| Financeiro administrativo | ✅ | ✅ | ❌ | ❌ |
| Ver **os próprios** pagamentos | ✅ | ✅ | ✅ | ❌ |

### Como o controle funciona

Três camadas, todas no servidor:

1. `resolve_organization` — resolve `X-Organization-Id` para uma `Membership`
   ativa. Sem vínculo válido, não há contexto e a requisição morre em 403.
2. Classe de permissão por rota — `IsOrganizationOrganizerOrAdmin` (gestão),
   `IsOrganizationMember` (leitura ampla, **sem** jogador),
   `IsOrganizationParticipant` (auto-serviço, **com** jogador), `IsSuperAdmin`.
3. Filtro de queryset — `OrganizationScopedViewSetMixin` corta por
   `request.organization`; rotas de auto-serviço cortam também por
   `request.user`.

O Super Admin entra pelas rotas normais através de um vínculo **sintético**
(`SuperAdminMembership`), não de uma linha no banco. As queries continuam
filtrando por organização; ele apenas pode escolher qualquer uma no cabeçalho.
Para enxergar tudo de uma vez existem rotas dedicadas em `/api/admin/*`.

## 4. Novas entidades

**Identidade e acesso**

| Entidade / campo | Papel |
|---|---|
| `User.is_superadmin` | Acesso transversal, sem `Membership` |
| `Membership.role = "jogador"` | 4º papel, mais restrito que Visualizador |
| `Player.user` (já existia) | Liga a ficha da organização ao login global |

**Financeiro** (app novo `apps/finance/`)

| Tabela | Campos principais |
|---|---|
| `finance_membershipfeeplan` | organização, nome, valor, periodicidade, dia de vencimento, ativo |
| `finance_playermonthlyfee` | organização, player, valor, **competência inicial** (`effective_from`), motivo, `batch` (UUID da alteração em massa), `created_by` |
| `finance_charge` | organização, player, plano, competência (`AAAA-MM`), valor **congelado**, vencimento, status, observações |
| `finance_payment` | organização, charge, valor, data, método, observação, `registered_by`, **`status`**, `cancelled_at`, `cancelled_by`, `cancellation_reason` |
| `finance_recurringexpense` | organização, descrição, valor mensal, dia de vencimento, observações, ativo |
| `finance_expense` | organização, `kind` (`fixed`/`extra`), `recurring`, descrição, valor **congelado**, competência, data de pagamento, `status`, `registered_by`, campos de cancelamento |

Tabelas separadas e não uma: `Charge` é **o que se deve**, `Payment` é **o que
entrou**. Isso é o que permite pagamento parcial, estorno e — no futuro — um
gateway criando `Payment` por webhook sem tocar em `Charge` nem no dashboard.

**`PlayerMonthlyFee` é configuração *e* histórico.** O valor vigente é a última
vigência que já começou; alterar a mensalidade cria uma linha nova a partir de
uma competência, nunca um `UPDATE` na anterior. É o que garante que Jan..Abr
continuem valendo 100 depois de o jogador passar a pagar 120 em Mai.

**`RecurringExpense` → `Expense` espelha `MembershipFeePlan` → `Charge`**: o
cadastro é o contrato do gasto, a despesa é o gasto da competência com o valor
congelado. A geração é idempotente dos dois lados.

**Status "atrasado" nunca é gravado.** É derivado (`vencimento < hoje` e não
pago), como vitória/derrota é derivada dos gols. Um status gravado que envelhece
sozinho exigiria uma rotina para virar e ficaria errado entre execuções.

**Cancelar nunca apaga.** Baixa e despesa cancelada mudam de estado e guardam
quem/quando/por quê, com motivo obrigatório. `paid_amount` só soma baixas
ativas, então o estorno reabre a competência automaticamente.

## 5. APIs

**Novas — administração do sistema** (`IsSuperAdmin`)
- `GET/POST/PATCH/DELETE /api/admin/organizations/`
- `GET/POST/PATCH/DELETE /api/admin/users/`
- `GET/POST/PATCH/DELETE /api/admin/memberships/`
- `GET /api/admin/audit-logs/` — auditoria global, filtrável por organização e ação

**Financeiro** (capacidades `financial.*` de `apps/finance/permissions.py`, salvo indicação)

Mensalidades
- `GET/POST/PATCH /api/finance/charges/` — `DELETE` é **recusado** (400): cancele, não exclua
- `GET /api/finance/charges/` aceita `reference`, `reference_after`, `reference_before`, `player`, `status`, `due_after`, `due_before`, `amount_min`, `amount_max`, `paid_after`, `paid_before`
- `POST /api/finance/charges/{id}/register-payment/` — baixa manual (`financial.register_payment`)
- `POST /api/finance/charges/{id}/cancel/`
- `GET /api/finance/charges/{id}/timeline/` — histórico completo da competência (`financial.view_audit`)
- `POST /api/finance/charges/generate-monthly/` — geração idempotente
- `GET /api/finance/charges/mine/` — auto-serviço (`IsOrganizationParticipant`)

Baixas
- `GET /api/finance/payments/`
- `POST /api/finance/payments/{id}/cancel/` — estorno, **motivo obrigatório** (`financial.cancel_payment`)

Valor da mensalidade (`financial.edit_fee` para escrita)
- `GET /api/finance/member-fees/` — mensalistas com o valor vigente e a situação da competência
- `POST /api/finance/member-fees/set/` — alteração individual com competência inicial
- `GET /api/finance/member-fees/bulk-set/` — **prévia** do impacto (não altera nada)
- `POST /api/finance/member-fees/bulk-set/` — alteração em massa, devolve o `batch`
- `GET /api/finance/member-fees/{player_id}/history/` — histórico de valores

Despesas
- `GET/POST/PATCH /api/finance/expenses/` — `DELETE` recusado (400)
- `POST /api/finance/expenses/{id}/cancel/` — motivo obrigatório
- `POST /api/finance/expenses/generate-fixed/` — lança os custos fixos da competência (idempotente)
- `GET/POST/PATCH/DELETE /api/finance/recurring-expenses/` — cadastro dos custos fixos mensais

Configuração e painel
- `GET/POST/PATCH/DELETE /api/finance/fee-plans/`
- `GET /api/finance/summary/?reference=AAAA-MM` — receita, em aberto, despesas (fixo/extra) e saldo
- `GET /api/finance/capabilities/` — o que **este** usuário pode fazer no financeiro

**Alteradas**
- `GET /api/auth/me/` — passa a expor `is_superadmin`
- Rotas de auto-serviço do jogador (partidas e presença) — ver Fase 2

## 6. Telas

| Tela | Mudança |
|---|---|
| Menu lateral | Itens aparecem conforme o papel; Jogador vê só o essencial |
| **Financeiro** (nova) | Painel com receita, em aberto, despesas e **saldo** da competência, e três abas: |
| ↳ aba **Mensalidades** | Lista com filtros (status, competência, mensalista, período de vencimento, faixa de valor, data de pagamento), baixa manual e acesso à ficha do mensalista |
| ↳ aba **Mensalistas** | Valor vigente de cada um, alteração individual e **alteração em massa com confirmação explícita** (quantidade, valor atual, novo valor, competência inicial, impacto) |
| ↳ aba **Despesas** | Custos fixos mensais e custos extras, cadastro dos fixos, geração da competência e cancelamento com motivo |
| **Ficha do mensalista** (drawer) | Dados → mensalidade atual → histórico de valores → competências → pagamentos → linha do tempo/auditoria |
| **Organizações** (nova, super admin) | CRUD de organizações |
| **Usuários e perfis** (nova, super admin) | Usuários e vínculos por organização |
| Jogadores | Vincular ficha a um login |

## 7. Fases e status

| Fase | Entrega | Status |
|---|---|---|
| **1** | Super Admin: `is_superadmin`, `IsSuperAdmin`, `SuperAdminMembership`, rotas `/api/admin/*`, auditoria global | ✅ **Concluída** |
| **2** | Papel `jogador`: constantes, varredura das rotas, `Player.user` em uso, auto-serviço de partidas e financeiro | ✅ **Concluída** |
| **3** | Financeiro: `MembershipFeePlan`/`Charge`/`Payment`, serviços, API, dashboard | ✅ **Concluída** |
| **4** | Frontend: aba Financeiro, telas de sistema, auto-serviço do jogador, menus por papel | ✅ **Concluída** |
| **5** | Vínculo ficha↔login pela interface, plano de mensalidade, cobrança recorrente automática | ✅ **Concluída** |
| **6** | Fechamento de lacunas contra o pedido original: auditoria de partidas e gestão de pessoas pelo Gerente | ✅ **Concluída** |
| **7** | Gestão completa de mensalidades: valor por mensalista com competência inicial, alteração em massa com `batch`, estorno de baixa não destrutivo, linha do tempo, filtros e capacidades `financial.*` | ✅ **Concluída** |
| **8** | Despesas: custos fixos mensais (cadastro + geração idempotente) e custos extras, com saldo receita × despesa no painel | ✅ **Concluída** |

### Entregue na Fase 5

- **Vínculo ficha↔login pela interface** (`Player.user` gravável). Era o que
  bloqueava o perfil Jogador de ser usável: sem vínculo, "Minhas Partidas" e
  "Minhas Mensalidades" não encontram nada. O formulário lista os membros da
  organização e **desabilita** quem já tem ficha, mostrando de quem é. Duas
  travas no servidor: só membro desta organização, e no máximo **uma ficha por
  login por organização** — sem ela, `_my_player()` escolheria uma por ordem de
  id e o jogador confirmaria presença como outra pessoa.
- **Plano de mensalidade** (`MembershipFeePlan`) com tela própria.
- **Geração recorrente**: task Celery diária (`generate_recurring_charges_task`,
  03:30) + botão "Gerar mês" para não esperar a madrugada. Idempotente nos dois
  caminhos. Só mensalistas ativos e não temporários entram.

### Fase 6 — lacunas encontradas na revisão final

Relendo o pedido original contra o que estava implementado, duas coisas faltavam:

1. **Auditoria de partidas.** O pedido lista "criação de partidas" e "edição de
   partidas" entre as ações auditáveis, e só o sorteio e a presença eram
   registrados. Entraram `match_created`, `match_updated` e `match_canceled`. A
   edição grava **só os campos que mudaram** — um PATCH de local não enche a
   trilha com dez campos idênticos. No frontend, o filtro da tela de Auditoria
   passou a ser derivado de `AUDIT_ACTION_LABELS`, então acrescentar uma ação é
   um lugar só.

2. **Gerente administrando a própria organização.** A matriz previa "gerenciar
   usuários e perfis: Gerente — só da org", mas só existiam as rotas
   `/api/admin/*` do Super Admin. Entrou `/api/auth/members/` (tenant-scoped,
   `IsOrganizationOrganizerOrAdmin`) e a tela **Pessoas**.
   - O **e-mail é a chave**: se já existe login com ele, o vínculo aponta para
     esse login — a mesma pessoa não vira dois cadastros ao entrar na segunda
     pelada. Só um e-mail desconhecido pede senha inicial.
   - **Remover é desativar o vínculo**, não apagar: o histórico (presenças,
     sorteios, mensalidades) fica, e o login continua valendo nas outras
     organizações.
   - **Trava do último gerente**: sem ela, um gerente rebaixava a si mesmo e
     trancava todo mundo para fora da gestão da própria pelada — só um Super
     Admin destravaria depois.

### O que sobrou, e por que não foi feito

Renomear o papel `organizador` para `gerente` **no banco**. O rótulo exibido já
é "Gerente" em toda a interface; só o valor gravado continua `organizador`.
Seria migração de dados pura tocando ~30 rotas, os testes e o frontend, com
**zero** ganho para quem usa — e risco real de regressão de permissão. Fica
registrado como dívida consciente, para ser feito junto de alguma outra mudança
em `Membership` que já justifique o risco.

## 8. Migração dos dados atuais

1. `is_superadmin = False` para todos; promoção explícita e manual de quem for
   indicado (não há super admin automático).
2. `Player.user` continua nulo — o campo já era nullable, nada quebra. A
   vinculação é sob demanda.
3. Papéis atuais preservados sem conversão: `admin` e `organizador` seguem sendo
   gestão; `visualizador` intacto. Nenhum usuário existente muda de papel.
4. Financeiro nasce vazio — nenhuma cobrança retroativa é inventada.

Todas as migrations são aditivas (campos com default, tabelas novas). Não há
`RemoveField` nem `AlterField` destrutivo nesta entrega.

## 9. Riscos e como estão sendo tratados

| Risco | Gravidade | Mitigação |
|---|---|---|
| Papel `jogador` vazar acesso por rota esquecida | 🔴 Alto | Teste que varre as rotas × papéis exigindo negação explícita; o papel entra **negando por padrão** (fora de `IsOrganizationMember`) |
| Super admin furar o isolamento multi-tenant | 🔴 Alto | Vínculo sintético; as queries continuam filtrando por organização; visão global só em `/api/admin/*` |
| `is_superadmin` confundido com `is_superuser` | 🟡 Médio | Campo próprio; `is_superuser` continua sendo só do Django admin |
| Financeiro acoplar ao sorteio | 🟡 Médio | App isolado, sem FK de `matches`/`draws` para `finance` |
| Quebrar as 264 regras já cobertas | 🟡 Médio | Suíte inteira roda a cada fase; nenhuma fase entra com teste vermelho |
| Cabeçalho de organização malformado | 🟢 Baixo | Já corrigido: `X-Organization-Id` não numérico agora dá 403, não 500 |

## 10. Estratégia contra regressão

- A suíte existente (264 testes) é o contrato do comportamento atual e roda
  inteira a cada fase.
- Toda migration é aditiva; nenhum dado existente é reescrito.
- Nenhum papel atual muda de permissão: o `jogador` é acrescentado, não
  substitui ninguém.
- Cada fase adiciona os próprios testes de permissão **antes** de a rota entrar
  em uso pela interface.

## 11. O que esta arquitetura já suporta (sem nova migração)

- **Novos papéis** — acrescentar em `ROLE_CHOICES` e nas tuplas de permissão.
- **Gateways de pagamento** — novo valor em `Payment.Method` + webhook criando
  o `Payment`; `Charge` e dashboard intactos.
- **Pagamento parcial e estorno** — já modelados (N `Payment` por `Charge`).
- **Mensalidade recorrente automática** — `MembershipFeePlan` já tem valor,
  periodicidade e dia de vencimento; falta só a task Celery que gera as
  cobranças (mesmo padrão de `generate_upcoming_matches_task`).
- **Convite por e-mail** — `OrganizationInvite` encaixa sem tocar em
  `Membership`.
- **Cobrança avulsa** (churrasco, arbitragem) — `Charge` sem `plan`.
