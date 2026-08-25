# Plano de implementação — Financeiro, Mensalidades e Confirmações

> **Status:** ✅ **implementado** — as dez fases foram executadas; o que resta são apenas validações manuais em navegador e banco, marcadas item a item na [§13](#13-checklist-por-fase).
> **Data da análise:** 10/08/2026 · **conferência do estado do código:** 14/08/2026 · competência corrente na análise: `2026-08`
> **Fonte:** leitura do código em `backend/`, `frontend/`, `docs/` e **consulta ao banco de produção local** (organização 1, "Pelada dos Amigos", 20 mensalistas).
>
> **Portões de validação em 14/08/2026:** `ruff check .` limpo · `pytest -q` **723 passando** · `tsc --noEmit` limpo · `npm run lint` sem erro (só avisos pré-existentes de *fast refresh*) · `vitest run` **250 passando em 18 arquivos** · `npm run build` verde.
>
> Os problemas descritos na [§3](#3-problemas-identificados) são o **estado anterior**, não o atual — o documento foi mantido como registro do diagnóstico.

---

## 1. Objetivo

Corrigir e completar três áreas do sistema, sem quebrar o que já funciona:

1. **Financeiro** — acabar com a divergência entre o valor da mensalidade configurado e o valor exibido/cobrado; tornar vencimento e multa configuráveis; permitir baixa em massa.
2. **Despesas** — deixar a tela exclusivamente de despesas e completar o ciclo de vida (vencimento, pagamento, edição).
3. **Confirmações** — o Jogador precisa ver quem confirmou; e garantir (com teste) que cada partida recorrente nasce zerada.

O sistema **já tem** uma arquitetura financeira madura (competência, congelamento de valor histórico, soft-delete, auditoria append-only). Este plano **não** a reescreve — ele fecha as lacunas que a tornam confusa na prática.

---

## 2. Contexto atual encontrado no projeto

### 2.1 Arquitetura financeira (já existente e correta)

`backend/apps/finance/models.py` separa quatro entidades, e essa separação é a razão de o histórico não se corromper:

| Entidade | Papel | Arquivo |
|---|---|---|
| `MembershipFeePlan` | O contrato da organização: valor base, periodicidade, **dia de vencimento** | [models.py:34](backend/apps/finance/models.py:34) |
| `PlayerMonthlyFee` | Quanto **um jogador** paga **a partir de qual competência**. É configuração *e* histórico | [models.py:56](backend/apps/finance/models.py:56) |
| `Charge` | Uma cobrança concreta, com o valor **congelado** na geração | [models.py:117](backend/apps/finance/models.py:117) |
| `Payment` | Um recebimento contra uma cobrança | [models.py:298](backend/apps/finance/models.py:298) |

Três invariantes documentadas e respeitadas em `services.py`:

1. **Competência ≠ data de pagamento** — `Charge.reference` manda.
2. **Valor histórico é imutável** — o valor vai para a `Charge` e não é reescrito.
3. **Nada é destruído** — cancelar baixa muda estado, não apaga.

### 2.2 A fonte da verdade do valor **já existe**

[`fee_amount_for(player, reference)`](backend/apps/finance/services.py:107) é a função única:

```
vigência mais recente com effective_from <= reference
  → se não houver, MembershipFeePlan.amount
```

Ela é usada por `generate_recurring_charges` ([services.py:918](backend/apps/finance/services.py:918)) e por `bulk_change_preview`. **Não há segunda fonte da verdade no backend.**

### 2.3 Estado real do banco (evidência)

```
Competência corrente ......... 2026-08
Plano ativo .................. "Mensalidade" R$ 90,00 · vencimento dia 15
Vigências PlayerMonthlyFee ... 20 em 2026-08 (R$ 90,00) + 20 em 2026-09 (R$ 90,00)
Charges de 2026-08 ........... 16 × R$ 45,00 (pendente)
                                3 × R$ 80,00 (pendente)
                                1 × R$ 80,00 (paga)
Despesas ..................... 2 (1 fixa, 1 extra)
Partidas ..................... 1 (#25, 11/08/2026, sorteada, 18 confirmados / 24 linhas)
```

### 2.4 Confirmações e partidas recorrentes

- `Confirmation` é **por partida**, com `UniqueConstraint(match, player)` ([matches/models.py:385](backend/apps/matches/models.py:385)).
- [`ensure_next_match()`](backend/apps/matches/services.py:142) cria a próxima ocorrência com `Match.objects.create(...)` — **nenhuma confirmação é copiada**. Não existe nenhum código de cópia de confirmações no projeto (verificado por varredura em `services.py`, `tasks.py`, `signals.py`).
- [`confirmed_confirmations()`](backend/apps/matches/services.py:271) é a fonte única do contador, do sorteio e da capacidade.

### 2.5 Permissões atuais

`backend/common/permissions.py` + `backend/apps/finance/permissions.py`:

| Papel | Financeiro | Roster da partida |
|---|---|---|
| `admin` / `organizador` ("Gerente") | todas as capacidades | sim |
| `visualizador` | **nenhuma** (decisão de produto: vê a operação, não o dinheiro) | sim |
| `jogador` | só auto-serviço `/charges/mine/` | **não** |

`MatchViewSet.READ_ACTIONS = ("list", "retrieve", "roster", "waitlist")` exige `IsOrganizationMember`, que **exclui o jogador por design** ([views.py:113](backend/apps/matches/views.py:113)).

---

## 3. Problemas identificados

### P1 — 🔴 CRÍTICO · O valor novo não aparece na aba de mensalidades

**Não é um bug de "fonte da verdade".** São três causas somadas:

**Causa A — o diálogo altera o mês errado.**
[`ChangeFeeDialog.tsx:63`](frontend/src/features/finance/ChangeFeeDialog.tsx:63):

```ts
const [effectiveFrom, setEffectiveFrom] = useState(() => nextReference(currentReference()));
```

O padrão é **o mês que vem**. `MemberFeeView` lista com `reference = current_reference()` e filtra `effective_from__lte=reference` ([views.py:388](backend/apps/finance/views.py:388)) — uma vigência de setembro é invisível em agosto. O organizador altera, não vê mudar, e altera de novo. **É exatamente o que o banco mostra: 20 vigências duplicadas, uma em `2026-08` e outra em `2026-09`, ambas R$ 90,00.**

**Causa B — a competência já lançada não é ressincronizada.**
As `Charge` de `2026-08` foram geradas quando o valor era R$ 45,00/R$ 80,00. A vigência agora diz R$ 90,00, mas **não existe nenhuma operação** que aplique o novo valor às cobranças já lançadas e ainda em aberto. `update_charge` ([services.py:389](backend/apps/finance/services.py:389)) é individual e manual.

**Causa A' — a salvaguarda existe, mas o padrão a neutraliza.**
`ChangeFeeDialog` já exibe o aviso *"N mensalidade(s) de X já estão lançadas e continuam com o valor antigo"* ([ChangeFeeDialog.tsx:148](frontend/src/features/finance/ChangeFeeDialog.tsx:148)), alimentado por `bulk_change_preview.already_charged` — exatamente a proteção que `docs/REGRAS_DE_NEGOCIO.md` §14.3 promete.

Só que ele conta as cobranças **da competência escolhida**. Como o padrão é o mês que vem, e o mês que vem nunca tem cobrança lançada, `already_charged` é sempre `0` e **o aviso nunca aparece**. A proteção certa, apontada para o mês errado.

**Causa C — a tela mostra os dois números sem explicar.**
`FinancePage` tem três abas ([FinancePage.tsx:734](frontend/src/features/finance/FinancePage.tsx:734)):

| Aba | O que exibe | Valor hoje |
|---|---|---|
| **Mensalidades** (`charges`) | `Charge.amount` — congelado | R$ 45,00 / R$ 80,00 |
| **Mensalistas** (`members`) | `fee_amount_for` — vigente | R$ 90,00 |

Dois números corretos, contraditórios na mesma tela, sem uma palavra de explicação.

### P2 — 🟠 ALTO · Não existe baixa em massa

`ChargeViewSet.register_payment_action` ([views.py:186](backend/apps/finance/views.py:186)) é `detail=True` — uma cobrança por vez. Dar baixa em 20 mensalistas são 20 diálogos.
A aba **Mensalistas** já tem seleção múltipla (`selectedMembers`, [FinancePage.tsx:670](frontend/src/features/finance/FinancePage.tsx:670)) para alteração de valor — o padrão de UI existe e deve ser reaproveitado, não recriado.

### P3 — 🟡 MÉDIO · A aba Despesas está limpa, mas a moldura da página não

As colunas da aba são exclusivamente de `Expense` ([FinancePage.tsx:608–667](frontend/src/features/finance/FinancePage.tsx:608)). O problema está **fora** da aba: `PageHeader` e os cartões de resumo são renderizados **antes** das `Tabs` e ficam visíveis nas três. Com a aba Despesas aberta, o organizador continua vendo:

- botões **"Nova mensalidade"**, **"Gerar mês"**, **"Plano: R$ 90,00"**;
- cartões de **receita** (previsto, arrecadado, em aberto).

### P4 — 🟡 MÉDIO · `Expense` não tem vencimento nem ciclo de pagamento

| Campo pedido | Existe? | Observação |
|---|---|---|
| Descrição | ✅ | |
| Valor | ✅ | |
| **Data de vencimento** | ❌ | não existe |
| Status | ⚠️ | só `registered` / `canceled` — não há pendente/paga |
| **Data de pagamento** | ⚠️ | `incurred_on` mistura "quando venceu" com "quando foi paga" |
| Observação | ✅ | `notes` |

Não há **edição** de despesa: `ExpenseViewSet` permite criar e cancelar; `update` existe pelo `ModelViewSet` mas nenhuma tela usa, e não passa por service nem audita.

### P5 — 🟢 BAIXO · Vencimento configurável **já existe**

`MembershipFeePlan.due_day` (default 10) é editável em [`FeePlanDrawer.tsx:82`](frontend/src/features/finance/FeePlanDrawer.tsx:82), e [`_due_date_for()`](backend/apps/finance/services.py:87) já trata mês curto (dia 31 escorrega para o último dia). **Nada a fazer além de testes.** Hoje está configurado como dia 15.

### P6 — 🔴 CRÍTICO (requisito novo) · Multa por atraso não existe

Nenhum campo, service ou cálculo de multa em todo o backend. `Charge.is_overdue` existe, mas é só um booleano para exibição.

### P7 — 🟠 ALTO · O Jogador não vê quem confirmou

`roster` exige `IsOrganizationMember`, que exclui `jogador`. A tela dele ([MyMatchesPage.tsx:90](frontend/src/features/matches/MyMatchesPage.tsx:90)) mostra apenas `👥 {confirmed_count} de {max_players} confirmados` — o número, nunca os nomes.

⚠️ **Cuidado de privacidade:** o `roster` devolve `PlayerSerializer` completo — telefone, nível técnico, observações. **Não pode ser simplesmente liberado para o jogador.**

### P8 — ✅ Partida recorrente zerada — **já funciona**

Verificado no código: `ensure_next_match` cria a partida sem tocar em `Confirmation`. Não há cópia em lugar nenhum.

**Uma exceção legítima e documentada:** no modo `force=True` (botão "Gerar partida agora"), uma ocorrência **removida** é revivida — e a reabertura "**revive o mesmo registro**, preservando id, confirmações e histórico" ([services.py:157](backend/apps/matches/services.py:157)). Isso é intencional (desfazer uma remoção acidental), não é o fluxo de nova ocorrência.

⚠️ **NECESSITA VALIDAÇÃO** — Com apenas **uma** partida no banco não é possível observar o comportamento em duas ocorrências consecutivas. O código está correto; **a ação aqui é travar isso com teste de regressão**, não alterar código. Se o usuário observou confirmações "herdadas", a hipótese mais provável é ter visto **a mesma partida** (idempotência devolvendo o registro existente), não uma nova contaminada.

---

## 4. Regras de negócio (a definir/confirmar)

### RN-1 — Fonte única do valor da mensalidade

`fee_amount_for(player, reference)` é **a** fonte. Nenhuma camada calcula valor por fora.

### RN-2 — O que pode e o que não pode ser retroativo

| Situação da cobrança | Alterar valor? | Por quê |
|---|---|---|
| **Paga** (baixa ativa cobrindo o total) | ❌ **nunca** | O dinheiro entrou; mudar o valor falsifica a prestação de contas |
| **Com baixa parcial ativa** | ❌ não | Já existe `DomainError` em [`update_charge`](backend/apps/finance/services.py:408) |
| **Cancelada** | ❌ não | Já existe `DomainError` |
| **Pendente, sem baixa** | ✅ **sim, por ação explícita** | Ninguém pagou ainda; é corrigir antes de cobrar |

### RN-3 — Ressincronização é **opt-in**, nunca automática

Alterar a vigência **não** dispara atualização das cobranças. O organizador pede: *"Aplicar R$ 90,00 às 19 mensalidades em aberto de Ago/2026?"*, vê a prévia, confirma. Automático violaria "não alterar retroativamente".

### RN-4 — Multa: **congelada na cobrança, derivada na exibição**

| Momento | Regra |
|---|---|
| **Geração da cobrança** | `Charge.late_fee_amount` recebe o valor do plano — **congelado**, exatamente como `amount` e `due_date` |
| **Exibição de cobrança em aberto** | multa prevista = `late_fee_amount` se `hoje > due_date`, senão `0` |
| **Baixa** | multa devida = `late_fee_amount` se **`paid_at` > `due_date`**, senão `0` |

**A multa nunca é gravada como estado.** Isso torna "aplicar duas vezes" **impossível por construção** — é a mesma decisão de projeto de `is_overdue`, que o módulo já documenta: *"'Atrasado' nunca é gravado: seria um estado que envelhece sozinho"* ([models.py:151](backend/apps/finance/models.py:151)).

A multa depende de **`paid_at`, não de "hoje"** — é o que faz o exemplo do requisito funcionar: pagou dia 08 → R$ 100; dia 09 ou dia 15 → R$ 110. Lançar hoje uma baixa retroativa de um pagamento feito no dia 08 **não** cobra multa.

⚠️ **Não confundir duas "multas".** `docs/REGRAS_DE_NEGOCIO.md` §14.7 já usa a palavra num sentido diferente: uma multa que **a pelada paga** é um custo extra (`Expense.kind=extra`). A multa deste plano é o acréscimo que **o mensalista paga** por atraso. São lados opostos do caixa — nomear o campo `late_fee_amount` (e não `fine`) mantém a distinção legível.

**Multa é valor fixo** (`R$ 10,00`), não percentual, conforme os exemplos do requisito. Percentual e juros por dia ficam de fora — o desenho permite acrescentá-los depois com um campo `late_fee_mode`, sem migração destrutiva.

### RN-5 — Quando a cobrança fica "paga" com multa

`_sync_charge_status` ([services.py:466](backend/apps/finance/services.py:466)) compara o pago com `charge.amount`. Com multa, o alvo passa a ser `amount + multa devida`.

⚠️ **Risco de regressão** — mudar esse comparador afeta **toda** cobrança. Mitigação obrigatória: com `late_fee_amount = 0` (o padrão de tudo que já existe), o comportamento tem de ser **bit a bit idêntico** ao de hoje. Teste específico para isso.

### RN-6 — Vencimento em mês curto

Já resolvido: `min(due_day, último dia do mês)`. Dia 31 em fevereiro → 28/29. **Manter e testar.**

### RN-7 — Baixa em massa: cada cobrança é tratada individualmente

Uma seleção com situações mistas **não** é uma transação tudo-ou-nada. Cada cobrança é processada por si; a resposta diz o que entrou e o que não entrou, com motivo. Uma cobrança já paga é **pulada**, não é erro — dupla baixa é impossível.

### RN-8 — O que o Jogador vê da lista de confirmados

**Pode ver:** nome/apelido de quem confirmou, contagem, capacidade.
**Não pode ver:** telefone, nível técnico, observações, posição, valores financeiros de terceiros.
**Não pode fazer:** alterar a confirmação de outra pessoa.

### RN-9 — Nova ocorrência nasce zerada

Confirmação é **por partida**. Nova ocorrência = zero confirmados, lista vazia. Exceção única e explícita: reabertura de partida removida (`force=True`).

---

## 5. Arquitetura atual relacionada

### 5.1 Endpoints financeiros existentes (mapeados antes de criar qualquer novo)

| Método | Rota | View | Permissão |
|---|---|---|---|
| GET/POST/PATCH | `/api/finance/charges/` | `ChargeViewSet` | `CanManageFinancial` |
| POST | `/api/finance/charges/{id}/register-payment/` | ação | `CanRegisterPayment` |
| POST | `/api/finance/charges/{id}/cancel/` | ação | `CanManageFinancial` |
| GET | `/api/finance/charges/{id}/timeline/` | ação | `CanViewFinancialAudit` |
| POST | `/api/finance/charges/generate-monthly/` | ação | `CanManageFinancial` |
| GET | `/api/finance/charges/mine/` | ação | auto-serviço |
| POST | `/api/finance/payments/{id}/cancel/` | ação | `CanCancelPayment` |
| GET/POST/PATCH | `/api/finance/fee-plans/` | `MembershipFeePlanViewSet` | `CanEditFee` |
| GET/POST/PATCH | `/api/finance/recurring-expenses/` | `RecurringExpenseViewSet` | `CanManageFinancial` |
| GET/POST | `/api/finance/expenses/` | `ExpenseViewSet` | `CanManageFinancial` |
| POST | `/api/finance/expenses/{id}/cancel/` | ação | `CanManageFinancial` |
| POST | `/api/finance/expenses/generate-fixed/` | ação | `CanManageFinancial` |
| GET | `/api/finance/member-fees/` | `MemberFeeView` | `CanViewFinancial` |
| POST | `/api/finance/member-fees/set/` | `SetMemberFeeView` | `CanEditFee` |
| GET/POST | `/api/finance/member-fees/bulk-set/` | `BulkSetMemberFeeView` | `CanEditFee` |
| GET | `/api/finance/member-fees/{id}/history/` | `MemberFeeHistoryView` | `CanViewFinancial` |
| GET | `/api/finance/summary/` | `FinancialSummaryView` | `CanViewFinancial` |
| GET | `/api/finance/capabilities/` | `FinancialCapabilitiesView` | participante |

**Reaproveitamento:** `bulk-set` já é o modelo de operação em lote (resolve a lista no servidor, `batch` UUID, prévia no GET, auditoria de lote + individual). A baixa em massa deve **seguir esse mesmo desenho**, não inventar outro.

### 5.2 Endpoints de partida relevantes

| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/matches/{id}/roster/` | `IsOrganizationMember` (**exclui jogador**) |
| GET | `/api/matches/mine/` | `IsOrganizationParticipant` |
| POST | `/api/matches/{id}/confirm-me/` | `IsOrganizationParticipant` |
| POST | `/api/matches/{id}/set-confirmation/` | Gerente |

### 5.3 Auditoria

`AuditLog` ([apps/audit/models.py:11](backend/apps/audit/models.py:11)) já registra: organização, partida, sorteio, usuário, ação, jogador, `entity`/`entity_id`, `before`, `after`, `reason`, `created_at`.

⚠️ **Restrição técnica descoberta:** `action = models.CharField(max_length=30)`. Todo nome de ação nova precisa caber em **30 caracteres**.

---

## 6. Alterações de banco

> Princípio: **nenhuma tabela nova.** As entidades necessárias já existem; faltam campos.

### 6.1 `finance.MembershipFeePlan` — configuração da multa

| Campo | Tipo | Default | Nulo |
|---|---|---|---|
| `late_fee_amount` | `DecimalField(max_digits=10, decimal_places=2)` | `0` | não |

- Default `0` = comportamento atual preservado para todas as organizações existentes.
- Sem backfill necessário.

### 6.2 `finance.Charge` — multa congelada

| Campo | Tipo | Default | Nulo |
|---|---|---|---|
| `late_fee_amount` | `DecimalField(max_digits=10, decimal_places=2)` | `0` | não |

- **Backfill: nenhum.** As 20 cobranças de `2026-08` existentes ficam com `0` — que é a verdade: foram geradas quando não havia multa. Preenchê-las retroativamente **inventaria uma dívida que nunca existiu**.

### 6.3 `finance.Expense` — vencimento informativo

> ✅ **Decidido (§16):** despesa é um **gasto consumado**. Sem ciclo pendente → paga.

| Campo | Tipo | Default | Nulo |
|---|---|---|---|
| `due_date` | `DateField` | — | sim (`null=True`) |

**Um único campo, sem backfill.**

- `Expense.Status` **não muda**: continua `registered` / `canceled`.
- `paid_on` **não é criado**. `incurred_on` já é *"a data em que a despesa foi paga/realizada"* — um segundo campo com o mesmo significado seria a duplicação que o §14.0 do `REGRAS_DE_NEGOCIO.md` existe para evitar. A tela apenas rotula melhor: `due_date` = "Vencimento", `incurred_on` = "Pago em".
- `expenses_summary` e `financial_summary` ficam **intocados** — o saldo exibido hoje não muda. Era o único risco de regressão da Fase 4, e ele deixou de existir.
- As 2 despesas existentes recebem `due_date = NULL`, que é honesto: elas foram lançadas antes de o campo existir.

### 6.4 `audit.AuditLog.Action` — novas ações (todas ≤ 30 caracteres)

| Constante | Valor | Tamanho | Rótulo |
|---|---|---|---|
| `PAYMENT_BULK_REGISTERED` | `payment_bulk_registered` | 23 | Baixa em massa |
| `CHARGES_RESYNCED` | `charges_resynced` | 16 | Valores ressincronizados |
| `EXPENSE_UPDATED` | `expense_updated` | 15 | Despesa alterada |
| `FEE_PLAN_CHANGED` | `fee_plan_changed` | 16 | Plano de mensalidade alterado |

`ALTERAÇÃO_VENCIMENTO` e `ALTERAÇÃO_MULTA` do requisito ficam **cobertas por `fee_plan_changed`** com `before`/`after` — são dois campos do mesmo plano, e duas ações separadas para o mesmo `UPDATE` fragmentariam a trilha.
`CRIAÇÃO_PARTIDA_RECORRENTE` já existe como `match_created`. `RESET_CONFIRMADOS` **não deve existir**: não há reset — a partida nasce vazia, e auditar um evento que não acontece polui a trilha.

### 6.5 Índices e constraints

- **Nenhum índice novo.** As consultas de multa usam `due_date` e `status`, já cobertos por `Index(organization, status, due_date)` em `Charge`.
- **Nenhuma constraint nova.** A anti-duplicidade da baixa em massa vem da regra de negócio (pular cobrança já paga), não de constraint — múltiplos `Payment` por `Charge` são legítimos (pagamento parcial).
- ⚠️ Se `Expense` ganhar `due_date`, avaliar `Index(organization, reference, status)` **somente se** a listagem passar a filtrar por vencimento.

### 6.6 Preservação de dados existentes

| Dado | Quantidade | Tratamento |
|---|---|---|
| Charges | 20 (`2026-08`) | Intocadas. `late_fee_amount = 0` |
| Payments | 1 ativa | Intocada |
| PlayerMonthlyFee | 40 vigências | Intocadas. Ver §10 sobre a duplicação `2026-08`/`2026-09` |
| Expenses | 2 | `due_date = NULL`. `incurred_on` e `status` intocados |
| Confirmations | 24 (partida #25) | Intocadas |
| Matches | 1 | Intocada |

---

## 7. Alterações de backend

### 7.1 Ressincronização de cobranças em aberto (P1)

**Arquivo:** `backend/apps/finance/services.py`

```
resync_pending_charges(*, organization, reference, players=None, performed_by) -> dict
```

- Seleciona `Charge` da competência com `status=PENDING` **e sem nenhum `Payment` ativo**.
- Para cada uma, compara `charge.amount` com `fee_amount_for(player, reference)`; se diferir, atualiza via `update_charge` (que já valida e audita).
- Devolve `{updated: [...], skipped: [{charge_id, reason}], unchanged: N}`.
- Audita o lote com `CHARGES_RESYNCED` (`before.amounts`, `after.amount`, `players_count`), além do `charge_updated` individual que `update_charge` já emite.

**Prévia (GET):** `resync_preview(...)` no mesmo desenho de `bulk_change_preview` — quantas mudam, de quais valores para qual, quantas são puladas e por quê.

**Endpoints** (`backend/apps/finance/urls.py` + `views.py`):

| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/finance/charges/resync-preview/` | `CanEditFee` |
| POST | `/api/finance/charges/resync/` | `CanEditFee` |

### 7.2 Multa por atraso (P6)

**`models.py`:**
- `MembershipFeePlan.late_fee_amount`
- `Charge.late_fee_amount`
- `Charge.late_fee_due` (property) — `late_fee_amount` se `is_overdue` senão `0`
- `Charge.total_due` (property) — `amount + late_fee_due`
- `Charge.outstanding` — passa a considerar `total_due` ⚠️ ver RN-5

**`services.py`:**
- `late_fee_for(charge, *, on: date) -> Decimal` — a **única** função que decide se há multa. `on` é `paid_at` na baixa e `hoje` na exibição.
- `generate_recurring_charges` — congela `late_fee_amount=plan.late_fee_amount` na criação.
- `create_charge` — aceita `late_fee_amount`.
- `register_payment` — calcula a multa com `paid_at`, grava no `after` da auditoria (`late_fee`), e `_sync_charge_status` passa a comparar com `total_due`.
- `update_fee_plan(...)` — novo service que audita `fee_plan_changed` com `before`/`after` (hoje o `MembershipFeePlanViewSet` grava direto pelo `ModelViewSet`, **sem auditoria**).

**`serializers.py`:** `ChargeSerializer` expõe `late_fee_amount`, `late_fee_due`, `total_due` — **separados**, nunca somados num único campo, para a tela poder mostrar "R$ 100,00 + R$ 10,00 de multa".

### 7.3 Baixa em massa (P2)

**`services.py`:**

```
bulk_register_payments(*, organization, charge_ids, paid_at, method, notes, registered_by) -> dict
```

- Resolve as cobranças **no servidor**, filtrando por `organization` (isolamento multi-tenant).
- Para cada uma, em `try/except DomainError`:
  - já paga → `skipped: "já estava paga"`;
  - cancelada → `skipped: "cancelada"`;
  - senão → `register_payment(amount=charge.total_due - charge.paid_amount, paid_at=...)`.
- **Sem `@transaction.atomic` no lote** — cada baixa é atômica em si (`register_payment` já é). Um lote atômico faria uma cobrança problemática desfazer 19 baixas boas, o oposto do requisito.
- `batch` UUID compartilhado; audita `PAYMENT_BULK_REGISTERED` com `charge_ids`, `processed`, `skipped`.
- Devolve `{batch, processed: [{charge_id, player_name, amount, late_fee}], skipped: [{charge_id, player_name, reason}]}`.

**Endpoint:** `POST /api/finance/charges/bulk-register-payment/` · `CanRegisterPayment`

### 7.4 Despesas (P3, P4)

- `Expense.due_date` nos serializers e no `ExpenseFilter` (§16: campo informativo, sem `paid_on`).
- `update_expense(...)` em `services.py` — hoje não existe; a edição precisa auditar (`EXPENSE_UPDATED`) e recusar despesa cancelada.
- `ExpenseViewSet.update` passa a delegar ao service (hoje o `ModelViewSet` grava direto, sem auditoria).

### 7.5 Lista de confirmados para o Jogador (P7)

**`backend/apps/matches/views.py`** — nova ação em `MatchViewSet`:

```
@action(detail=True, methods=["get"], url_path="confirmed")
```

- Entra em `SELF_SERVICE_ACTIONS` → `IsOrganizationParticipant`.
- Devolve **apenas**: `{id, name, nickname, confirmed_at}` por confirmado + `{confirmed_count, capacity}`.
- **Serializer novo e enxuto** (`ConfirmedPlayerSerializer`) — **não** reutilizar `PlayerSerializer`, que carrega telefone, nível e observações.
- Fonte: `confirmed_confirmations(match)` — a mesma do contador e do sorteio, para os números nunca divergirem.

⚠️ **Regra de escrita da ação:** `SELF_SERVICE_ACTIONS` é documentado como *"nunca colocar aqui uma rota que aceite o id de outro jogador vindo do cliente"*. Esta ação **não aceita id de jogador** — ela lista os confirmados da partida, que é informação coletiva da pelada. Registrar essa justificativa no código.

### 7.6 O que **não** muda

- `ensure_next_match` / `generate_upcoming_matches` — corretos (P8). Só ganham teste.
- Motor de sorteio (`apps/draws/domain/`) — intocado.
- `fee_amount_for` — intocada; é a fonte da verdade e está certa.

---

## 8. Alterações de frontend

### 8.1 Financeiro — mensalidade (P1)

| Arquivo | Alteração |
|---|---|
| `ChangeFeeDialog.tsx:63` | Padrão de `effectiveFrom` = **competência corrente**. Com o padrão corrigido, o aviso `already_charged` da linha 148 volta a disparar sozinho |
| `ChangeFeeDialog.tsx` | **Caixa opcional, desmarcada por padrão** (§16): *"Aplicar também às 19 mensalidades em aberto de Ago/2026"*. Só aparece quando há cobranças em aberto naquela competência. Cobrança paga nunca é tocada |
| `FinancePage.tsx` (aba Mensalistas) | Alerta quando `current_amount` ≠ valor da cobrança em aberto da competência, com atalho para o diálogo de alteração |
| `FinancePage.tsx` (aba Mensalidades) | Coluna de valor mostra `R$ 45,00` com aviso quando divergir da vigência |

### 8.2 Financeiro — multa e vencimento (P5, P6)

| Arquivo | Alteração |
|---|---|
| `FeePlanDrawer.tsx` | Campo **"Multa por atraso (R$)"** ao lado de "Dia do vencimento" |
| `ChargeCard.tsx` | Linha separada: `R$ 100,00 + R$ 10,00 (multa) = R$ 110,00`. Nunca só o total |
| `RegisterPaymentDialog.tsx` | Valor sugerido = `total_due`; aviso quando a multa incide; recalcular ao mudar a data do pagamento |
| `MyChargesPage.tsx` | O jogador vê a multa separada, com o motivo ("vencida em 15/08") |

### 8.3 Financeiro — baixa em massa (P2)

| Arquivo | Alteração |
|---|---|
| `FinancePage.tsx` (aba Mensalidades) | Seleção por linha + barra de ação, **reaproveitando** o padrão de `selectedMembers` já existente na aba Mensalistas |
| Novo: `BulkPaymentDialog.tsx` | Data, método, observação; prévia com total e quantas serão puladas |
| Resultado | Toast + painel de resultado: *"18 baixas registradas · 2 puladas (já pagas)"*, com a lista das puladas |

Atualização sem recarregar: `queryStore.invalidate(financeKeys.charges())` + `.summary()` — o padrão já usado no módulo.

### 8.4 Despesas (P3, P4)

| Arquivo | Alteração |
|---|---|
| `FinancePage.tsx` | Mover `PageHeader` (ações) e cartões de resumo para **dentro** de cada aba, ou condicioná-los à aba ativa. Com "Despesas" aberta: só ações e totais de despesa |
| `ExpenseFormDialog.tsx` | Campo `due_date` ("Vencimento"); suportar **edição**, não só criação |
| `FinancePage.tsx` (colunas) | Coluna "Vencimento" (`due_date`). "Pago em" continua vindo de `incurred_on` — só o rótulo fica explícito |

### 8.5 Confirmados para o Jogador (P7, item 10)

`MyMatchesPage.tsx` — cartão ganha seção expansível:

```
Próximo Baba
Confirmados: 0
Nenhum jogador confirmou presença ainda.
```

```
Confirmados: 8
✓ João   ✓ Pedro   ✓ Carlos   ✓ Marcos …
```

- **Mobile first:** lista em coluna a 375px; `Accordion` fechado por padrão para o cartão não crescer (o cartão da partida já foi otimizado uma vez por causa de altura — ver `docs/PLANO_MOBILE_UX_SORTEIO.md`, problema P-24).
- Nenhum controle de edição. Só o botão de **auto-confirmação** que já existe.

---

## 9. Alterações de permissões

| Operação | Papel exigido | Como |
|---|---|---|
| Ressincronizar cobranças | Gerente/Admin | `CanEditFee` (existente) |
| Baixa em massa | Gerente/Admin | `CanRegisterPayment` (existente) |
| Configurar multa/vencimento | Gerente/Admin | `CanEditFee` (existente) |
| Editar despesa | Gerente/Admin | `CanManageFinancial` (existente) |
| Ver confirmados da partida | **qualquer participante, incl. Jogador** | `IsOrganizationParticipant` |

**Nenhuma capacidade nova.** O modelo de `apps/finance/permissions.py` já cobre tudo; criar capacidade nova aqui seria inflar a tabela sem necessidade.

**A confirmar por teste (não por leitura):**
- Jogador **não** acessa `/api/finance/charges/` (só `mine/`) — 403.
- Jogador **não** acessa `/api/matches/{id}/roster/` — 403 (dados sensíveis).
- Jogador **acessa** `/api/matches/{id}/confirmed/` — 200, sem telefone/nível no payload.
- Visualizador continua **sem** financeiro.

---

## 10. Auditoria

Toda operação nova audita com usuário, data/hora, ação, entidade afetada, `before`, `after` e motivo.

| Operação | Ação | `before` | `after` |
|---|---|---|---|
| Alterar valor | `fee_changed` (existe) | valor anterior | valor, competência, batch |
| Alterar em massa | `fee_bulk_changed` (existe) | conjunto de valores | batch, valor, ids |
| Ressincronizar | `charges_resynced` (**nova**) | valores anteriores | valor, competência, ids, puladas |
| Baixa | `payment_registered` (existe) | status, pago | + **`late_fee`** |
| Baixa em massa | `payment_bulk_registered` (**nova**) | — | batch, processadas, puladas com motivo |
| Multa/vencimento | `fee_plan_changed` (**nova**) | `{amount, due_day, late_fee_amount}` | idem |
| Despesa criada | `expense_created` (existe) | — | — |
| Despesa alterada | `expense_updated` (**nova**) | campos anteriores | campos novos |

⚠️ Respeitar `max_length=30` em `AuditLog.action` — validar antes de criar a migration.

---

## 11. Migração e compatibilidade

**O banco tem dados.** Estratégia em três migrations pequenas e reversíveis, nunca uma grande:

| # | App | Conteúdo | Backfill | Reversível |
|---|---|---|---|---|
| `0005` | finance | `MembershipFeePlan.late_fee_amount`, `Charge.late_fee_amount` | nenhum (default `0`) | sim |
| `0006` | finance | `Expense.due_date` | nenhum (`NULL`) | sim |
| `0004` | audit | novos valores de `Action` | nenhum (só `choices`) | sim |

Princípios:

1. **Default seguro.** `late_fee_amount = 0` significa "sem multa" — o comportamento de hoje, para todas as organizações.
2. **Nada retroativo.** As 20 cobranças de `2026-08` **não** recebem multa. Elas nasceram sem essa regra.
3. **Campo derivado nunca é gravado.** `late_fee_due` e `total_due` são properties.
4. **Reversão testada.** `migrate finance 0004` tem de voltar sem perda.

### 11.1 Higienização das vigências duplicadas

O banco tem 20 vigências em `2026-08` **e** 20 em `2026-09`, todas R$ 90,00 — resíduo do P1 (o organizador alterou duas vezes por não ver efeito).

**Não são um problema funcional:** `fee_amount_for` pega a mais recente que já começou, e as duas dizem R$ 90,00. **Não devem ser apagadas por migration** — são histórico legítimo, com autor e data.

⚠️ **NECESSITA VALIDAÇÃO** — Se o usuário quiser limpar, isso é uma **ação administrativa auditada na tela**, nunca uma migration silenciosa que apaga registro financeiro.

---

## 12. Testes

Contagem quando o plano foi escrito: **546 backend** (`pytest`) e **187 frontend** (`vitest`). Nenhum podia quebrar.

> ✅ **Esta especificação foi implementada.** Contagem em 14/08/2026: **723 backend** e **250 frontend**, tudo verde. Onde cada bloco saiu:
>
> | Seção | Arquivo | Testes |
> |---|---|---|
> | 12.1 Mensalidade e valor | `tests/test_finance_resync.py` (+ `test_finance_fees.py`) | 19 |
> | 12.2 Multa | `tests/test_finance_late_fee.py` | 25 |
> | 12.3 Baixa em massa | `tests/test_finance_bulk_operations.py` (nome final, não `test_finance_bulk_payment.py`) | 35 |
> | 12.4 Despesas | `tests/test_finance_expenses.py` + `tests/test_finance_expense_edit.py` | — |
> | 12.5 Partidas recorrentes | `tests/test_recurring_match_starts_empty.py`, `test_recurring_game_sync.py` | 8 + — |
> | 12.6 Permissões | `tests/test_roles_and_superadmin.py`, `test_confirmed_players.py` | — + 12 |
> | 12.7 Frontend | `ChangeFeeDialog.test.tsx`, `RegisterPaymentDialog.test.tsx`, `ExpenseFormDialog.test.tsx`, `financeShared.test.ts` | — |
> | 12.8 Mobile | *medição manual em navegador — pendente* | — |
>
> As caixas das subseções abaixo ficam como a **especificação original**, do jeito que foi escrita. O status real por fase está na [§13](#13-checklist-por-fase).

### 12.1 Mensalidade e valor (`tests/test_finance_fees.py` — 38 testes hoje)

- [ ] Alterar valor para a competência corrente reflete em `member-fees` **na mesma competência** ← regressão do P1
- [ ] Alterar para competência futura **não** aparece na corrente (comportamento correto, travado)
- [ ] Cobrança já gerada mantém o valor congelado
- [ ] Ressincronização atualiza só as pendentes
- [ ] Ressincronização **pula** a paga
- [ ] Ressincronização **pula** a que tem baixa parcial
- [ ] Ressincronização **pula** a cancelada
- [ ] Prévia não altera nada
- [ ] Nova competência gerada usa o valor vigente

### 12.2 Multa (`tests/test_finance_fees.py` ou novo `test_finance_late_fee.py`)

- [ ] `late_fee_amount = 0` → **comportamento idêntico ao de hoje** (RN-5)
- [ ] Pagamento **antes** do vencimento → sem multa
- [ ] Pagamento **no dia** do vencimento → sem multa
- [ ] Pagamento **um dia depois** → com multa
- [ ] Pagamento **uma semana depois** → mesma multa (valor fixo, não acumula)
- [ ] Baixa retroativa (`paid_at` anterior ao vencimento, lançada hoje) → **sem** multa
- [ ] Multa não é gravada como estado — duas leituras dão o mesmo resultado
- [ ] Dois pagamentos parciais não cobram a multa duas vezes
- [ ] Alterar a multa do plano **não** muda cobrança já gerada
- [ ] Vencimento dia 31 em fevereiro → 28/29
- [ ] Vencimento dia 31 em abril → 30

### 12.3 Baixa em massa (novo `tests/test_finance_bulk_payment.py`)

- [ ] Vários pendentes → todos processados
- [ ] Seleção mista (pendente + paga) → processa a pendente, pula a paga **com motivo**
- [ ] Cobrança cancelada → pulada
- [ ] Cobrança de **outra organização** no payload → recusada (isolamento)
- [ ] Um erro no meio **não** desfaz as baixas boas
- [ ] Auditoria: um `payment_bulk_registered` + um `payment_registered` por baixa
- [ ] Com multa: cada baixa cobra o total devido da sua cobrança
- [ ] Reexecutar o mesmo lote → tudo pulado, nada duplicado

### 12.4 Despesas (`tests/test_finance_expenses.py` — 21 testes hoje)

- [ ] Criar com vencimento
- [ ] Editar audita `expense_updated`
- [ ] Editar despesa cancelada → `DomainError`
- [ ] Listagem devolve **só** `Expense` — nenhuma `Charge` vaza
- [ ] Custos fixos continuam idempotentes
- [ ] **`financial_summary.balance` e `expenses_summary` idênticos antes e depois da migration** ← trava da decisão 1

### 12.5 Partidas recorrentes (`tests/test_recurring_game_sync.py`, `test_matches.py`)

- [ ] Partida 1 com 4 confirmados → nova ocorrência tem **0** ← trava do P8
- [ ] A lista de confirmados da nova é **vazia**
- [ ] A partida anterior fica **intacta** (4 confirmados)
- [ ] Confirmar na nova **não** afeta a anterior
- [ ] Sortear a anterior **não** cria confirmação na nova
- [ ] Reabrir partida removida (`force=True`) **preserva** as confirmações (exceção documentada)

### 12.6 Permissões (`tests/test_roles_and_superadmin.py`)

- [ ] Jogador em `/matches/{id}/confirmed/` → 200
- [ ] Payload **não** contém `phone`, `skill_level`, `notes`
- [ ] Jogador em `/matches/{id}/roster/` → 403
- [ ] Jogador em `/finance/charges/` → 403
- [ ] Jogador em `/finance/charges/bulk-register-payment/` → 403
- [ ] Jogador não altera confirmação de terceiro
- [ ] Visualizador sem financeiro
- [ ] Gerente e Superadmin com tudo

### 12.7 Frontend (`vitest`)

- [ ] `ChangeFeeDialog` sugere a competência corrente quando ela não tem cobrança
- [ ] `BulkPaymentDialog` mostra o resultado parcial (processadas × puladas)
- [ ] Aba Despesas **não** exibe ações de mensalidade
- [ ] `MyMatchesPage` mostra o vazio (`Confirmados: 0`)
- [ ] `MyMatchesPage` lista os confirmados
- [ ] `ChargeCard` exibe valor e multa **separados**

### 12.8 Mobile

Validar a 375 / 390 / 430px **antes** de 768 / 1024 / 1440px, conforme o padrão já adotado no projeto:

- [ ] Seleção múltipla utilizável com o polegar (alvo ≥ 44px)
- [ ] Barra de ação em lote não cobre conteúdo
- [ ] Lista de confirmados legível a 375px
- [ ] Diálogos de baixa e ressincronização cabem sem rolagem horizontal

---

## 13. Checklist por fase

### Fase 1 — Análise do sistema ✅ **CONCLUÍDA**

- [x] Ler `docs/` (`REGRAS_DE_NEGOCIO.md`, `REQUISITOS.md`, `PLANO_IMPLEMENTACAO.md`, `PLANO_PERFIS_ORGANIZACOES_FINANCEIRO.md`, `AUDITORIA_BUGS.md`, `DESIGN_SYSTEM.md`)
- [x] Mapear arquitetura (Django 5 + DRF + Celery / React 19 + MUI 9)
- [x] Mapear banco (models de `finance`, `matches`, `players`, `audit`)
- [x] Mapear backend (services, views, endpoints, permissões)
- [x] Mapear frontend (`FinancePage`, `MyMatchesPage`, diálogos)
- [x] Mapear permissões (RBAC + capacidades financeiras)
- [x] Mapear financeiro (4 entidades, 3 invariantes)
- [x] Mapear partidas recorrentes (`ensure_next_match`)
- [x] **Consultar o banco real** e confirmar os sintomas com dados
- [x] Identificar impactos e riscos

### Fase 2 — Banco de dados ✅ **CONCLUÍDA**

- [x] Migration `finance/0005` — `late_fee_amount` em plano e cobrança (`0005_charge_late_fee_amount_and_more.py`)
- [x] Migration `finance/0006` — `due_date` em `Expense` (um campo, sem backfill) (`0006_expense_due_date.py`)
- [x] Migration de auditoria — novas ações. Saiu em `audit/0008`–`audit/0011` (uma por bloco entregue), não em `0004` como planejado; todas dentro de `max_length=30`
- [x] Verificar que nenhuma migration altera dado existente — as três são `AddField` puras, com `default` no nível do Django; **nenhuma** `RunPython` ou `RunSQL`
- [ ] Testar `migrate` e o **rollback** em cópia do banco — *validação manual pendente*
- [ ] Confirmar as 20 cobranças de `2026-08` intactas — *conferência manual no banco pendente*

### Fase 3 — Financeiro ✅ **CONCLUÍDA**

- [x] `resync_pending_charges()` + `resync_preview()` — `apps/finance/services.py`
- [x] Endpoints `GET /charges/resync-preview/` e `POST /charges/resync/` com `CanEditFee`
- [x] Ação de auditoria `charges_resynced` + migration `audit/0008`
- [x] `ChangeFeeDialog` — competência corrente + caixa opcional
- [x] **Validado no navegador com os dados reais**: 19 cobranças de R$ 45/80 → R$ 90; a paga ficou intacta; auditoria com 1 lote + 19 individuais
- [x] `late_fee_for()` — função única do cálculo — [services.py:1041](../backend/apps/finance/services.py:1041)
- [x] Congelar `late_fee_amount` na geração — [models.py:148](../backend/apps/finance/models.py:148), lido do plano no momento da cobrança
- [x] `Charge.late_fee_due` / `total_due` — [models.py:211](../backend/apps/finance/models.py:211)
- [x] `_sync_charge_status` com `total_due` ⚠️ RN-5 — [services.py:1057](../backend/apps/finance/services.py:1057); sem multa configurada o comportamento é idêntico ao anterior
- [x] `register_payment` calcula multa por `paid_at` — a multa é a do dia em que o dinheiro entrou, não a de hoje
- [x] `update_fee_plan()` com auditoria — [services.py:152](../backend/apps/finance/services.py:152) + ação `fee_plan_changed`
- [x] `resync_pending_charges()` + prévia (mesmo item das linhas acima)
- [x] `bulk_register_payments()` + resultado parcial — [services.py:636](../backend/apps/finance/services.py:636)
- [x] Endpoints + permissões — `bulk-register-payment/`, `bulk-due-date/`, `resync/`, `resync-preview/` com `CanEditFee` / `CanManageFinancial`
- [x] Serializers com multa **separada** — `late_fee_due` e `total_due` expostos ao lado de `amount`
- [x] **Testes:** `test_finance_late_fee.py` (25), `test_finance_bulk_operations.py` (35), `test_finance_resync.py` (19)

### Fase 4 — Despesas ✅ **CONCLUÍDA**

- [x] ~~Decidir §6.3.1~~ → **gasto consumado, vencimento informativo** (§16)
- [x] `due_date` em model, serializer e filtro — [models.py:323](../backend/apps/finance/models.py:323) + filtros `due_after` / `due_before`
- [x] Confirmar que `expenses_summary` / `financial_summary` continuam **idênticos** — o campo é informativo e não entra em nenhum cálculo; `test_finance_expenses.py` sem alteração de expectativa
- [x] `update_expense()` com auditoria — [services.py:1336](../backend/apps/finance/services.py:1336) + ação `expense_updated`
- [x] `ExpenseViewSet.update` via service — `perform_update` delega a `update_expense()`
- [x] Isolar a moldura da página por aba
- [x] Edição na tela, com "Vencimento" e "Pago em" rotulados — `ExpenseFormDialog.tsx` (+ `ExpenseFormDialog.test.tsx`)
- [x] **Testes:** `test_finance_expense_edit.py`, `test_finance_expenses.py`

### Fase 5 — Partidas e confirmações ✅ **CONCLUÍDA**

- [x] `ConfirmedPlayerSerializer` (enxuto) — [serializers.py:313](../backend/apps/matches/serializers.py:313)
- [x] Ação `confirmed` em `MatchViewSet` — [views.py:163](../backend/apps/matches/views.py:163)
- [x] Registrar a justificativa em `SELF_SERVICE_ACTIONS` — [views.py:115](../backend/apps/matches/views.py:115)
- [x] **Testes:** `test_confirmed_players.py` (12), incluindo isolamento entre organizações
- [x] **Testes** de partida recorrente zerada (sem alterar código) — `tests/test_recurring_match_starts_empty.py`, 8 testes, **passaram de primeira**
- [x] Teste da exceção `force=True`

### Fase 6 — Frontend ✅ **CONCLUÍDA**

- [x] `ChangeFeeDialog` — competência padrão + caixa opcional de ressincronização (§16) — + `ChangeFeeDialog.test.tsx`
- [x] Seleção múltipla na aba Mensalidades — `useSelection` + `BulkActionBar` compartilhados
- [x] `BulkPaymentDialog` + resultado parcial — `BulkActionDialogs.tsx:203` (+ `BulkResultDialog`)
- [x] `FeePlanDrawer` — campo de multa
- [x] `ChargeCard` / `RegisterPaymentDialog` / `MyChargesPage` — multa separada (valor + multa exibidos como parcelas do total)
- [x] `ExpenseFormDialog` — vencimento e edição
- [x] Moldura por aba
- [x] `MyMatchesPage` — lista de confirmados + vazio (`ConfirmedPlayersList.tsx`)
- [ ] Validar 375 / 390 / 430px — *validação manual em navegador pendente*
- [ ] Validar 768 / 1024 / 1440px — *validação manual em navegador pendente*

### Fase 7 — Permissões ✅ **CONCLUÍDA**

- [x] Jogador: vê confirmados, não vê roster, não vê financeiro de terceiros
- [x] Gerente: tudo que já tinha + operações novas (`CanEditFee`, `CanManageFinancial` em `apps/finance/permissions.py`)
- [x] Superadmin: preservado
- [x] Visualizador: preservado (sem financeiro)
- [x] Testes de endpoint por papel — `test_roles_and_superadmin.py` + `test_confirmed_players.py`
- [x] Frontend não oferece o que o papel não pode

### Fase 8 — Auditoria ✅ **CONCLUÍDA**

- [x] Ações novas dentro do limite de 30 caracteres — `charges_resynced`, `fee_plan_changed`, `payment_bulk_registered`, `expense_updated`, `fee_bulk_changed`
- [x] Baixa registra multa aplicada — o campo `late_fee` vai na trilha, não no registro da baixa
- [x] Lote audita o conjunto **e** cada item
- [x] Ressincronização registra antes/depois
- [x] Plano registra antes/depois
- [x] Linha do tempo da cobrança inclui os eventos novos — `charge_timeline()` + `ChargeTimeline.tsx`

### Fase 9 — Testes ✅ **CONCLUÍDA**

- [x] Unitários (§12.1–12.4)
- [x] Integração (endpoints)
- [x] Regras financeiras (multa, vencimento, congelamento)
- [x] Recorrência (§12.5) — `test_recurring_match_starts_empty.py`, `test_recurring_game_sync.py`
- [x] Permissões (§12.6)
- [x] Frontend (§12.7) — 18 arquivos de teste, 250 casos
- [ ] Mobile (§12.8) — *medição manual em navegador pendente*
- [x] **Regressão: 723 backend + 250 frontend passando em 14/08/2026** (eram 546 + 187 quando o plano foi escrito)

### Fase 10 — Validação final

- [x] `ruff check` limpo — 14/08/2026
- [x] `pytest` verde — 723 passando
- [x] `tsc --noEmit` limpo
- [x] `oxlint` sem aviso novo — saída com os mesmos avisos de *fast refresh* já existentes, exit 0
- [x] `vitest run` verde — 250 passando
- [x] `npm run build` verde
- [ ] Migrations aplicadas e revertidas em teste — *validação manual pendente*
- [ ] Dados existentes conferidos após a migração — *conferência manual no banco pendente*
- [ ] Fluxo completo no navegador (Gerente e Jogador) — *validação manual pendente*
- [x] Regras novas documentadas em `docs/REGRAS_DE_NEGOCIO.md` §14 — §14.2.1 (ressincronização), §14.4.1 (multa), §14.7 (despesas), §14.12 (operações em massa)

---

## 14. Ordem recomendada de implementação

| Ordem | Bloco | Por quê nesta posição | Risco |
|---|---|---|---|
| **1** | Testes de regressão da recorrência (§12.5) | O comportamento **já está certo**; travar antes de mexer no resto é a rede de segurança mais barata do plano | Nenhum — só adiciona teste |
| **2** | P1 — competência padrão + ressincronização | É a dor relatada, e não depende de migration | Baixo |
| **3** | Multa (migration + cálculo) | Precisa de campo novo; `total_due` altera `_sync_charge_status` | ⚠️ **Alto** — mexe no comparador de toda cobrança |
| **4** | Baixa em massa | Depende de `total_due` estar correto | Médio |
| **5** | Confirmados para o Jogador | Independente do financeiro; pode ir em paralelo | Baixo |
| **6** | Despesas | Decisão §16 tomada: só um campo informativo, sem tocar em cálculo | **Baixo** (era médio) |
| **7** | Frontend de cada bloco | Junto do respectivo bloco, não no fim | Baixo |

**Um bloco por vez, com a suíte verde entre eles.** O bloco 3 é o único que justifica parar e revalidar tudo antes de seguir.

---

## 15. Critérios de aceite

### CA-1 · Fonte única do valor da mensalidade
Alterar o valor de um mensalista para a competência corrente e recarregar: a aba **Mensalistas** mostra o novo valor **e** a aba **Mensalidades** ou mostra o novo valor (se ressincronizada) ou exibe o aviso de divergência com o botão de ação. Nunca dois números sem explicação.

### CA-2 · Histórico preservado
Cobrança **paga** não muda de valor por nenhum caminho da interface ou da API — a tentativa devolve erro de domínio. Competências anteriores permanecem com os valores originais após qualquer alteração.

### CA-3 · Vencimento configurável
Alterar o dia no plano para 08 e gerar a competência seguinte: todas as cobranças vencem em 08. Em fevereiro, dia 31 vira 28/29. Nenhum `10` ou `08` literal fora do model.

### CA-4 · Multa
Plano com R$ 100,00 e multa R$ 10,00, vencimento dia 08:

| `paid_at` | Total devido |
|---|---|
| 08 | R$ 100,00 |
| 09 | R$ 110,00 |
| 15 | R$ 110,00 |

A tela mostra `R$ 100,00 + R$ 10,00`, nunca só `R$ 110,00`. Duas baixas parciais não cobram a multa duas vezes. Alterar a multa do plano não muda cobrança já lançada.

### CA-5 · Baixa em massa
Selecionar 5 mensalistas (3 pendentes, 1 paga, 1 cancelada) e confirmar: 3 baixas registradas, 2 puladas **com motivo na tela**. A lista atualiza **sem recarregar a página**. A auditoria tem 1 registro de lote + 3 individuais. Repetir a operação não duplica nada.

### CA-6 · Despesas
Com a aba **Despesas** aberta, nenhum elemento de mensalidade, receita, jogador ou pagamento está visível. Toda despesa tem descrição, valor, vencimento, status, data de pagamento (quando aplicável) e observação, e pode ser editada. As 2 despesas existentes continuam lá.

### CA-7 · Jogador vê os confirmados
Logado como jogador, na próxima partida: contagem, vagas e a lista de quem confirmou. A resposta da API **não contém** telefone, nível técnico nem observações. `/roster/` continua devolvendo 403.

### CA-8 · Nova partida zerada
Partida com 4 confirmados, realizada. Gerada a próxima ocorrência: **`Confirmados: 0`**, lista vazia, mensagem "Nenhum jogador confirmou presença ainda". A partida anterior continua com 4. Confirmar na nova não altera a antiga.

### CA-9 · Permissões
A matriz de §12.6 passa inteira. Nenhum papel ganhou acesso que não tinha, exceto o Jogador na rota `confirmed` — deliberado e testado.

### CA-10 · Sem regressão
`ruff`, `pytest` (546+), `tsc`, `oxlint`, `vitest` (187+) e `build` verdes. Sorteio, formações, equilíbrio e distribuição dos mais fracos **intocados** — nenhum arquivo de `apps/draws/domain/` alterado.

---

## 16. Decisões do usuário — ✅ **RESPONDIDAS EM 10/08/2026**

Nenhuma pendência bloqueante restante. As quatro decisões abaixo estão incorporadas ao plano.

| # | Assunto | Decisão | Consequência |
|---|---|---|---|
| 1 | §6.3.1 | **Despesa é gasto consumado**, com vencimento informativo | `financial_summary.balance` **não muda**. `Expense.Status` continua `registered`/`canceled` — sem `pending`/`paid`. Fase 4 destravada |
| 2 | §11.1 | **Deixar as vigências duplicadas como estão** | Nenhuma ação. Não entra no escopo |
| 3 | RN-4 | **Multa é valor fixo** | Um campo (`late_fee_amount`), sem `late_fee_mode`. Percentual e juros ficam fora |
| 4 | §7.1 | **Caixa opcional no mesmo diálogo**, desmarcada por padrão | Sem `ResyncChargesDialog` separado: a ressincronização vira uma opção do `ChangeFeeDialog` |

### 16.1 Ajustes decorrentes

**Decisão 1 — despesa consumada.**
- `Expense.due_date` entra como campo **informativo** (`null=True`), sem efeito em cálculo nenhum.
- `Expense.paid_on` **não é criado**: `incurred_on` já é a data em que a despesa foi paga/realizada, e criar um segundo campo com o mesmo significado seria a duplicação que o §14.0 do `REGRAS_DE_NEGOCIO.md` evita. A tela passa a rotular `incurred_on` como **"Pago em"** e `due_date` como **"Vencimento"**.
- Migration `finance/0006` fica com **um** campo, e **sem backfill**.
- `expenses_summary` e `financial_summary` ficam **intocados** — some o risco de regressão no saldo.

**Decisão 3 — multa fixa.**
- `MembershipFeePlan.late_fee_amount` e `Charge.late_fee_amount`, só isso.
- `late_fee_for(charge, on)` devolve `late_fee_amount` ou `0` — sem aritmética de dias, sem percentual.
- O campo continua sendo o ponto de extensão futuro: acrescentar percentual depois é um `late_fee_mode` novo com default `fixed`, sem tocar no que já existe.

**Decisão 4 — ressincronização no mesmo diálogo.**
- `ResyncChargesDialog.tsx` **sai do escopo**. Em vez dele, `ChangeFeeDialog` ganha:
  - uma caixa **desmarcada por padrão**: *"Aplicar também às 19 mensalidades em aberto de Ago/2026"*;
  - a contagem vem do `resync_preview` (§7.1), que roda junto do `bulk_change_preview` já existente;
  - a caixa **só aparece** quando há cobranças em aberto naquela competência — senão é ruído.
- O endpoint `POST /api/finance/charges/resync/` continua existindo e separado: a operação da tela é "alterar valor **e** ressincronizar", mas o backend mantém as duas responsabilidades distintas e auditadas em separado (`fee_changed` + `charges_resynced`).
- **Cobrança paga nunca é tocada**, com a caixa marcada ou não (RN-2).
