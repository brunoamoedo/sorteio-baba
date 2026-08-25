# Plano de implementação — Mensalidades em massa e Geração de Logins

> **Status:** ✅ **implementado** — as sete fases estão concluídas e validadas (§9).
> As regras entraram em `REGRAS_DE_NEGOCIO.md` §14.12 e §15; este documento fica
> como o registro de **por que** cada decisão foi tomada.
> **Data:** 11/08/2026 · competência corrente: `2026-08`
> **Base:** leitura de `backend/`, `frontend/`, `docs/` **e consulta ao banco real** (organização "Pelada dos Amigos", 20 mensalistas, 5 usuários).
> **Documento irmão:** [`PLANO_IMPLEMENTACAO_FINANCEIRO_CONFIRMACOES.md`](PLANO_IMPLEMENTACAO_FINANCEIRO_CONFIRMACOES.md) — parte do que este plano pede **já foi implementado** por ele. Ver §0.

---

## 0. O que já existe (não replanejar)

Três itens do pedido já estão prontos e testados nesta base. Replanejá-los criaria caminho duplicado.

| Pedido | Situação | Onde |
|---|---|---|
| §9 — Login pelo telefone | ✅ **Implementado** | `apps/accounts/login_serializers.py` · aceita usuário, e-mail **ou** telefone |
| §9 — Normalização do telefone | ✅ **Implementado** | `players.normalize_phone()` + `Player.phone_digits` (indexado, migration `0004`) |
| §4 — Baixa em massa | 📋 **Planejado** no documento irmão §7.3 | Este plano **não** o replaneja — só o consome |
| Multa na baixa (§4.7) | ✅ **Implementado** | `Charge.late_fee_amount`, `late_fee_for()`, `REGRAS_DE_NEGOCIO.md` §14.4.1 |
| Seleção múltipla | ⚠️ **Parcial** | Existe na aba **Mensalistas** (`selectedMembers`), **não** na aba Mensalidades |

O login por telefone aceita `(71) 99999-9999`, `71999999999` e `+55 71 99999-9999` — os três formatos do pedido — e recusa, com mensagem genérica, quando o número leva a dois logins diferentes.

---

## 1. Objetivo

1. **Mensalidades em massa** — seleção múltipla reutilizável na aba Mensalidades, com geração, alteração de vencimento e baixa em lote.
2. **Geração de logins** — criar acesso para os mensalistas a partir do telefone, com senha temporária e troca obrigatória no primeiro acesso.
3. **Reset de senha** — Admin e Gerente devolvem o acesso de um jogador sem nunca ver a senha dele.

---

## 2. Contexto atual

### 2.1 A cadeia jogador → usuário → login

```
Player (por organização)          User (global, uma pessoa)         Membership (papel na org)
  · name, phone, phone_digits  ──▶  · username (único, global)   ──▶  · role: admin/organizador/
  · user (FK, NULO)                 · email (único; passa a OPCIONAL)     visualizador/jogador
  · skill_level, posições           · is_superadmin                   · is_active
```

Três fatos que mandam no desenho:

- `Player.user` é **nulo por padrão**: a maioria das fichas é cadastro, não conta.
- `User` é a **identidade global**: a mesma pessoa em duas peladas tem **um** login e duas fichas.
- Para o jogador confirmar presença, precisa de `Player.user` preenchido **e** uma `Membership` com papel `jogador`. Sem os dois, `MyMatchesPage` já avisa: *"Seu login ainda não está vinculado a uma ficha de jogador nesta organização"*.

**Gerar um login é, portanto, criar até três coisas:** `User` + `Membership(role=jogador)` + preencher `Player.user`. Um plano que criasse só o `User` entregaria uma conta que não consegue fazer nada.

### 2.2 Estado real do banco

```
Jogadores não-temporários ..... 20
  com telefone ................ 20  (100%)
  sem telefone ................  0
  já com login ................  2
Telefones repetidos ........... nenhum
Tamanhos ...................... 19 com 11 dígitos · 1 com 10 dígitos
Usuários no sistema ............ 5   (admin, organizador, visualizador, jogador, novato)
```

**A base é favorável:** 18 logins a gerar, todos com telefone único. O caso "sem telefone" não existe hoje — mas precisa ser tratado, porque uma ficha nova pode nascer sem.

### 2.3 Onde usuários são criados hoje

| Caminho | Arquivo | Como identifica a pessoa |
|---|---|---|
| Onboarding público | `RegisterOrganizationView` | e-mail informado |
| Adicionar membro | `OrganizationMemberViewSet.perform_create` ([membership_views.py:69](backend/apps/accounts/membership_views.py:69)) | **e-mail** — reaproveita o usuário se já existir |
| Admin do sistema | `apps/accounts/serializers.py` (`UserSerializer.create`) | `create_user`, com hash |

Os três usam `User.objects.create_user(...)`, que grava a senha **com hash**. Nenhum grava texto puro. O comentário no código é explícito: *"`create_user` para a senha ser gravada com hash — `objects.create()` gravaria o texto puro"*.

### 2.4 Mensalidades — o que já existe

| Operação | Existe? | Onde |
|---|---|---|
| Gerar competência para **todos** | ✅ | `generate_recurring_charges()` · botão "Gerar mês" · idempotente |
| Gerar para **selecionados** | ❌ | não existe recorte por jogador |
| Lançar mensalidade individual | ✅ | `create_charge()` · "Nova mensalidade" |
| Alterar vencimento individual | ✅ | `update_charge(due_date=...)` |
| Alterar vencimento **em massa** | ❌ | — |
| Baixa individual | ✅ | `register_payment()` |
| Baixa **em massa** | ❌ | planejada no documento irmão §7.3 |
| Seleção múltipla na aba Mensalidades | ❌ | existe só na aba Mensalistas |

---

## 3. Problemas e bloqueios identificados

### B1 — 🔴 BLOQUEADOR · `User.email` é único **e obrigatório**, e `Player` não tem e-mail

```python
email = models.EmailField(unique=True)   # sem null, sem blank
```

Gerar 18 logins exige 18 e-mails únicos. **Nenhum jogador tem e-mail cadastrado** — `Player` não tem esse campo, e o pedido é explicitamente para logar por telefone.

Este é **o** ponto que decide a Fase 4. Três saídas:

| Opção | Como | Custo | Risco |
|---|---|---|---|
| **(a) E-mail sintético** | `11928241409@pelada-dos-amigos.local` | Zero migration | 🔴 Grava uma mentira no banco. Vai aparecer na lista de membros, alguém vai tentar enviar mensagem, e quando a pessoa informar o e-mail real ficará um fantasma. `resolve_username_from_email` passa a casar com endereços falsos |
| **(b) Tornar `email` opcional** ⭐ | `EmailField(unique=True, null=True, blank=True)` | 1 migration em `accounts` | 🟡 Mexe no modelo de autenticação. No Postgres, `NULL` não colide em índice único — vários logins sem e-mail convivem |
| **(c) E-mail no `Player`** | Campo novo, obrigatório para gerar login | 1 migration em `players` | 🔴 Contradiz o pedido: exigiria coletar 18 e-mails que ninguém tem |

> ✅ **Decidido (§12): opção (b) — e-mail opcional.** Um e-mail sintético é um dado falso que o sistema trataria como verdadeiro; um campo nulo é a verdade ("esta pessoa não informou e-mail").

Impactos de (b), todos verificados no código:

- `User.__str__` → `self.email or self.username` — **já tolera** vazio.
- `REQUIRED_FIELDS = ["email"]` — só afeta `createsuperuser`; manter.
- `resolve_username_from_email` — já retorna `None` quando não acha; `null` nunca casa com `iexact`.
- `OrganizationMemberViewSet.perform_create` identifica por e-mail — continua igual para quem **tem** e-mail.
- `OrganizationMemberSerializer` expõe `email` — passa a poder vir `null`; o frontend precisa tolerar.
- ✅ **Verificado:** `UserSerializer` (o do `/me/`) tem `read_only_fields = fields` — não valida escrita. `AdminUserSerializer` é um `ModelSerializer` sobre `User`, então hoje herda `required=True` do campo; ao tornar o modelo `null=True, blank=True`, ele passa a aceitar ausência **automaticamente**. Nenhum ajuste manual previsto — mas o teste de criação de usuário pelo admin do sistema entra na Fase 2 para confirmar.

### B2 — 🔴 Não existe `must_change_password`

Varredura em `apps/`: **nenhum** mecanismo de senha temporária, expiração ou troca obrigatória. Também **não existe endpoint de troca de senha** — `MeView` é só leitura. Tudo da Fase 5 é novo.

### B3 — 🟠 O `username` de um login gerado

Se `username = phone_digits`, o login funciona direto (já testado: `username` só de dígitos entra por ele mesmo, sem passar pela resolução de telefone).

Dois cuidados:

1. **Colisão global.** `username` é único no sistema inteiro. Duas organizações com pessoas diferentes de mesmo telefone colidem. ✅ **Decidido (§12, D3): recusar com motivo** — nunca sufixo automático, que criaria um login que ninguém adivinha e cujo dono nem saberia existir.
2. **O telefone muda, o `username` não.** Correto: `username` é identificador interno, e o login por telefone continua funcionando via `phone_digits`.

> ✅ **Decidido (§12, D3): recusar com motivo.** Nunca sufixo automático — `11928241409-2` seria um login que ninguém adivinha, e o dono nem saberia que existe.

### B4 — 🟠 Telefone repetido entre dois jogadores

Hoje não há nenhum, mas `Player.phone` não tem constraint. Se dois jogadores **diferentes** tiverem o mesmo número, gerar login para os dois criaria duas contas que competem pelo mesmo identificador — e o login por telefone recusaria as duas (já implementado). A geração deve **recusar antes**, dizendo qual é o conflito.

### B5 — 🟡 Um telefone com 10 dígitos

19 telefones têm 11 dígitos, 1 tem 10 (fixo, ou celular sem o 9). `normalize_phone` não completa nada — e não deve: inventar um dígito é adivinhar o número de alguém. Esse jogador ganha login normalmente; só precisa digitar exatamente o que está cadastrado.

### B6 — 🟡 A senha `novasenha123`

**Testado contra os validadores do projeto:** passa. (`11928241409` seria recusada — numérica e parecida com o usuário; `senha123` seria recusada — comum.)

Mas: `set_password()` **não roda validadores**. Eles só valem se o serializer os chamar. Isso importa na **nova senha** que o jogador escolhe — que deve passar por `validate_password`.

⚠️ **Senha temporária igual para todo mundo é um risco conhecido.** Quem souber o telefone de um jogador e a senha padrão entra na conta dele antes do dono. Mitigações no plano: troca obrigatória no primeiro acesso (§ Fase 5) e a possibilidade futura de senha aleatória por jogador. Como o pedido é explícito quanto ao valor, ele é implementado como **constante configurável**, não literal espalhado.

### B7 — 🟡 Papel do login gerado

Gerar login sem `Membership` cria uma conta que entra e não vê nada. Sem `Player.user`, ela não confirma presença. A operação tem de fazer os três — e é isso que a torna um **serviço**, não um `create` de view.

---

## 4. Regras de negócio propostas

### RN-1 — Gerar login é uma operação de três passos, atômica por jogador

```
Player sem user
   ↓
1. User(username=phone_digits, senha temporária com hash, must_change_password=True)
2. Membership(organization, user, role="jogador")
3. Player.user = user
   ↓
Jogador entra com o telefone e é obrigado a trocar a senha
```

Cada jogador é uma transação. Um problema num não pode desfazer os outros 17.

### RN-2 — Nunca duplicar usuário

| Situação da ficha | O que acontece |
|---|---|
| Já tem `Player.user` | **Pulado** — "já possui login". A tela oferece *Resetar senha* como ação separada |
| Sem `user`, mas existe `User` com aquele `username` | Reaproveita o usuário existente e só cria `Membership` + vínculo. Nunca cria outro |
| Sem telefone | **Pulado** — "sem telefone cadastrado" |
| Telefone repetido com outra ficha | **Pulado** — "telefone repetido com {nome}" |
| Não é mensalista ativo | **Não aparece na lista** — o escopo é `mensalistas_of()` (§12, D2) |

### RN-3 — Senha temporária e primeiro acesso

- Senha inicial: constante `SENHA_TEMPORARIA_PADRAO = "novasenha123"` em um módulo só.
- Gravada **sempre** por `set_password`/`create_user` — nunca texto puro, nunca na auditoria, nunca na resposta da API.
- `User.must_change_password = True` ao gerar e ao resetar.
- Enquanto for `True`: **toda** rota autenticada responde `403` com um código que a tela reconhece, **exceto** a própria troca de senha e `/api/auth/me/`.
- Trocar a senha limpa a marca. A nova senha passa por `validate_password` e **não pode ser igual à temporária**.

### RN-4 — Reset de senha

- Executável por Admin/Superadmin e Organizador/Gerente.
- O Gerente só alcança quem tem ficha **na organização dele** — o escopo vem de `request.organization`, nunca de um id no corpo.
- Não é possível resetar a senha de outro Gerente/Admin por esta rota: ela é para **jogadores**. Gestão de gente que administra continua em `/api/auth/members/`.
- Ninguém vê a senha atual: o reset **substitui**, não revela.
- Auditado sem nenhum valor de senha.

### RN-5 — Operações em massa: cada registro por si

Já é o padrão do módulo (`bulk_set_player_fees`) e continua: valida item a item, pula o que não pode com **motivo**, devolve resumo. Uma seleção com situações mistas não é tudo-ou-nada.

| Operação | Atômica? | Por quê |
|---|---|---|
| Gerar mensalidade | ❌ por item | Já é idempotente; quem já tem é pulado |
| Alterar vencimento | ❌ por item | Uma paga no meio não pode desfazer as outras |
| Baixa | ❌ por item | Uma baixa boa não pode ser desfeita por outra ruim |
| Gerar login | ❌ por item | Idem — mas **cada jogador** é atômico (RN-1) |

### RN-6 — Alterar vencimento em massa

O pedido diz "novo vencimento: dia 10". Como `Charge.due_date` é uma **data**, e não um dia, o dia informado é resolvido contra a **competência de cada cobrança** — `_due_date_for(reference, dia)`, que já trata mês curto (dia 31 em fevereiro → 28/29).

| Situação | Altera? |
|---|---|
| Pendente sem baixa | ✅ |
| **Paga** | ❌ "já paga" |
| Com baixa parcial | ✅ **altera** — a data muda, o dinheiro recebido não (§12, D4) |
| Cancelada | ❌ "cancelada" |

⚠️ **Efeito colateral a explicitar na tela:** mudar o vencimento muda **se a multa incide** (`REGRAS_DE_NEGOCIO.md` §14.4.1). Adiar o vencimento de uma cobrança atrasada remove a multa dela.

---

## 5. Alterações de banco

> Duas migrations pequenas. **Nenhuma tabela nova** — `User`, `Membership`, `Player` e `Charge` já cobrem tudo.

### 5.1 `accounts.User`

| Campo | Alteração | Motivo |
|---|---|---|
| `email` | `unique=True` → `unique=True, null=True, blank=True` | B1 — sem isso não há como gerar login sem e-mail |
| `must_change_password` | **novo** `BooleanField(default=False)` | B2 |
| `password_changed_at` | **novo** `DateTimeField(null=True, blank=True)` | Responde "quando esta pessoa trocou a senha" sem gravar senha nenhuma |

**Backfill:** nenhum. Os 5 usuários existentes ficam com `must_change_password=False` — que é a verdade: eles já escolheram as próprias senhas.

⚠️ Migration em modelo de autenticação. Testar `migrate` **e** o rollback antes de aplicar em dados reais.

### 5.2 Índices e constraints

- **Nenhum índice novo.** `User.username` já é único e indexado; `Player.phone_digits` ganhou índice na migration `players/0004`.
- **Nenhuma constraint nova.** A unicidade de telefone **não** deve virar constraint: dois irmãos podem compartilhar um número, e travar o cadastro por isso quebraria um caso legítimo. A regra vale só na **geração de login** (RN-2).

### 5.3 Auditoria — ações novas (limite de 30 caracteres em `AuditLog.action`)

| Constante | Valor | Tam. |
|---|---|---|
| `LOGIN_GENERATED` | `login_generated` | 15 |
| `LOGINS_BULK_GENERATED` | `logins_bulk_generated` | 21 |
| `PASSWORD_RESET` | `password_reset` | 14 |
| `PASSWORD_CHANGED` | `password_changed` | 16 |
| `CHARGES_DUE_DATE_CHANGED` | `charges_due_date_changed` | 24 |

Do pedido (§16), já existem: `charge_created` (GERACAO_MENSALIDADE), `charges_generated` (EM_MASSA), `charge_updated` (ALTERACAO_VENCIMENTO), `payment_registered` (BAIXA). `payment_bulk_registered` está no plano irmão. `PRIMEIRO_ACESSO` **não vira ação própria** — é o `password_changed` com `first_access: true` no `after`; duas ações para o mesmo evento fragmentariam a trilha.

**Nenhum campo de senha entra em `before`/`after`.** Nem hash, nem tamanho, nem dica.

---

## 6. Alterações de backend

### 6.1 Novo: `apps/accounts/login_provisioning.py`

Módulo próprio porque não é "mais um método de usuário": é a regra que junta `User`, `Membership` e `Player` (RN-1).

```
SENHA_TEMPORARIA_PADRAO = "novasenha123"

generate_login(*, organization, player, performed_by) -> dict
generate_logins(*, organization, players, performed_by) -> dict   # em massa
reset_password(*, organization, player, performed_by) -> dict
change_own_password(*, user, current, new) -> None
```

- `generate_login` é `@transaction.atomic` **por jogador**.
- `generate_logins` **não** é atômica no lote (RN-5) e devolve `{created: [...], skipped: [{player_id, name, reason}], batch}`.
- A resposta **nunca** inclui a senha — a tela mostra a constante, que ela já conhece.

### 6.2 Alterações em arquivos existentes

| Arquivo | O quê |
|---|---|
| `apps/accounts/models.py` | `must_change_password`, `password_changed_at`, `email` opcional |
| `apps/accounts/views.py` | `ChangePasswordView` (auto-serviço) |
| `apps/accounts/urls.py` | `POST /api/auth/change-password/`, rotas de provisionamento |
| `apps/accounts/serializers.py` | `UserSerializer` tolera e-mail nulo; `ChangePasswordSerializer` com `validate_password` |
| `apps/audit/models.py` | 5 ações novas |
| `apps/finance/services.py` | `generate_charges_for(players=...)`, `bulk_change_due_date()` |
| `apps/finance/views.py` | ações novas em `ChargeViewSet` |
| `common/permissions.py` | `MustHaveChangedPassword` (ver 6.4) |
| `config/settings/base.py` | registrar a permissão global |

### 6.3 Endpoints novos

| Método | Rota | Permissão |
|---|---|---|
| `GET` | `/api/players/login-status/` | Gerente |
| `POST` | `/api/players/generate-logins/` | Gerente |
| `POST` | `/api/players/{id}/reset-password/` | Gerente |
| `POST` | `/api/auth/change-password/` | qualquer autenticado (auto-serviço) |
| `POST` | `/api/finance/charges/generate-for/` | `CanManageFinancial` |
| `POST` | `/api/finance/charges/bulk-due-date/` | `CanManageFinancial` |

`/api/players/login-status/` alimenta a aba "Gerar Logins": nome, telefone, tem login, primeiro acesso pendente. **Não** devolve nível técnico nem observações — é uma tela de acesso, não de cadastro.

### 6.4 O bloqueio do primeiro acesso

Ponto mais delicado da Fase 5. Uma permissão global (`DEFAULT_PERMISSION_CLASSES`) que nega quando `request.user.must_change_password`, com exceções explícitas:

```
Liberado:  /api/auth/change-password/   (o caminho para sair do estado)
           /api/auth/me/                (a tela precisa saber quem é)
           /api/auth/token/refresh/     (senão a sessão morre no meio da troca)
Negado:    todo o resto → 403 {"code": "must_change_password"}
```

⚠️ **Não bloquear no `token/`**: o jogador precisa **conseguir autenticar** para então trocar a senha. Bloquear ali o deixaria de fora sem caminho de volta.

O frontend reconhece o código e redireciona. **O bloqueio real é o do servidor** — esconder a tela no cliente não é controle de acesso.

### 6.5 Permissões

| Operação | Papel | Escopo |
|---|---|---|
| Gerar login (individual/massa/todos) | Admin, Gerente | ⚠️ Só fichas de `request.organization` |
| Resetar senha de jogador | Admin, Gerente | ⚠️ Idem |
| Trocar a própria senha | Qualquer autenticado | Só a própria |
| Gerar/alterar/baixar mensalidade em massa | Capacidades financeiras existentes | `request.organization` |

**Nenhuma capacidade financeira nova.** Provisionamento de acesso **não** é capacidade financeira — usa o RBAC de papel (`IsOrganizationOrganizerOrAdmin`), como o resto da gestão de pessoas.

---

## 7. Alterações de frontend

### 7.1 Seleção reutilizável

A aba Mensalistas já tem seleção (`selectedMembers: Set<number>`, `FinancePage.tsx`). O pedido é usá-la em três lugares. Extrair para um hook:

```
frontend/src/shared/hooks/useSelection.ts
  → { selected, toggle, toggleAll, clear, count, isSelected, allSelected }
```

**Extrair do que já funciona**, não escrever do zero: a versão atual já resolve "trocar o filtro limpa a seleção", que é a pegadinha clássica desse controle (`REGRAS_DE_NEGOCIO.md` §3).

### 7.2 Barra de ações em massa

```
frontend/src/shared/components/BulkActionBar.tsx
```

Aparece com seleção ativa; recebe as ações como lista, para acrescentar ação nova depois sem tocar no componente.

📱 **Mobile:** barra fixa no rodapé, **acima** da `BottomNav` (60px), alvos ≥ 44px, rótulos curtos ("Gerar", "Vencimento", "Baixa") com ícone. A 375px, três ações + contador não cabem em uma linha com texto completo.

### 7.3 Telas

| Arquivo | Alteração |
|---|---|
| `FinancePage.tsx` (aba Mensalidades) | Seleção por linha + "selecionar todos" + contador + barra de ações |
| Novo `GenerateChargesDialog.tsx` | Competência, prévia ("42 serão criadas, 8 já possuem"), confirmação |
| Novo `BulkDueDateDialog.tsx` | Dia do vencimento + **aviso sobre a multa** (RN-6) |
| Novo `BulkPaymentDialog.tsx` | Já previsto no plano irmão |
| Novo `BulkResultPanel.tsx` | Resultado padrão: processados / sucesso / ignorados / erros, com motivos |
| Nova página `LoginsPage.tsx` | Aba "Gerar Logins" |
| Novo `ResetPasswordDialog.tsx` | Confirmação + aviso de que a senha vira temporária |
| Nova página `ChangePasswordPage.tsx` | Troca obrigatória, sem menu e sem saída |
| `navItems.ts` | Item "Gerar Logins" (só Admin/Gerente) |
| `App.tsx` / `AppRoute` | Interceptar `must_change_password` e redirecionar |
| `api/client.ts` | Reconhecer o código `must_change_password` no 403 |

### 7.4 A tela de troca obrigatória

Sem `AppLayout` — **sem menu, sem barra inferior, sem botão de voltar**. Se a pessoa puder navegar para fora, o "obrigatório" é decorativo. Sair só por: trocar a senha, ou sair do sistema.

---

## 8. Testes

### 8.1 Seleção (frontend)

- [x] Selecionar um · vários · todos · desmarcar todos
- [x] Contador confere
- [x] Trocar o filtro **limpa** a seleção
- [x] "Selecionar todos" marca **todos os resultados do filtro**, não só a página

### 8.2 Geração de mensalidade

- [x] Para todos os mensalistas ativos
- [x] Só para os selecionados
- [x] Quem já tem é pulado (sem duplicata)
- [x] Usa o valor vigente de cada jogador
- [x] Usa o dia de vencimento configurado
- [x] Rodar duas vezes não cobra em dobro
- [x] Resumo: criadas / já possuíam / erros
- [x] Auditoria

### 8.3 Vencimento em massa

- [x] Altera as pendentes
- [x] **Pula a paga** com motivo
- [x] Pula a cancelada
- [x] Dia 31 em fevereiro → 28/29
- [x] Resolve o dia contra a competência **de cada** cobrança
- [x] Adiar vencimento de cobrança atrasada **remove a multa** (efeito esperado, travado por teste)
- [x] Auditoria

### 8.4 Geração de login

- [x] Individual · selecionados · todos
- [x] Cria `User` + `Membership(jogador)` + vincula `Player.user`
- [x] `username` = dígitos do telefone
- [x] O jogador **consegue entrar** com o telefone logo depois
- [x] Ficha **com** login → pulada, "já possui login"
- [x] Ficha **sem telefone** → pulada, com motivo
- [x] Telefone repetido entre duas fichas → **as duas** puladas
- [x] `User` já existente com aquele username → reaproveitado, não duplicado
- [x] Nunca cria `Player` novo
- [x] Senha gravada com hash — `check_password("novasenha123")` verdadeiro, `password` no banco **não** é o texto
- [x] A resposta da API **não** contém a senha
- [x] A auditoria **não** contém senha, hash nem tamanho
- [x] Gerente de outra organização não gera login para fichas alheias
- [x] Jogador recebe 403
- [x] Dois logins gerados em sequência **não colidem no e-mail** (`None`, não `""`)
- [x] Convidado não aparece na lista (escopo = mensalistas)

### 8.5 Primeiro acesso

- [x] Login com senha temporária **autentica** (retorna token)
- [x] Com `must_change_password`, `/api/matches/mine/` → 403 com o código
- [x] `/api/auth/change-password/` continua acessível
- [x] `/api/auth/me/` continua acessível
- [x] Trocar limpa a marca e libera o resto
- [x] Nova senha **igual à temporária** é recusada
- [x] Nova senha fraca é recusada (`validate_password`)
- [x] `password_changed_at` preenchido
- [x] Auditoria com `first_access: true`
- [x] Frontend: não há como sair da tela sem trocar

### 8.6 Reset de senha

- [x] Admin reseta
- [x] Gerente reseta dentro da organização
- [x] Gerente **não** reseta fora dela
- [x] Jogador não reseta ninguém
- [x] A senha anterior deixa de funcionar
- [x] A temporária funciona e exige troca
- [x] Ninguém recebe a senha atual em resposta nenhuma
- [x] Auditoria sem senha

### 8.7 Regressão

- [x] **A suíte continua verde** — 607 → **723** backend, 204 → **250** frontend
- [x] Login por usuário, e-mail e telefone continua funcionando
- [x] Usuários existentes (`must_change_password=False`) não são afetados
- [x] `npm run build` (que é o `tsc -b` real) passa

### 8.8 Mobile — 375 / 390 / 430px antes de 768 / 1024 / 1440px

- [x] Caixas de seleção com alvo ≥ 44px
- [x] Barra de ações não cobre a `BottomNav`
- [x] Aba "Gerar Logins" legível a 375px (nome + telefone + situação)
- [x] Diálogos sem rolagem horizontal
- [x] Tela de troca de senha utilizável a 375px

---

## 9. Checklist por fases

### Fase 1 — Análise ✅ **CONCLUÍDA**

- [x] Ler `docs/` e os dois planos anteriores
- [x] Mapear a cadeia `Player → User → Membership`
- [x] Mapear autenticação (JWT, `login_serializers`, throttle)
- [x] Mapear permissões (RBAC + capacidades financeiras)
- [x] Mapear auditoria e o limite de 30 caracteres
- [x] Mapear mensalidades (services, endpoints, telas)
- [x] **Consultar o banco real** (20 fichas, 20 telefones, 0 repetidos, 2 com login)
- [x] **Testar `novasenha123` contra os validadores** — passa
- [x] Identificar o bloqueador B1 (`email` único e obrigatório)
- [x] Confirmar que `must_change_password` não existe

### Fase 2 — Banco ✅ **CONCLUÍDA**

- [x] ~~Decidir B1~~ → **e-mail opcional** (§12, D1)
- [x] Migration `accounts/0005`: `must_change_password`, `password_changed_at`, `email` opcional
- [x] `create_user` grava `email=None` — ver nota abaixo
- [x] Migrations `audit/0009` e `0010`: ações novas, todas ≤ 30 caracteres
- [x] Nenhuma migration altera dado existente
- [x] **`migrate` e rollback testados** em cima dos dados reais
- [x] 5 usuários e 28 fichas intactos após reverter e reaplicar

> **O bug que o teste pegou.** Passar `email=None` para `create_user` **não basta**:
> `BaseUserManager.normalize_email` faz `email or ""` e grava string vazia. Vazio colide no
> índice único a partir do **segundo** login gerado — o erro apareceria só no jogador nº 2, no
> meio de uma geração em massa. O e-mail é atribuído depois do `create_user`, e há teste
> específico para isso.

### Fase 3 — Mensalidades em massa ✅ **CONCLUÍDA**

- [x] `generate_charges_for(players=...)` — idempotente, com resumo criadas/já possuíam
- [x] `bulk_change_due_date(charge_ids=...)` — recebe **cobranças**, não jogadores (ver nota)
- [x] Aviso na tela sobre quantas mensalidades **perdem a multa** ao adiar o vencimento
- [x] `bulk_register_payments()` — cada uma pelo seu total devido, com multa
- [x] Endpoints + permissões (`generate-for`, `bulk-due-date`, `bulk-register-payment`)
- [x] Auditoria das três (`charges_generated` com escopo, `charges_due_date_changed`, `payment_bulk_registered`)
- [x] Testes: 41 em `tests/test_finance_bulk_operations.py`
- [x] **Validado no navegador a 375px** com dados reais

> **Nota de desenho.** O plano previa `bulk_change_due_date(players=...)`, mas a tela seleciona
> **cobranças**. Receber jogadores exigiria traduzir "jogador → cobrança daquela competência", o
> que só funciona enquanto a seleção não cruzar meses. Recebendo cobranças, o dia é resolvido
> contra a competência **de cada uma** — uma seleção de julho e agosto sai com o dia 10 de cada
> mês, em vez de uma data única. Travado por teste.
>
> Pelo mesmo motivo, **"gerar mensalidade" saiu da barra de seleção**: seleciona-se o que já
> existe, e gerar é justamente para quem **não** tem cobrança. Ficou como ação do cabeçalho
> ("Gerar mês"), agora com competência escolhível e resumo do resultado.

### Fase 4 — Geração de logins ✅ **CONCLUÍDA**

- [x] `login_provisioning.py` com `SENHA_TEMPORARIA_PADRAO`
- [x] `generate_login` atômico por jogador (User + Membership + vínculo)
- [x] `generate_logins` com resultado parcial
- [x] Regras de "pular" (RN-2), cada uma com motivo
- [x] `GET /players/login-status/` restrito a `mensalistas_of()`
- [x] `POST /players/generate-logins/`
- [x] Testes: 42 em `tests/test_login_provisioning.py`
- [x] **Executado nos dados reais: 18 logins criados, 2 pulados ("já possui login")**
- [x] Repetir a operação: 0 criados, 20 pulados — idempotência provada em produção local

### Fase 5 — Primeiro acesso e reset ✅ **CONCLUÍDA**

- [x] `must_change_password` no modelo e no `/me/`
- [x] `ChangePasswordView` + `validate_password`
- [x] Recusa nova senha igual à temporária e igual à atual
- [x] **Middleware** de bloqueio, com as quatro exceções — ver nota
- [x] `reset_password()` + endpoint
- [x] Escopo por organização, e recusa resetar quem administra
- [x] Auditoria sem senha (nem valor, nem hash, nem tamanho)
- [x] **Fluxo validado ponta a ponta na API real**: entra com telefone → 403 em tudo →
      troca recusa a temporária → troca aceita a nova → sistema libera

> **A correção de desenho.** O plano previa uma permissão em `DEFAULT_PERMISSION_CLASSES`.
> Não funcionaria: no DRF, uma view que declara `permission_classes` **substitui a lista
> inteira**, e este projeto declara em **26 lugares** (verificado por varredura). O bloqueio
> valeria só onde ninguém tivesse pensado em permissões. Virou `MustChangePasswordMiddleware`,
> que roda antes da view independentemente do que ela declare.

### Fase 6 — Frontend ✅ **CONCLUÍDA**

- [x] `useSelection` extraído do que já existe — 10 testes
- [x] `BulkActionBar` (fixa acima da `BottomNav`, ações roláveis, alvos ≥ 44px)
- [x] Seleção na aba Mensalidades — tabela **e** card (sem o card, não existiria no celular)
- [x] Três diálogos de confirmação + `BulkResultDialog` com os motivos
- [x] Página "Gerar Logins" + item de menu
- [x] Reset de senha — dentro da `LoginsPage`, não como diálogo separado: a ação
      nasce de uma linha da lista e não tinha segundo lugar para existir
- [x] `ChangePasswordPage` sem saída — travada por testes de **ausência**
- [x] Interceptar `must_change_password` no cliente HTTP
- [x] **Validar 375 / 390 / 430px** — medido no navegador, ver nota abaixo
- [x] **Validar 768 / 1024 / 1440px**

> **O que a medição achou.** Os alvos de toque estavam em **40px**, não 44. O
> tema define `padding: 10` no `MuiCheckbox` abaixo de `md`, o que acerta o alvo
> no tamanho padrão (ícone de 24) e erra no `size="small"` (ícone de 20) — que é
> justamente o usado nas listas que se marcam em série. Corrigido com um piso
> explícito (`minWidth`/`minHeight`), que vale para os dois tamanhos.
>
> O resto passou: barra de ações sobre a `BottomNav` sem cobri-la, botões da
> barra em 44px, diálogo sem rolagem horizontal (311px a 375, 444px no desktop),
> nenhuma página com rolagem horizontal, e a barra recolhendo para `bottom: 0`
> acima de `md`, onde a navegação inferior deixa de existir.

### Fase 7 — Testes e validação ✅ **CONCLUÍDA**

- [x] Unitários e de integração (8.1–8.6)
- [x] Permissões por papel e por organização
- [x] Regressão (8.7) — **723 backend + 250 frontend**
- [x] Mobile (8.8)
- [x] `ruff`, `pytest`, `npm run build`, `oxlint`, `vitest`
- [x] Documentar em `REGRAS_DE_NEGOCIO.md` — §14.12 (operações em massa) e §15 (acesso)

> **As lacunas eram todas do frontend.** O backend já cobria 8.2–8.6 nos 39
> testes de `test_login_provisioning.py` e nos 35 de
> `test_finance_bulk_operations.py`. As duas telas novas, porém, não tinham
> teste nenhum: entraram `LoginsPage.test.tsx` (18) e
> `ChangePasswordPage.test.tsx` (11), 221 → 250.
>
> Dois defeitos apareceram ao escrevê-los. A `DataTable` ordena decrescente por
> padrão — certo para data e valor, errado para nome: "Gerar Logins" e a aba
> Mensalistas abriam no fim do alfabeto. E a recusa mais importante do primeiro
> acesso chegava à tela como `new_password: A nova senha não pode ser a
> temporária`, porque faltavam os dois rótulos em `apiError.ts`.

---

## 10. Ordem recomendada

| # | Bloco | Por quê aqui | Risco |
|---|---|---|---|
| 1 | `useSelection` + `BulkActionBar` | Base das três ações; extrair do que já funciona | ✅ **feito** |
| 2 | Geração e vencimento em massa | Reutilizam services existentes; sem migration | ✅ **feito** |
| 3 | Migration de `User` | Destrava a Fase 4 | ✅ **feito** (rollback testado) |
| 4 | Geração de logins | Depende de 3 | ✅ **feito** |
| 5 | Primeiro acesso e reset | Depende de 4; o bloqueio toca **toda** rota | ✅ **feito** (690 testes verdes) |
| 6 | Frontend de cada bloco | Junto do respectivo bloco | ✅ **feito** (973 testes verdes; medido em 6 larguras) |

Os blocos 3 e 5 são os que justificam parar e revalidar tudo antes de seguir.

---

## 11. Critérios de aceite

### CA-1 · Seleção
Marcar um, vários e todos; desmarcar todos; contador correto. Trocar o filtro limpa a seleção. "Selecionar todos" cobre todos os resultados do filtro, não só a página visível.

### CA-2 · Geração de mensalidade
Gerar para os 20 mensalistas: cria para quem não tem, pula quem já tem, resumo no formato *"Total 20 · Criadas 18 · Já possuíam 2 · Erros 0"*. Repetir não duplica.

### CA-3 · Vencimento em massa
Selecionar vários e informar o dia 10: as pendentes passam a vencer no dia 10 **da competência de cada uma**; as pagas ficam intactas e aparecem na lista de não processadas com o motivo. Dia 31 em fevereiro vira 28/29.

### CA-4 · Baixa em massa
Ver o plano irmão CA-5.

### CA-5 · Geração de login
A lista traz os **20 mensalistas ativos** (não os 28 jogadores). Selecionar todos e gerar: 18 criados, 2 pulados ("já possui login"). Cada criado tem `User` + `Membership(jogador)` + `Player.user` preenchido. **O jogador entra digitando o telefone dele e a senha `novasenha123`.**

### CA-6 · Sem duplicidade
Rodar a geração duas vezes: a segunda cria zero e pula todos. Nenhum `User` duplicado, nenhum `Player` novo.

### CA-7 · Senha nunca em texto puro
`User.password` no banco começa com o prefixo do algoritmo de hash. `check_password("novasenha123")` verdadeiro. Nenhuma resposta da API e nenhum registro de auditoria contém a senha, o hash ou o tamanho dela.

### CA-8 · Primeiro acesso obrigatório
Com a senha temporária, o jogador **autentica** mas recebe 403 em qualquer outra rota, com o código `must_change_password`. A tela de troca não tem menu nem saída. A nova senha não pode ser a temporária nem uma senha fraca. Depois da troca, tudo libera.

### CA-9 · Reset
Admin e Gerente resetam; o Gerente só dentro da própria organização (fora dela, 403/404). A senha anterior deixa de funcionar. Ninguém vê a senha de ninguém. Auditado.

### CA-10 · Permissões
Jogador recebe 403 em gerar login, resetar senha e operações em massa. Gerente e Admin mantêm o que já tinham. Superadmin preservado.

### CA-11 · Sem regressão
607 backend + 204 frontend passando, `npm run build` limpo. Login por usuário, e-mail e telefone continua funcionando. Os 5 usuários existentes não são afetados.

### CA-12 · Mobile
Tudo utilizável a 375px: caixas de seleção com alvo confortável, barra de ações sem cobrir a navegação inferior, diálogos sem rolagem horizontal.

---

## 12. Decisões do usuário — ✅ **RESPONDIDAS EM 11/08/2026**

Nenhuma pendência bloqueante. As decisões abaixo estão incorporadas ao plano.

| # | Assunto | Decisão | Consequência |
|---|---|---|---|
| **D1** | B1 — `User.email` | **Tornar o e-mail opcional** | Migration em `accounts`: `EmailField(unique=True, null=True, blank=True)`. Fase 4 destravada |
| **D2** | Escopo | **Só mensalistas ativos** | A lista da aba "Gerar Logins" é `mensalistas_of(organization)` — a mesma função que o financeiro já usa. Hoje: 20 fichas |
| **D3** | B3 — colisão | *(não perguntada — padrão seguro adotado)* **Recusar com motivo** | Telefone que já é `username` de **outra** pessoa não gera login: aparece como pulado, com o conflito nomeado. Nunca sufixo automático — `11928241409-2` seria um login que ninguém adivinha |
| **D4** | RN-6 | **Alterar vencimento normalmente** em cobrança com baixa parcial | Mudar a data não mexe em dinheiro recebido, só no prazo do que falta. Só as **pagas** e as **canceladas** ficam de fora |
| **D5** | B6 | **`novasenha123` igual para todos**, como pedido | Constante única no código. A janela de risco é fechada pela troca obrigatória no primeiro acesso |

### 12.1 Ajustes decorrentes

**D1 — e-mail opcional.**
- Migration `accounts`: `email = EmailField(unique=True, null=True, blank=True)`. No Postgres, vários `NULL` convivem sob índice único.
- `UserSerializer` e `OrganizationMemberSerializer` passam a aceitar/expor `email` nulo — o frontend precisa tolerar (hoje assume `string`).
- `create_user` do provisionamento passa `email=None`, **não** `""`: string vazia colidiria no índice único a partir do segundo login gerado. ⚠️ Ponto de falha silenciosa — teste específico.
- `REQUIRED_FIELDS = ["email"]` fica como está (só afeta `createsuperuser`).

**D2 — só mensalistas.**
- `GET /api/players/login-status/` filtra por `mensalistas_of(organization)`: mensalista, ativo, não temporário.
- "Gerar para todos" significa **todos os mensalistas ativos**, resolvido no servidor — não depende de o navegador ter carregado a lista inteira (mesmo padrão de `bulk_set_player_fees`).
- Convidado que precise de acesso continua pelo caminho existente: `/api/auth/members/`, informando e-mail.

**D4 — vencimento com baixa parcial.**
- `bulk_change_due_date` pula apenas `paid` e `canceled`.
- ⚠️ **Interação com a multa:** adiar o vencimento de uma cobrança atrasada faz a multa deixar de incidir, e uma baixa parcial já lançada pode passar a quitá-la (o total devido cai). É consequência correta da regra §14.4.1, mas precisa estar **na tela**, não só no código — o aviso do diálogo deve dizer quantas mensalidades perdem a multa.

**D5 — senha compartilhada.**
- `SENHA_TEMPORARIA_PADRAO = "novasenha123"` num módulo só, nunca literal espalhado.
- Verificada contra os validadores do projeto: **passa**.
- A troca obrigatória no primeiro acesso (Fase 5) é o que fecha a janela — o que torna a Fase 5 **não opcional**: sem ela, a senha compartilhada fica valendo indefinidamente.
- Se um dia a pelada crescer, trocar para senha aleatória por jogador é mudar a constante por um gerador; o resto do fluxo não muda.
