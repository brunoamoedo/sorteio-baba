# Regras de Negócio do Sistema

> Este documento descreve **o que existe implementado hoje** e como cada parte funciona, na prática. Para o roadmap/plano original, ver [`REQUISITOS.md`](./REQUISITOS.md). Sempre que uma regra mudar no código, atualize este arquivo junto.

## 1. Multi-tenant (Organizações)

- O sistema é um SaaS multi-organização: cada "pelada" é uma `Organization` isolada.
- Todo dado (jogadores, partidas, sorteios, auditoria etc.) pertence a uma organização e nunca é visível para outra — o isolamento é garantido em toda query pela combinação do usuário autenticado (JWT) + o cabeçalho HTTP `X-Organization-Id`, validado contra as `Membership`s ativas do usuário.
- Um mesmo usuário pode pertencer a várias organizações (papéis podem ser diferentes em cada uma).
- Criar uma organização (`register_organization`) cria, na mesma transação: o usuário administrador, a organização e as 4 posições padrão (GOL, ZAG, ME, AT) — toda organização nova já nasce com essas posições.

## 2. Papéis e permissões

| Papel | O que pode fazer |
|---|---|
| **Administrador** (`admin`) | Acesso total à organização. |
| **Organizador** (`organizador`) | Gerencia jogadores, jogos recorrentes, partidas, confirmações, sorteios, placar. Mesmas permissões de escrita que o Admin nas áreas operacionais. |
| **Visualizador** (`visualizador`) | Somente leitura em tudo — não confirma presença, não sorteia, não edita times, não lança placar. |

Regra de negação: qualquer ação de escrita numa rota tenant-scoped exige, no mínimo, papel Organizador. Ações somente leitura (listar, ver detalhe, ver roster) exigem apenas ser membro ativo (qualquer papel).

### 2.1 Entrada no sistema — usuário, telefone ou e-mail

O campo de login aceita os três identificadores. O motivo é o jogador: o `username` é uma invenção do sistema, que ele não escolheu e não lembra; o telefone e o e-mail são dados que ele reconhece como seus.

A senha continua obrigatória em todos os casos — **o identificador muda, a prova de identidade não**. A tradução acontece antes da autenticação (`apps/accounts/login_serializers.py`), então senha, usuário inativo, throttle e claims do token seguem exatamente como eram.

| Identificador | Onde mora | Unicidade |
|---|---|---|
| `username` | `User.username` | única (global) |
| E-mail | `User.email` | única (global) |
| Telefone | `Player.phone` | **nenhuma** — por organização |

O telefone é comparado por `Player.phone_digits`, um campo derivado e indexado com só os dígitos (`normalize_phone`). É o que torna comparável o que a pessoa digita (`11928241409`, `(11) 92824-1409`, `+55 11 92824-1409`) com o que está gravado na ficha com máscara. O prefixo `55` do Brasil é descartado quando acompanha um número completo.

Quatro recusas, todas com a **mesma** mensagem genérica de credencial inválida:

1. O telefone leva a **dois logins diferentes** (duas pessoas com o mesmo número cadastrado). Escolher um seria entregar a conta errada; a trilha registra `login_phone_ambiguous` para o organizador corrigir o cadastro.
2. A ficha não está vinculada a um login — é um cadastro, não uma conta.
3. A ficha foi removida (soft-delete). Se o telefone continuasse valendo, desligar alguém da pelada não tiraria o acesso dele. Os outros identificadores continuam funcionando: quem saiu de uma pelada pode ainda participar de outra.
4. O identificador não existe.

A uniformidade da mensagem é proposital: responder diferente para "não existe" e "existe, mas a senha está errada" transformaria o login num verificador de quem está cadastrado na pelada.

A mesma pessoa com ficha em **duas organizações**, ambas apontando para o mesmo login, entra normalmente — não há ambiguidade sobre quem está entrando.

### 2.1.1 Geração de acesso para os mensalistas

O Gerente cria o acesso dos jogadores a partir do **telefone da ficha**. Gerar um login não é criar um usuário — são três coisas, e faltar qualquer uma entrega uma conta que não faz nada:

```
Player sem user
   ↓
1. User        — identidade global, `username` = dígitos do telefone
2. Membership  — papel `jogador` nesta organização
3. Player.user — o vínculo que faz a confirmação de presença funcionar
```

Sem a `Membership`, a pessoa autentica e não enxerga nada. Sem o vínculo, enxerga a pelada e não consegue confirmar presença.

**Escopo:** apenas mensalistas ativos e não temporários — a mesma lista de quem tem mensalidade. Convidado que precise de acesso continua entrando por `/api/auth/members/`, informando e-mail.

**Nunca duplica.** Cada ficha é tratada por si, e quem não pode receber é **pulado com motivo**:

| Situação | O que acontece |
|---|---|
| Já tem `Player.user` | Pulado — "já possui login". A tela oferece *Resetar senha* |
| Sem telefone | Pulado — "sem telefone cadastrado" |
| Telefone repetido com outra ficha | **As duas** puladas: escolher uma entregaria a conta errada |
| Já existe `User` com aquele telefone, da mesma pessoa em outra pelada | **Reaproveita** o login e cria só o vínculo — a identidade é global |
| Telefone que já é login de **outra** pessoa | Recusado. Nunca sufixo automático: `11928241409-2` seria um login que ninguém adivinha |

O e-mail do login gerado fica **nulo**, não vazio — `User.email` é único, e string vazia colidiria a partir do segundo login. Nulo é a verdade: essa pessoa não informou e-mail.

### 2.1.2 Senha temporária e primeiro acesso

A senha inicial é `novasenha123`, igual para todos, gravada sempre com hash. Ela **nunca** aparece em resposta da API nem na auditoria — nem o valor, nem o hash, nem o tamanho.

Uma senha compartilhada abre uma janela: quem souber o telefone de um jogador entra na conta dele antes do dono. **É a troca obrigatória que fecha essa janela** — por isso ela não é um extra, é parte do mesmo mecanismo.

Enquanto `must_change_password` for verdadeiro, a conta **autentica mas não usa** o sistema:

| Rota | Situação | Por quê |
|---|---|---|
| `POST /auth/token/` | ✅ liberada | Sem autenticar, não há como trocar a senha |
| `POST /auth/token/refresh/` | ✅ liberada | Senão a sessão morre no meio da troca |
| `POST /auth/change-password/` | ✅ liberada | É a saída do estado |
| `GET /auth/me/` | ✅ liberada | A tela precisa saber quem está trocando |
| **todo o resto** | ❌ `403` com `code: "must_change_password"` | |

O bloqueio é **middleware**, não permissão do DRF: uma view que declara `permission_classes` substitui a lista padrão, e o sistema faz isso em 26 lugares — a regra valeria só onde ninguém tivesse pensado em permissões. A tela de troca não tem menu nem saída; se desse para navegar para fora, o "obrigatório" seria decoração.

A nova senha passa pelos validadores do Django e **não pode ser a temporária** — senão a marca seria limpa sem nada ter mudado. A senha atual é exigida mesmo sendo a temporária: sem isso, um token vazado viraria troca de senha direta.

### 2.1.3 Reset de senha

Admin e Gerente devolvem o acesso de um jogador. Quem reseta **não vê** a senha atual: ela é substituída, não revelada, e a anterior deixa de funcionar na hora.

O escopo vem de `request.organization` — um Gerente não alcança ficha de outra pelada. E a rota é para **jogadores**: resetar a senha de quem administra a organização é recusado, porque seria um caminho lateral para tomar a conta de um Gerente. Gestão de quem administra continua em `/api/auth/members/`.

### 2.2 Saída do sistema

"Sair" fica no rodapé do menu lateral no celular e no menu da conta (avatar, canto superior direito) no desktop. Os dois caminhos existem porque o menu lateral só abre pelo hamburger ou pela barra inferior, e ambos são exclusivos do mobile.

## 3. Jogadores (`Player`)

- **Tipo**: `mensalista` ou `convidado`. Além de classificar o jogador na interface (convidado aparece destacado em vermelho na tela, no campo e na mensagem do grupo), **decide em qual time ele entra** — ver §6.2.1.

  > ⚠️ **Regra invertida em 11/08/2026.** Até esta data os convidados eram *espalhados* entre os times, com um critério próprio no algoritmo. Passou a valer o oposto: **mensalista tem prioridade nos primeiros times**.
- **Status**: `ativo` ou `inativo`. Jogadores inativos não aparecem no roster de confirmação de partidas nem entram no sorteio.
- **Nível técnico (`skill_level`)**: inteiro de 1 a 5 estrelas — é o principal insumo do critério de equilíbrio do sorteio.
- **Posição principal** (obrigatória) e **posição secundária** (opcional): usadas para a distribuição por posição no sorteio.
- **Ações em lote**: a tela de Jogadores tem seleção por linha e uma caixa no cabeçalho que marca **todos os resultados do filtro atual** — não só os da página visível (a pegadinha clássica desse controle). Com algo selecionado aparece uma barra com **Ativar**, **Inativar** e **Remover** (soft-delete, com confirmação). Trocar o filtro **limpa a seleção**, para a ação nunca cair em quem não está mais na tela. Visualizador não vê a seleção nem as ações.
- Exclusão de jogador é **soft-delete** (ver seção 12): o registro nunca é apagado fisicamente por uma ação de usuário; ele só some das listagens (`is_deleted=True`), preservando o histórico de sorteios/estatísticas em que ele já apareceu.

## 4. Jogos Recorrentes (`RecurringGame`) e geração de partidas

- Um jogo recorrente define: nome, dia da semana, horário do jogo, horário do sorteio, quantidade de times, a faixa de **jogadores de linha por time** (mínimo e máximo, sem contar goleiro), **quantos goleiros cada time reserva** e a **antecedência de geração** da próxima partida.
- **Cálculo automático de mínimo/máximo da partida**: `min_players = teams_count × (min_players_por_time_linha + goalkeepers_per_team)` e o mesmo para `max_players`. Ou seja, o organizador não digita o total de jogadores da partida — ele configura por time e o sistema soma os goleiros automaticamente. Esses dois campos são somente leitura na API (recalculados a cada save). O cálculo vive em um único lugar (`compute_player_bounds`), compartilhado com a criação de partidas avulsas.
- **Goleiros por time (`goalkeepers_per_team`, padrão 0)**: quantos goleiros cada time reserva. O padrão é **0** porque, na prática, o goleiro da pelada é fixo: não é sorteado e muitas vezes nem está cadastrado como jogador — **só os jogadores de linha precisam confirmar**. Quem tem goleiro cadastrado e quer a vaga reservada configura 1 (ou mais).
  - Com o goleiro fixo em 1 (o comportamento anterior), uma pelada de "6 de linha por time" com 3 times pedia **21** confirmados em vez de 18: o sorteio devolvia 7 de linha por time (a vaga do goleiro acabava ocupada por mais um jogador de linha) e, pior, o **sorteio automático ficava travado** esperando 3 goleiros que não existem no cadastro.
  - Alterar o padrão não mexe em partidas nem jogos recorrentes já existentes — só no que nasce a partir de agora.
- Validação: precisa de pelo menos 2 times; mínimo de linha ≥ 1; mínimo de linha não pode ser maior que o máximo de linha; goleiros por time entre 0 e o máximo de jogadores de linha por time.
- **A "próxima partida" nunca nasce com a bola já rolando**: se a ocorrência calculada cai em **hoje** e o **horário do jogo já passou**, o sistema pula para a semana seguinte. Não dá tempo de confirmar presença nem de sortear — gerar essa partida entregaria ao organizador algo nascido vencido. Vale para os dois modos (botão e task periódica), e também para uma ocorrência de hoje que **já existe** e continua "Agendada": passado o horário do jogo, ela deixa de valer como "a próxima" e o botão gera a seguinte.
- **Geração de partidas**: a próxima ocorrência de cada jogo recorrente ativo é criada como `Match` para que as confirmações possam começar antes do dia do jogo. A lógica (`ensure_next_match`) é idempotente: só cria uma nova partida se a última gerada já passou da data de hoje. Três gatilhos:
  1. **Ao criar o jogo recorrente** — a partida nasce junto. (Antes dependia só da task, que roda de hora em hora; um jogo cadastrado para o próprio dia perdia a janela de confirmação.)
  2. **Ao reativar** um jogo recorrente inativo.
  3. **Task periódica** (`generate_upcoming_matches_task`, Celery Beat, de hora em hora), que mantém a geração andando semana a semana.
- **Alterar um jogo recorrente realinha as partidas futuras ainda "abertas".** Salvar a recorrência propaga na hora `horário do jogo`, `quantidade de times`, `goleiros por time` e `mínimo/máximo de jogadores` para **todas** as partidas dela que ainda vão acontecer e continuam sorteáveis (status `Agendada`/`Confirmando`, **sem sorteio**). A regra vive num sinal `post_save` (`apps/matches/signals.py`), não na rota: vale igual para a API, o Django admin, o shell, o seed e qualquer script.
  - A propagação é **idempotente** e só grava os campos que realmente mudaram.
  - Mexer na capacidade reconcilia a lotação na hora: excedente vai para a fila de espera e, se a capacidade cresceu, quem esperava é promovido — ninguém é descartado.
  - **A data nunca é movida.** Mudar o dia da semana não arrasta uma partida já gerada: as pessoas confirmaram presença para aquele dia. A divergência de dia da semana continua sinalizada para o organizador decidir.
- **Partida já sorteada é intocável** — os times foram montados com aquela configuração, e reescrevê-la por baixo do resultado seria destrutivo e silencioso. Para ela (e só para ela, além do caso da data acima) vale o **aviso em vermelho**: a partida mostra, na listagem e na tela de detalhe, quais campos estão diferentes da configuração atual do jogo recorrente, no formato "Esta partida: X → Jogo recorrente: Y". O aviso só vale para partidas **que ainda vão acontecer** — partida passada, concluída ou cancelada divergir de uma configuração alterada depois é o esperado.
- **Geração sob demanda**: o botão "Gerar a próxima partida agora" na tela de Jogos Recorrentes força a criação. É a saída explícita para os dois casos em que a geração automática se abstém de propósito: a ocorrência foi **removida** pelo organizador, ou ainda está **fora da janela** de `days_before_to_generate`. Quando a ocorrência havia sido removida, ela é **reaberta preservando id, confirmações e histórico de sorteios** — não nasce uma partida duplicada. Visualizador não pode gerar.
  - O botão **sempre devolve uma partida com a configuração vigente**, lida do banco no momento da chamada, por um de dois caminhos:
    - **Ocorrência ainda aberta** (`Agendada`/`Confirmando`): ela *é* a próxima partida — é **realinhada** e devolvida. Gerar outra criaria uma duplicata.
    - **Ocorrência já gasta** (`Sorteada`, `Em andamento`, `Concluída` ou `Cancelada`): não pode ser realinhada e não representa mais "a próxima" — então **não bloqueia**, e a partida **seguinte** é criada já com a configuração nova. A partida gasta fica intacta, com a configuração dela e o aviso de divergência.
  - Isso era um bug em duas camadas. Como a partida nasce junto com o jogo recorrente, o botão caía sempre no atalho "já existe uma ocorrência futura, devolve ela" e entregava o registro montado **antes** da edição. E quando essa ocorrência já estava sorteada — o caso em que o realinhamento é proibido de propósito — não havia saída nenhuma: o botão devolvia a partida velha para sempre.
  - A **geração automática** (task periódica) não mudou: ela continua esperando a data passar, e só o botão explícito avança sobre uma ocorrência gasta.
  - Criação e realinhamento leem a mesma lista de campos (`match_config_from`), então não existe um caminho que copia uma configuração e outro que esquece de copiar.
- **Antecedência configurável (`days_before_to_generate`, padrão 7)**: a próxima partida só é criada quando faltam no máximo esse número de dias para a ocorrência. Com o padrão 7, o comportamento é exatamente o histórico — como a recorrência é semanal, a próxima partida nasce assim que a anterior passa. Reduzindo o valor (ex.: 2), a partida — e portanto a lista de confirmação — só aparece perto do jogo.
- Partidas avulsas (sem jogo recorrente) também são suportadas — ver seção 4.1.

## 4.1 Partidas avulsas (manuais)

- O organizador pode criar uma partida diretamente, sem jogo recorrente, informando: **nome** (opcional), **data**, **horário do jogo**, **horário do sorteio** (opcional), **local** (opcional), **observações** (opcional), **quantidade de times**, o **máximo de jogadores de linha por time** e os **goleiros por time**.
- O máximo de jogadores da partida é calculado pela **mesma regra** dos jogos recorrentes (`times × (linha + goleiros)`) — o organizador nunca digita o total.
- **A partida avulsa não configura um mínimo**: ele é fixo em 1 de linha por time mais os goleiros configurados (`min_players = times × (1 + goleiros)`). É o piso prático do algoritmo — na prática o organizador sorteia quando quiser, sem trava.
- **Editar uma partida preserva o mínimo que ela já tinha**: alterar o local de uma partida gerada por jogo recorrente (mínimo 10, por exemplo) não afrouxa essa trava para 4.
- As mesmas validações valem: pelo menos 2 times e mínimo ≤ máximo.
- Partidas (avulsas ou geradas por jogo recorrente) podem ser **editadas** e **removidas** pelo organizador. A remoção é soft-delete: a partida some das listagens, mas o histórico de sorteios e a auditoria são preservados. Uma ocorrência de jogo recorrente removida **não é recriada** pela task de geração.
- Alternativa não destrutiva à remoção: **cancelar** a partida (`status = Cancelada`). A partida continua visível e o cancelamento é **reversível** pela ação de reativar — que devolve o status para `Agendada`, ou `Sorteada` se já houver sorteio vigente. Partida cancelada não é sorteada automaticamente e não aparece como "próxima partida" no dashboard.
- **Editar uma partida sem mexer na configuração de capacidade preserva os totais originais**: alterar apenas o local, por exemplo, nunca muda quantos jogadores a partida comporta (e, portanto, quem entra e quem fica na espera).
- Um jogo recorrente de outra organização nunca pode ser vinculado a uma partida, mesmo que o id seja informado manualmente na requisição.
- Visualizador não cria, edita nem remove partidas.

### Sorteio automático habilitado ou não (`automatic_draw`)

- **Critério único do sistema**: o sorteio automático só existe quando a partida tem uma **configuração de agendamento válida**. Isso é exposto como um campo booleano da partida, `automatic_draw`, calculado no backend (`Match.automatic_draw`) e lido por todas as camadas — task periódica, API e interface. Nenhuma delas deduz a regra por conta própria.
- Cada partida tem um **horário efetivo de sorteio** (`effective_draw_time`): o `draw_time` da própria partida tem precedência; se estiver vazio, herda o `draw_time` do jogo recorrente de origem. A origem é informada em `automatic_draw_source` (`match` ou `recurring_game`), e o momento exato do disparo em `automatic_draw_at` (data da partida + horário efetivo).

| Partida | `automatic_draw` | Comportamento |
|---|---|---|
| Gerada por jogo recorrente (herda o horário do jogo) | `true` | Sorteia sozinha no horário |
| Avulsa **com** horário de sorteio informado pelo organizador | `true` | Sorteia sozinha no horário |
| Avulsa **sem** horário de sorteio | `false` | **Nunca** sorteia sozinha — só pelo botão |

- Partida avulsa sem horário de sorteio não gera agendamento, não é varrida pela task e não dispara nenhum processamento automático. O comportamento dela é exatamente o de sempre: o organizador clica em "🎲 Sortear Times".
- Informar um horário de sorteio numa partida avulsa é a forma explícita de o organizador **optar** pelo automático — não é o padrão.
- **A origem da partida nunca é critério — a configuração atual manda.** Uma partida avulsa criada sem horário e **editada depois** para ganhar um passa a ser tratada como automática a partir daquele momento, exatamente como uma recorrente. O inverso também vale: limpar o `draw_time` de uma avulsa desabilita o automático (não há registro de agendamento a remover — o horário efetivo é a única fonte, e cada edição o substitui). Atenção: numa partida gerada por jogo recorrente, limpar o `draw_time` próprio não desliga o automático — ela volta a **herdar** o horário do jogo recorrente.
- **Configurar (no dia da partida) um horário que já passou vale como "sortear agora"**: o sorteio vencido é executado na própria gravação da edição, e a resposta já volta como `Sorteada`.
- **Na interface** (só quando `automatic_draw` é `true`): a tela da partida mostra "🤖 Sorteio automático habilitado às HH:MM", identificando o jogo recorrente quando o horário é herdado, e, depois de executado, "✅ executado em DD/MM/AAAA HH:MM"; o resultado ganha o chip "🤖 Sorteio automático"; a listagem de partidas mostra o horário do sorteio abaixo do horário do jogo. Partida avulsa sem agendamento não exibe nada disso — a tela dela continua igual.

## 5. Confirmação de presença (`Confirmation`)

- Cada combinação (partida, jogador) tem um status: `pending` (padrão), `confirmed` ou `declined`.
- Somente jogadores com status `confirmed` entram no sorteio.
- **Confirmação manual**: o organizador liga/desliga um toggle por jogador na tela da partida.
- **Confirmar/desmarcar todos**: dois botões na tela da partida aplicam o mesmo status a **todos os jogadores ativos** de uma vez. Jogadores inativos e de outras organizações nunca são tocados. Cada jogador alterado gera seu próprio registro de auditoria, igual à confirmação individual. Desmarcar todos pede confirmação antes (é destrutivo) e não afeta um sorteio já realizado.
- **Adicionar jogador pelo nome (na tela da partida)**: um campo único onde o organizador digita um nome e o sistema aplica o **mesmo reconhecimento** da lista em lote — se o nome corresponder a um mensalista ativo, esse mensalista é confirmado (não se cria duplicata); se não corresponder, um convidado é criado e já confirmado. A resposta informa qual dos dois aconteceu.
- **Confirmação em lote por lista de nomes** ("Sortear com lista de nomes"): o organizador cola a lista do grupo (um por linha, ex.: copiado do WhatsApp) e o sistema:
  0. **Decompõe cada linha antes de comparar** (`parse_roster_line`). A lista real não vem limpa — vem numerada, com emojis e anotações do organizador. São removidos: a numeração (`1-`, `2 - `, `10.`, `11)`, com hífen ou travessão), os emojis em qualquer posição, o conteúdo entre parênteses/colchetes e as anotações de controle (`PAGO`, `PAGOU`, `PG`, `PIX`, `DEVE`, `FALTA`…). Assim `3 - Zango ♟️(Sacra) PAGO` é procurado como **"Zango"**. Sem esse passo, a numeração entrava como palavra no casamento por token e derrubava a média abaixo do limiar: numa lista real de 20 linhas **nenhuma** era reconhecida e colar a lista criava 20 convidados duplicados, inclusive de mensalistas já cadastrados. O convidado criado também nasce com o nome limpo ("Zango"), não com a linha inteira.
  0.1. **Linhas marcadas com 👋 ❌ ✖ ❎ 🚫 ⛔ 🙅 são "fora da lista"**: aparecem na conferência com a etiqueta "Fora da lista — não confirmado" e **não** geram confirmação nem jogador. Confirmar quem desistiu seria um erro silencioso; aparecer marcado na tela é visível e o organizador confirma na mão se for engano.
  1. Compara o nome limpo com os mensalistas ativos da organização (comparação por palavra, tolerante a acentos, maiúsculas/minúsculas e pequenas variações de digitação/apelido) e confirma automaticamente o mensalista reconhecido. **Empate é resolvido pelo candidato mais específico**: "Barba" pontua igual para o mensalista "Barba" e para "Bruno barba" — vence quem bate o nome inteiro e, depois, quem tem menos palavras sobrando. Antes vencia o primeiro da consulta.
  1.1. **Só concorre quem ainda não está confirmado nesta partida**, e o mensalista reconhecido sai da disputa na hora — a linha seguinte não pode levar a mesma pessoa. Sem essa regra, duas linhas parecidas ("Firmino" e "Santiago", quando existe o mensalista "Felipe Santiago Firmino") casavam com o mesmo cadastro: a segunda reconfirmava quem já estava dentro — um no-op invisível, marcado com ✅ na tela — e a pessoa daquela linha simplesmente não entrava na partida. Valia também ao colar a lista duas vezes ou ao colar depois de confirmar alguém na mão.
  1.2. **`ja_confirmado`**: quando o nome só se parece com alguém que **já está confirmado**, a linha é relatada com essa etiqueta e **nada é alterado** — não reconfirma nem cria um convidado homônimo. Pode ser a mesma pessoa repetida (é só ignorar) ou outra pessoa de nome parecido; nesse caso o organizador escolhe na busca quem deveria entrar, e essa pessoa é confirmada. Só "confirmado" tira o mensalista da disputa: quem recusou a presença ou ainda não respondeu continua podendo ser reconhecido.
  2. Quando não encontra um mensalista com confiança suficiente, cria (ou reaproveita, se já existir com esse nome exato) um jogador do tipo `convidado` **temporário** e já confirma sua presença. "Temporário" (`Player.is_temporary`) significa: ele **não é cadastro** — existe apenas para poder entrar no sorteio daquela partida (confirmação, fila e sorteio têm FK obrigatória para `Player`). Na prática: **não aparece na tela de Jogadores**, não é varrido por "Confirmar todos" de outras partidas, aparece normalmente no roster e no resultado da partida dele, e é **removido quando a partida é concluída**. O resultado já divulgado continua completo — `TeamPlayer` guarda posição e estrelas da época, e `Player.Meta.base_manager_name = "all_objects"` garante que o nome continue legível depois da remoção. Um temporário que ainda esteja confirmado em outra partida em aberto é preservado. O convidado novo nasce na **primeira posição de linha** cadastrada (a de menor `sort_order` que não seja goleiro) — não na última, que transformava toda a lista em atacantes e distorcia o critério de distribuição por posição do sorteio.
  3. Cada linha processada retorna o nome digitado, a decisão tomada (mensalista reconhecido ou convidado criado) e o grau de confiança do casamento de nomes.
- **Correção de reconhecimento errado**: tanto para uma linha que virou "convidado" (não reconhecido) quanto para uma que foi reconhecida como o mensalista errado, existe uma busca/autocomplete para apontar o mensalista correto. A busca oferece **apenas mensalistas que não estão confirmados na partida** — apontar a correção para quem já está dentro não corrigiria nada (o convidado errado sairia, o mensalista continuaria onde estava e a partida perderia uma vaga em silêncio); a API recusa o caso com `DomainError`, e a tela nem chega a oferecer o nome. Ao corrigir:
  - A confirmação do jogador errado é marcada como `declined` (não fica como presença fantasma).
  - A confirmação do mensalista correto é marcada como `confirmed`.
  - Se o jogador errado era um convidado criado só por causa dessa tentativa (sem nenhuma outra confirmação em qualquer partida), ele é removido (soft-delete) — não sobra um convidado fantasma cadastrado por engano.
- O algoritmo de casamento de nomes nunca decide "às cegas" por semelhança pura de string inteira: ele compara palavra a palavra (evita, por exemplo, que "Isak Marocas" seja casado com "Irmão Marocas" só porque o sobrenome bate, quando o correto é "Isaac Rodrigues Marocas").

## 5.1 Capacidade da partida e Lista de Espera (`WaitlistEntry`)

### Capacidade
- A **configuração da partida manda em tudo**. A capacidade é derivada dela em um único lugar (`compute_match_capacity`, exposto na API como o objeto `capacity`): `times × (jogadores de linha por time + goleiros por time)`. Nenhuma camada — nem o sorteio, nem a interface — recalcula isso por conta própria.
- Exemplos: 2 times, 6 de linha, 1 goleiro por time → **14 vagas**. Os mesmos 2 times × 6 de linha com **0 goleiros** (goleiro fixo, fora do sorteio) → **12 vagas**, e cada time sai com 6.
- A tela da partida exibe a configuração literalmente ("⚙️ 2 times × (6 de linha + 1 goleiro) = 14 jogadores"; com 0 goleiros, "⚙️ 2 times × (6 de linha) = 12 jogadores · goleiro não entra no sorteio") e a ocupação ("👥 14 de 14 confirmados · ⏳ 2 na espera").

### Quem entra na fila
- Confirmar presença com a partida **já cheia** coloca o jogador na lista de espera em vez de confirmá-lo. A API responde explicitamente com `waitlisted: true` e a posição, e a interface avisa. **Ninguém é descartado.**
- Vale para todos os caminhos de confirmação: o toggle individual, "Confirmar todos", "Adicionar jogador pelo nome" e a lista de nomes colada do WhatsApp.
- "Confirmar todos" preenche até o teto e enfileira o excedente — e preenche as vagas com **mensalistas primeiro**.
- Se uma partida antiga tiver mais confirmados que o teto (dado gravado antes desta regra existir), o excedente é movido para a fila no momento do sorteio, também sem descartar ninguém.

### Ordem da fila
1. **Mensalistas na frente de convidados** — um mensalista que confirma depois entra à frente dos convidados que já esperavam.
2. Dentro do mesmo tipo, **ordem de inscrição** (quem confirmou antes fica na frente).
3. O organizador pode **reordenar manualmente** (subir/descer), e a reordenação entre jogadores do mesmo tipo é preservada nas entradas automáticas seguintes.

### Saída da fila
- **Promoção automática**: assim que uma vaga é liberada (alguém recusa presença, é removido da partida ou fica inativo), o primeiro da fila é confirmado automaticamente e os demais são renumerados.
- **Promoção manual**: o organizador pode colocar alguém específico em campo, desde que haja vaga. Se a partida estiver cheia, a ação é recusada com mensagem clara — empurrar outro jogador para fora automaticamente seria destrutivo e silencioso.
- O organizador também pode **remover** alguém da fila.
- **Promover alguém não refaz o sorteio.** Decisão de produto: times já divulgados no grupo não são reescritos sozinhos; o organizador aciona "Sortear Novamente" quando quiser recalcular.
- Toda entrada e promoção gera registro de auditoria (`waitlist_added` / `waitlist_promoted`).
- Visualizador enxerga a fila mas não a altera.

## 5.2 Sorteio avulso (a partida nasce da lista)

Caminho curto para "vamos jogar hoje": em **uma tela** (`/sorteio-avulso`) o organizador monta a lista, cria a partida e sorteia.

- **A lista é montada de dois jeitos, misturáveis**: colando o texto do grupo (mesmo formato da seção 5 — numeração, emojis, anotações, 👋/❌) e/ou buscando mensalistas pelo nome, que entram como mais uma linha. A busca não oferece quem já está na lista: seria uma linha duplicada para o organizador conferir à toa.
- **O reconhecimento de nomes é o mesmo** — a lista vai para o `quick-confirm` da partida recém-criada, com todas as regras da seção 5 (decomposição da linha, `ja_confirmado`, convidado temporário, correção pela busca). Não existe um segundo reconhecimento: dois teriam divergido na primeira lista fora do padrão.
- **A capacidade nasce do tamanho da lista**: `jogadores de linha por time = teto(nomes ÷ times) − goleiros por time`, com piso de 1. 14 nomes em 2 times sem goleiro → 7 de linha por time, 14 vagas. Assim **ninguém vai para a lista de espera** numa tela cujo objetivo é sortear quem está ali. O mínimo por time é 1 de linha, o mesmo piso da partida manual.
- **A partida é criada no momento de conferir a lista**, não no de sortear — conferir exige uma partida, porque é ela que o `quick-confirm` recebe. É uma partida avulsa normal: aparece em Partidas e pode ser cancelada por lá. A tela diz isso.
- **Partida avulsa criada aqui não tem sorteio automático** (`draw_time` nulo): quem está nesta tela vai sortear com o botão, agora. Ver seção 6.
- Depois do sorteio, a tela da partida é a dona do resultado (formação, campo, placar, mensagem de WhatsApp) — o sorteio avulso leva para lá.
- **Admin e Organizador.** O visualizador não cria partida nem sorteia, e o item nem aparece no menu dele.

## 6. Sorteio (`Draw`)

### 6.1 Quando pode sortear
- Só é possível sortear (manual ou automático) quando a quantidade de jogadores **confirmados** atinge o mínimo configurado na partida (`match.min_players`). Abaixo disso, a tentativa falha (`InsufficientPlayersError`).
- O sorteio **nunca ultrapassa o máximo configurado**: antes de rodar, o excedente é movido para a lista de espera (seção 5.1).
- Entram no sorteio apenas confirmações de jogadores **ativos e não removidos** — a mesma consulta alimenta o contador exibido na tela, então o que aparece na interface é exatamente o que vai a campo.
- **Sorteio manual**: o organizador aciona a qualquer momento, uma vez atingido o mínimo. Pode repetir ("Sortear novamente") quantas vezes quiser — cada execução gera um novo `Draw`; o anterior deixa de ser o vigente (`is_current=False`) mas continua salvo no histórico. O sorteio que está sendo substituído **não** conta como "semana anterior" no histórico de duplas.
- **Sorteio automático**: uma task (`auto_draw_tick`, Celery Beat, roda a cada minuto) sorteia as partidas do dia que têm **sorteio automático habilitado** (`automatic_draw`, ver seção 4.1) e cujo horário efetivo já chegou. Partida avulsa sem horário de sorteio nunca entra nessa varredura. A comparação é por **janela de tolerância** (`DRAW_AUTO_DRAW_GRACE_MINUTES`, padrão 60 min), não pelo minuto exato: um atraso do worker não faz mais o sorteio do dia deixar de acontecer, e a janela serve de retentativa enquanto o mínimo de confirmados não é atingido.
- O sorteio automático **respeita exatamente as mesmas regras do manual**: quantidade de times, jogadores por time, equilíbrio de níveis, distribuição por posição, excedente para a lista de espera, snapshot do jogador, histórico e auditoria. O que muda é só quem disparou.
- **Sorteio vencido e travado por falta de gente**: o mínimo de confirmados vale igual para o automático — ele não sorteia abaixo dele. Antes isso era um no-op silencioso: o horário passava, o sorteio não saía e nada explicava o motivo. Agora a partida expõe `automatic_draw_blocked_reason` ("o horário já passou, mas faltam N confirmados para o mínimo de X"), a tela mostra o aviso em amarelo, e **confirmar presença dispara a retentativa na hora** — o sorteio sai na própria resposta da confirmação assim que o mínimo é atingido, sem precisar reabrir a tela.
- **Gatilhos de recuperação (`run_due_automatic_draw`)**: o beat é o disparo pontual, mas não é o único gatilho — salvar a partida (criação/edição), confirmar presença (individual, em lote ou por lista de nomes) e abrir a tela dela também avaliam se existe sorteio automático **vencido** (habilitado + não sorteado + dia da partida + horário já chegou, **sem** teto de tolerância). É o que garante o sorteio quando o worker/beat está fora do ar, quando a janela de tolerância já fechou, ou quando o organizador habilita o automático depois do horário. A falta de confirmados nesses gatilhos não gera erro para quem salvou/abriu: fica no log e a tentativa se repete no próximo contato — por exemplo, na releitura da tela logo após as confirmações completarem o mínimo. Depois que o dia da partida passa, a recuperação **não** age mais (sortear dias depois seria surpresa, não automação).
- **Quem disparou fica gravado**: cada `Draw` tem um campo `trigger` (`manual` ou `automatic`), refletido na auditoria (`draw_created`, campo `trigger` no payload) e na tela. Antes isso era apenas deduzido de `executed_by` nulo.

#### Proteção contra sorteio duplicado (automático)

O sorteio manual pode ser repetido à vontade ("Sortear Novamente" é uma funcionalidade). Já o automático **nunca** roda duas vezes na mesma partida — ninguém está olhando a tela para perceber. Três camadas garantem isso:

1. **Filtro da task**: partidas com `draw_executed_at` preenchido ou com um sorteio vigente já são descartadas na consulta.
2. **Trava de linha**: `execute_automatic_draw` faz `SELECT ... FOR UPDATE` na partida e **reavalia a elegibilidade com a linha travada e recarregada do banco**. Dois workers, ou dois ticks que se sobrepõem, serializam nesse ponto: o segundo encontra a partida já sorteada e não faz nada (devolve `None`, não é erro).
3. **Evidência no banco, não em memória**: a trava olha para `has_draw` (existe sorteio vigente **ou** `draw_executed_at`), não só para o status. Por isso reiniciar a aplicação não sorteia nada de novo, e uma partida que volta para o status `Agendada` com sorteio salvo também não é reprocessada.

Complemento: reabrir uma ocorrência cancelada que já tinha sorteio devolve o status **`Sorteada`** (não `Agendada`), a mesma regra de `reactivate_match`.

### 6.2 Algoritmo (Simulated Annealing)

#### Restrição obrigatória: os piores jogadores nunca ficam juntos
> Quando os fracos **sobram** (mais deles que times), a restrição garante um em cada time e o excedente vai para o último — ver o critério 5b em "Critérios de pontuação".

Antes de qualquer critério de pontuação vem uma **restrição**: com N times, os **N jogadores de menor nível vão para times diferentes** — sempre que isso for matematicamente possível. Com 3 times, os 3 piores ocupam um time cada; com 4 times, os 4 piores; e assim por diante.

- **Empate de nível** é tratado por camadas cumulativas (`weakest_tiers`), não escolhendo arbitrariamente "os três primeiros da lista": a primeira camada é o nível mais baixo inteiro, a segunda acrescenta o nível seguinte, e assim até haver gente suficiente para todos os times. Cada camada é cobrada separadamente. Na prática: 4 jogadores ⭐ para 3 times viram 2-1-1 (nunca 3-1-0); 2 jogadores ⭐ e 3 ⭐⭐ para 3 times mantêm os dois ⭐ separados **e** espalham os cinco.
- **Desempate** entre jogadores de mesmo nível: sorteio (aleatoriedade controlada) na distribuição inicial + os demais critérios (posição, equilíbrio, histórico) na busca. Nunca a ordem de cadastro.
- **Garantia, não preferência**: o piso atingível deste critério é calculado por construção (`minimum_weakest_split_cost`) e a busca **rejeita** qualquer solução acima dele. Nenhum ganho de equilíbrio ou de média compra a violação da regra — nem quando juntar dois dos piores deixaria as somas de estrelas mais parecidas.

#### Critérios de pontuação
Respeitada a restrição, o sorteio é uma busca por otimização que minimiza um score de "custo" combinando os critérios abaixo, cada um com um peso configurável (`ScoringWeights`, hoje com valores padrão fixos: equilíbrio=1.0, posição=1.0, repetição=0.5, uso de posição secundária=0.3, separação dos piores=10.0, distribuição de convidados=0.3):

1. **Equilíbrio técnico**: soma dos desvios quadráticos entre o total de estrelas de cada time e a **parte que cabe àquele time**, que é proporcional ao número de jogadores dele (`estrelas_por_jogador × tamanho_do_time`). Com todos os times do mesmo tamanho, essa parte é exatamente a média das somas — o critério é o de sempre. A diferença aparece quando o número de confirmados não divide igual: perseguir a **mesma soma** para um time menor o obrigava a fazer as mesmas estrelas com um jogador a menos, ou seja, **a levar os melhores**. Numa medição de 200 sorteios com 27 jogadores em 4 times (7-7-7-6), os 4 melhores caíam no time de 6 em 40% das vezes contra ~19% em cada um dos outros; com o alvo proporcional, os quatro times ficam entre 23% e 27%.
2. **Distribuição por posição**: para cada posição, o ideal é `total_da_posição / quantidade_de_times` jogadores por time.
   - **Posição escassa** (ex.: só existem 2 goleiros para 3 ou 4 times): o sistema detecta quando a quantidade disponível é menor que o número de times e, nesse caso, só penaliza se **mais de 1** ficar concentrado no mesmo time — não penaliza times que ficam sem nenhum goleiro (fisicamente não tem como evitar).
3. **Repetição de parcerias**: cada dupla de jogadores que já jogou junta em sorteios recentes da organização recebe uma penalidade se cair no mesmo time de novo. A "memória" considera os últimos **10 sorteios vigentes** (configurável pela variável de ambiente `DRAW_PAIRING_HISTORY_WINDOW`, lida no setting `DRAW_DEFAULT_PAIRING_HISTORY_WINDOW`), com peso decrescente: o sorteio mais recente pesa mais que os mais antigos da janela.
4. **Uso de posição secundária**: pequena penalidade quando o algoritmo precisa colocar um jogador na posição secundária em vez da principal para fechar a distribuição.
5. **Separação dos piores**: o custo da restrição acima. Continua no score (com o peso mais alto de todos) para que a trilha de auditoria registre com que custo o sorteio fechou.
5b. **Sobra dos piores no último time** (peso 4.0): quando há **mais jogadores fracos que times**, a separação garante um em cada time mas alguém precisa levar dois — e qual time levava era indiferente para o custo, então caía no aleatório. O excedente vai para o **último** time: ele absorve a sobra e os demais ficam parelhos entre si. Sem sobra (fracos ≤ times) o critério devolve zero e não opina. O peso foi medido: com 2.0 a sobra caía no último time em 83% dos sorteios, com 4.0 em 100%; acima disso não melhora e começa a puxar os melhores de volta para o último time.
6. **Distribuição de convidados**: convidados espalhados entre os times, em vez de concentrados em um só.

Processo de busca: parte de um **draft em serpentina do pior para o melhor jogador** (1-2-3-3-2-1), que já nasce cumprindo a restrição — distribuir em ordem crescente de nível deixa todo prefixo da lista espalhado entre os times — e equilibra as somas pela inversão de sentido a cada rodada. Depois tenta repetidamente trocar dois jogadores entre times (ou alternar alguém para a posição secundária), descartando de saída as trocas que violariam a separação dos piores e aceitando as demais que pioram o score com uma probabilidade decrescente ao longo do tempo (têmpera decrescente — geometricamente, 0.995 por iteração), até um máximo de 20.000 iterações ou 3.000 iterações seguidas sem melhora. A melhor solução já vista é sempre preservada (elitismo), então o resultado nunca piora com mais iterações.

Como só os três critérios originais têm coluna em `Draw`, os custos de separação dos piores, da sobra dos piores e de distribuição de convidados são gravados no payload da auditoria do sorteio (`score_weakest_split`, `score_weakest_surplus`, `score_guest_balance`).

### 6.2.1 Prioridade do mensalista

Os primeiros times são preenchidos com **mensalistas**; o convidado só entra depois que eles acabam.

```
12 mensalistas + 12 convidados, 4 times de 6
   Time A: 6 mensalistas      Time C: 6 convidados
   Time B: 6 mensalistas      Time D: 6 convidados
```

**Faltando mensalista, os primeiros times enchem na ordem e o resto se completa com convidados** — o sorteio nunca falha por falta:

```
9 mensalistas + 15 convidados, 4 times de 6
   Time A: 6 mensalistas               Time C: 6 convidados
   Time B: 3 mensalistas + 3 convidados   Time D: 6 convidados
```

**A prioridade vem antes do equilíbrio por nível.** É uma consequência aceita: se os mensalistas forem mais fortes, os primeiros times ganham dos últimos. O equilíbrio continua valendo **dentro** de cada grupo — os mensalistas são distribuídos entre os times de mensalista em serpentina, e os convidados entre os deles.

A garantia é **por construção**, não por penalidade: a cota de mensalistas por time é fixada na solução inicial, e a têmpera só troca jogadores **do mesmo tipo**. Não existe combinação que o algoritmo possa escolher que viole a regra — diferente de um critério com peso, que ele poderia decidir "pagar" para melhorar outro.

As demais regras seguem intactas: separação dos mais fracos, distribuição por posição, histórico de repetição e tamanho dos times.

### 6.3 Tamanho dos times
- Times não precisam ter exatamente o mesmo tamanho quando o total de confirmados não é múltiplo do número de times — a diferença fica no máximo em 1 jogador entre o time maior e o menor (distribuição balanceada na semente inicial).
- O algoritmo **distribui os confirmados**; ele não reserva fisicamente a vaga de goleiro. Quem garante que cada time terá goleiro é a combinação de (a) `goalkeepers_per_team` na configuração, que dimensiona a partida, e (b) o critério de distribuição por posição (seção 6.2), que espalha os goleiros confirmados entre os times. Se a organização configura 1 goleiro por time mas não tem jogadores na posição GOL confirmados, as vagas são preenchidas por jogadores de linha — nesse caso o certo é configurar **0 goleiros por time** (seção 4).

### 6.4 Edição manual pós-sorteio
- Depois de sorteado, o organizador pode **arrastar jogadores entre times** direto no campo em SVG (mouse, toque ou caneta — o gesto usa Pointer Events e vale igual em desktop, tablet e celular). Cada jogador no campo carrega `data-player-id`, `data-team-player-id` e `data-team-id`, ligando o desenho ao estado real da aplicação; ao arrastar, o jogador de origem fica destacado, a prévia acompanha o ponteiro e o time sob o ponteiro é realçado.
- **A movimentação não executa um novo sorteio.** Não nasce um `Draw` novo e os scores gravados continuam sendo os da execução original (eles descrevem *aquele* sorteio). O que muda é só o time do jogador. Para recalcular, o caminho continua sendo "Sortear novamente".
- O jogador leva consigo nome, apelido, id, nível, posição e tipo (mensalista/convidado) — o snapshot não é recriado. A posição dele **dentro do campo** é recalculada a partir da composição nova, então ele entra na linha da posição dele sem sobrepor ninguém.
- Tudo o que descreve os times acompanha a mudança na hora: a escalação em texto, o campo em SVG, os **indicadores de equilíbrio** de cada time (👥 jogadores, ⭐ nível total, ⭐ média) e o texto pronto para o WhatsApp. Se o ajuste manual **desequilibrar** os times, é isso que os indicadores vão mostrar — o sistema não desfaz a decisão do organizador.
- **Observações das alterações**: abaixo do campo aparece um bloco listando cada movimentação manual ("João foi movido manualmente do Time 1 🔵 para o Time 2 🔴."). Ele só existe quando há alteração manual, e é reiniciado quando um novo sorteio é realizado. Nada é revertido automaticamente, mas o bloco **diz com números** quando o ajuste piorou os times:
  - **Equilíbrio**: compara as estrelas de cada time com as que o **algoritmo entregou** (congeladas na primeira alteração manual, não um ideal abstrato — senão a tela acusaria o sorteio por um desequilíbrio criado no arrasto). Ex.: "o sorteio entregou 19 / 18 / 18 (diferença de 1) e agora está 22 / 15 / 18 (diferença de 7)". O aviso some sozinho se uma alteração seguinte devolver o equilíbrio.
  - **Separação dos piores** (seção 6.2): avisa se dois dos piores acabaram no mesmo time.
- **Auditoria**: cada movimentação gera um registro `player_moved` na trilha existente, com jogador, times de origem e destino, usuário, data/hora, IP/user-agent e o motivo. O `before`/`after` guarda **time, posição, linha e vaga** — antes registrava só o time, e a posição era metade do que mudava. As demais operações têm ação própria (ver §6.7 e §9). Não há estrutura de auditoria paralela.
- Se o servidor recusar a movimentação (ex.: sorteio histórico, permissão insuficiente), a tela volta exatamente ao estado anterior e a observação correspondente é retirada.

### 6.5 Snapshot
- Cada `TeamPlayer` grava uma **foto** do jogador no momento do sorteio: posição usada (principal ou secundária) e nível de estrelas. Se o jogador for editado ou até apagado depois, o histórico daquele sorteio continua mostrando os dados de quando ele foi sorteado.
- Desde a formação, o snapshot guarda também a **vaga no desenho** (`line_index`, `slot_index`). Nulos significam "sorteio sem formação" — e é assim que os sorteios anteriores a esta funcionalidade continuam sendo exibidos, sem migração de dados.

### 6.6 Formação

A **formação** é o desenho tático de um time: uma lista ordenada de tamanhos de linha, da defesa para o ataque, contando **apenas jogadores de linha**.

```
"2-2-2"    → 3 linhas de 2 → 6 jogadores de linha
"3-2-1-1"  → 4 linhas      → 7 jogadores de linha
```

- **O goleiro não entra na notação.** É a convenção do futebol brasileiro e é coerente com `goalkeepers_per_team`, que já é configuração separada da partida. Quando a partida reserva goleiro, ele ganha uma faixa própria no desenho, abaixo da primeira linha da formação.
- **A formação não é critério do sorteio.** Ela é aplicada **depois** que o algoritmo distribuiu os jogadores entre os times. O Simulated Annealing continua decidindo *quem joga com quem* pelos critérios de sempre (equilíbrio, posição, histórico de duplas, separação dos piores, convidados); a formação decide *onde cada um é desenhado* e *qual posição fica registrada no snapshot*. Transformá-la em restrição da têmpera mudaria o resultado do sorteio para todo mundo e entraria em conflito com a restrição dos piores, que é dura.
- **Sem formação, nada muda.** É o padrão: `Draw.formation` vazio, `TeamPlayer.line_index` nulo, e o campo agrupa os jogadores pelo `sort_order` da posição cadastrada — exatamente o comportamento anterior a esta funcionalidade. Sorteios antigos continuam sendo exibidos assim, sem migração de dados.

#### Catálogo de formações válidas

Gerado por `apps/draws/domain/formations.py::generate_formations` (módulo puro, sem Django) a partir da quantidade de jogadores de linha por time:

- 2 a 3 linhas; 4 linhas a partir de 7 jogadores de linha;
- no mínimo 1 e no máximo `min(4, ⌈N/2⌉)` jogadores por linha;
- ordenado da mais equilibrada para a menos. **No empate de equilíbrio vence quem tem mais linhas**: com 6 jogadores, `2-2-2` e `3-3` têm a mesma variância, mas `3-3` é um time sem meio-campo.

| Jogadores de linha | Algumas formações oferecidas |
|---|---|
| 5 | `2-1-2`, `1-2-2`, `2-2-1`, `1-3-1`, `2-3`, `3-2` |
| 6 | `2-2-2`, `3-1-2`, `2-3-1`, `3-2-1`, `1-3-2`, `3-3` |
| 7 | `2-2-2-1`, `3-2-1-1`, `2-3-1-1`, `3-1-2-1`, `2-3-2`, `3-2-2` |

Uma formação **fora do catálogo** é aceita desde que a soma feche com o elenco: não cabe ao sistema recusar um arranjo que o organizador quis e que é fisicamente possível.

#### Linhas × posições cadastradas

A formação pode ter **mais linhas do que a organização tem posições de linha**. Com ZAG/ME/AT (3 posições) e uma formação de 4 linhas, a linha `i` mapeia para a posição de índice `round(i × (P−1) / (k−1))`:

| Linha de `3-1-2-1` | Posição |
|---|---|
| 1ª (3 jogadores) | ZAG |
| 2ª (1 jogador) | ME |
| 3ª (2 jogadores) | ME |
| 4ª (1 jogador) | AT |

Duas linhas podem compartilhar a mesma posição — é o comportamento desejado. O campo continua desenhando **quatro** faixas porque `line_index` é gravado separado de `position_snapshot`. Nada no algoritmo assume GOL/ZAG/ME/AT: uma organização que cadastre outras posições é atendida pela mesma regra.

#### Encaixe dos jogadores nas vagas

Cada jogador do time recebe a vaga que minimiza o custo de estar fora de posição: `0` na posição principal, `1` na secundária, `2 + distância entre as faixas` fora delas. A busca é gulosa (o jogador mais restrito escolhe primeiro) com uma passada de melhoria por troca de pares — suficiente para os ~12 jogadores de um time de pelada.

#### Quatro conflitos e como são resolvidos

1. **Formação × distribuição por posição** — o time pode receber 4 zagueiros e a formação pedir 2. Os excedentes são desenhados fora da posição natural, e a tela **sinaliza** quantos ficaram assim. O sorteio não é refeito.
2. **Formação × times de tamanhos diferentes** (regra §6.3) — o jogador excedente fica **sem vaga fixa** no desenho e a formação é exibida como `2-2-2 (+1)`. Ninguém é descartado.
3. **Formação × goleiro** — a faixa de goleiro aparece quando a partida reserva goleiro **ou** quando há jogador na posição GOL no time. Nunca entra na notação.
4. **Formação × movimentação manual** — mover alguém para um time cheio ocupa a primeira vaga livre; sem vaga livre, o jogador entra sem posição fixa e o bloco de observações avisa que a formação foi quebrada. Recusar o movimento seria pior: o organizador tem motivos que o sistema não conhece.

### 6.7 Edição manual do resultado — as três operações

Além de **mover** um jogador entre times (que já existia), o organizador pode:

| Operação | O que faz | Endpoint |
|---|---|---|
| **Mover** | Troca o time de um jogador. Ocupa a primeira vaga livre da formação de destino. | `POST /api/draws/{id}/move-player/` |
| **Alterar posição** | Muda a posição (e/ou a vaga no desenho) **dentro do mesmo time**. Quem estava na vaga perde a vaga, mas **não sai do time**. | `POST /api/draws/{id}/set-position/` |
| **Trocar dois jogadores** | Os dois trocam time, posição e vaga, em **uma transação**. Preserva o tamanho dos times — que é o que "mover" não faz. | `POST /api/draws/{id}/swap-players/` |
| **Trocar a formação de um time** | Reencaixa quem já está no time noutro desenho. Não move ninguém entre times. | `POST /api/draws/{id}/set-formation/` |

- Nenhuma delas roda o algoritmo de novo: não nasce um `Draw` novo e os scores gravados continuam sendo os da execução original.
- **Só o sorteio vigente aceita edição** — versões históricas são somente leitura, e a trava está na API, não só na interface.
- A troca é **um** endpoint de propósito. Como duas chamadas de "mover", uma falha no meio deixaria os times inconsistentes (um jogador movido, o outro não) e a auditoria registraria meia operação.
- Visualizador não edita nada disso.

## 7. Times, placar e conclusão da partida

- Cada `Draw` gera N `Team`s (N = `teams_count` da partida), nomeados internamente como "Time A", "Time B" etc. — a numeração exibida ao usuário ("Time 1", "Time 2"...) e o emoji de identificação (🔵 🔴 🟠 🟢 🟣 🟡 ⚫ ⚪ 🟤, ciclando se houver mais times que emojis) são calculados apenas na exibição (tela e mensagem de compartilhamento), na mesma ordem em que os times foram gerados pelo algoritmo.
- Depois do jogo, o organizador lança o **placar em gols** de cada time (tela "⚽ Lançar Placar": um campo de gols por time, separados por ⚔️). Vitória / empate / derrota **são derivados dos gols pelo servidor**, não digitados nem calculados no cliente: quem fez mais gols vence; havendo empate no topo, todos os líderes ficam como empate e os demais como derrota. `goals_conceded` é o maior placar entre os adversários — com 2 times (o caso normal) isso é exatamente o gol do outro time.
- A API aceita apenas `{team_id, goals_scored}`. Exige o placar de **todos** os times do sorteio vigente e recusa times que não pertencem a ele — não existe mais o caminho em que a partida era marcada como concluída sem resultado válido.
- Lançar o placar marca a partida como `Concluída` e é o que alimenta as estatísticas de vitórias/derrotas/sequências.
- Sem lançar o placar, a partida fica com status `Sorteada` indefinidamente (não há prazo automático).

## 8. Estatísticas por jogador

Calculadas sob demanda (não persistidas), por organização, considerando apenas sorteios **vigentes** (`is_current=True`):

- Vitórias, derrotas, empates e **aproveitamento = vitórias ÷ partidas com placar lançado, empates incluídos** (decisão de produto confirmada).
- Maior sequência de vitórias e maior sequência de derrotas já registrada (sequências são zeradas por um empate).
- Sequência atual (ativa) e seu tipo (vitória ou derrota), se a última partida decidida não terminou em empate.
- Presenças e ausências: contagem de confirmações `confirmed` vs `declined` em toda a história (não é limitado à janela de sorteios vigentes).
- Média de estrelas dos times em que o jogador participou.
- Data da última partida e quantos dias se passaram desde então.

## 9. Auditoria (`AuditLog`)

- Log **append-only**: a API só permite listar/consultar, nunca editar ou apagar um registro.
- Eventos capturados hoje:
  - **Sorteio e presença**: sorteio realizado (`draw_created` — o payload traz `trigger: manual|automatic` e a `formation` escolhida), jogador movido entre times (`player_moved`), **posição do jogador alterada** (`player_position_changed`), **jogadores trocados entre si** (`players_swapped`, um registro só para a troca inteira), **formação do time alterada** (`formation_changed`), confirmação de presença alterada (`confirmation_changed`), entrada na lista de espera (`waitlist_added`) e promoção da lista de espera (`waitlist_promoted`) — incluindo as confirmações geradas pelo reconhecimento em lote de nomes, já que usam o mesmo caminho de código.
  - **Partida e organização**: `match_created`, `match_updated`, `match_canceled`, `organization_created`, `organization_updated`, `membership_changed`.
  - **Financeiro** (ver seção 14): `charge_created`, `charge_updated`, `charge_canceled`, `charges_generated`, `payment_registered`, `payment_canceled`, `fee_changed`, `fee_bulk_changed`, `expense_created`, `expense_canceled`, `expenses_generated`.
- Cada registro guarda organização, partida/sorteio relacionados (quando aplicável), usuário que executou a ação, estado antes/depois em JSON, motivo (quando informado) e, quando disponível, IP e user-agent da requisição (capturados via middleware, sem precisar passar `request` manualmente pelos serviços).
- **Alvo genérico (`entity` + `entity_id`)**: `match`, `draw`, `player` e os times têm FK própria porque a trilha os exibe por nome e filtra por eles. O que não tem FK é apontado pelo par `entity`/`entity_id` (`charge`, `payment`, `player_monthly_fee`, `expense`). É o que permite o financeiro crescer em entidades sem acrescentar uma coluna nula por módulo no `AuditLog` — e é a partir desse par que a linha do tempo de uma competência é reconstruída.

## 10. Tela de resultado e compartilhamento

### 10.1 Tela de resultado

- Cada time aparece em um **card próprio**, com faixa colorida de identidade (a mesma cor do emoji do time), cabeçalho "🏆 TIME N {emoji}", total de estrelas, chip de resultado quando o placar já foi lançado, os **indicadores de equilíbrio** (👥 jogadores · ⭐ nível total · ⭐ média), a **escalação em lista** (👤 nome · posição · estrelas) e, abaixo, o campo de futebol em SVG — que continua sendo a área de arrastar e soltar e a origem da exportação SVG/PNG.
- Os indicadores são calculados a partir da composição **atual** do time, não de um campo pronto do servidor: é o que faz uma movimentação manual (seção 6.4) aparecer neles imediatamente.
- Os jogadores são desenhados **dentro do SVG**, e não sobrepostos a ele em HTML. É o que faz a exportação funcionar: o SVG, o PNG e as imagens do compartilhamento nativo saem com a escalação, não com um campo vazio.
- **Convidados são destacados em vermelho** na escalação, no campo em SVG (marcador vermelho), na exportação, na impressão e na mensagem do WhatsApp (sufixo `_(convidado)_`).
- O gramado respeita o tema claro/escuro e o campo mantém a proporção (sem esticar) em telas largas.
- Só o **sorteio vigente** pode ser editado. Versões históricas são somente leitura — a trava vale também na API, não só na interface.
- Entre os cards aparece o separador "⚽ VS ⚽". Em telas estreitas os cards empilham; em telas largas ficam lado a lado.
- **Ao sortear**, o sistema mostra uma animação de embaralhamento com os nomes dos confirmados (mínimo de ~1,4s, para a animação não passar como um flash) e, ao final, rola a página automaticamente até o resultado.

### 10.2 Mensagem para o WhatsApp

- Ao final da tela de resultado há a seção "📲 Resultado para WhatsApp" com o texto pronto, regerado automaticamente a cada novo sorteio, troca de jogador entre times ou placar lançado.
- Formato:

```
⚽🔥 SORTEIO DOS TIMES 🔥⚽

🏆 Time 1 🔵:
👤 Fulano
👤 Beltrano

🆚

🏆 Time 2 🔴:
👤 Ciclano

⚽ Boa partida! 🔥

Placar:
🏆 Time 1 🔵 2 x 1 Time 2 🔴 🏆
```

- O bloco "Placar" só aparece depois que o resultado é lançado. Com 3 ou mais times (onde não existe um placar único), ele vira uma linha por time com o resultado e os gols.
- Os jogadores saem na mesma ordem em que o algoritmo os atribuiu ao time — sem reordenar por estrelas ou alfabeticamente. Nome de exibição = apelido, se tiver; senão o nome completo.
- "📋 Copiar para WhatsApp" copia o texto inteiro. Se o navegador recusar a cópia programática, o texto é **selecionado na tela** e a mensagem orienta o Ctrl+C / toque longo.
- "📤 Enviar no WhatsApp" abre o compartilhamento nativo (com as imagens dos campos, quando o dispositivo suporta) ou o `wa.me` como alternativa.
- Também é possível exportar cada time como SVG ou PNG e imprimir a página do resultado.

## 11. Multi-tenancy e escopo dos dados — resumo técnico

- Toda tabela "de negócio" tem uma FK obrigatória para `Organization`. Nenhuma view de listagem/detalhe aceita ID de outra organização, mesmo que o usuário tente forçar na URL — a permissão de nível de view já filtra pela organização resolvida do token/; cabeçalho.

## 12. Exclusão de dados (soft-delete)

- Praticamente todo modelo de negócio (jogadores, partidas, jogos recorrentes, confirmações etc.) usa exclusão lógica: "apagar" só marca `is_deleted=True` e `deleted_at`, e o registro some das listagens padrão, mas nunca é removido fisicamente por uma ação de usuário comum.
- Exceção: o log de auditoria não tem exclusão alguma (nem lógica) — é estritamente histórico.
- A remoção física (`hard_delete`) existe no código mas não é exposta por nenhuma rota da API; é só um recurso interno/administrativo.

## 13. O que ainda não existe (não confundir com regra de negócio ativa)

Itens do documento de requisitos original que **ainda não estão implementados** e não devem ser assumidos como comportamento atual:

- Pesos do algoritmo configuráveis pela organização (hoje são fixos no código).
- Múltiplas estratégias de sorteio plugáveis (só existe Simulated Annealing).
- Integração com WhatsApp além do link `wa.me` de compartilhamento manual.
- Cobrança automática por gateway (Pix/cartão): o financeiro existe (seção 14), mas a baixa é **manual**. O desenho já comporta um gateway — ele criaria um `Payment` por webhook sem tocar em `Charge` nem no painel.
- App mobile (Expo).

---

## 14. Financeiro

O módulo financeiro cobre **mensalidades** (o que entra) e **despesas** (o que sai), sempre por organização.

### 14.0 Os quatro princípios

Toda decisão de modelagem daqui sai de quatro regras. Elas se aplicam à receita e à despesa:

1. **Competência ≠ data de pagamento.** A competência (`reference`, formato `AAAA-MM`) diz a que mês o lançamento **pertence**; a data de pagamento diz quando o dinheiro se moveu. A mensalidade de abril paga em 15/05 continua sendo de abril, e o painel de maio não a conta. Nunca se deduz competência de `paid_at`.
2. **Valor histórico é imutável.** O valor vai **congelado** para a competência no momento em que ela é gerada. Alterar a mensalidade de um jogador (ou o valor de um custo fixo) não reescreve nenhum mês anterior.
3. **Nada é destruído.** Não existe `DELETE` de pagamento nem de cobrança nem de despesa. Cancelar muda o **estado** do registro e grava quem cancelou, quando e por quê — com motivo obrigatório.
4. **Toda operação relevante audita**, com `entity`/`entity_id` apontando para o registro afetado (seção 9). É dessa trilha que a linha do tempo é reconstruída.

### 14.1 Entidades

| Tabela | Papel |
|---|---|
| `finance_membershipfeeplan` | Contrato padrão da organização: valor base, periodicidade, dia de vencimento |
| `finance_playermonthlyfee` | **Valor da mensalidade de um jogador a partir de uma competência.** É configuração *e* histórico ao mesmo tempo |
| `finance_charge` | Uma mensalidade concreta: jogador, competência, valor **congelado**, vencimento, status |
| `finance_payment` | Um recebimento lançado contra uma cobrança (vários por cobrança = pagamento parcial) |
| `finance_recurringexpense` | Cadastro de um **custo fixo mensal** (quadra, arbitragem) — o contrato do gasto |
| `finance_expense` | Uma despesa concreta de uma competência, `kind` = `fixed` ou `extra`, valor congelado |

Duas simetrias propositais: `MembershipFeePlan` → `Charge` está para a receita assim como `RecurringExpense` → `Expense` está para a despesa; e `Payment` está para `Charge` assim como o cancelamento está para ambos.

### 14.2 Valor da mensalidade e alteração não retroativa

- O valor vigente de um jogador numa competência é a **última vigência que já começou** (`effective_from <= reference`). Sem vigência própria, vale o valor do plano da organização — ninguém fica sem valor.
- **Alterar nunca é um `UPDATE` no valor anterior**: é uma linha nova de `PlayerMonthlyFee` com outra `effective_from`. Exemplo do produto:

  ```
  João: 100,00 desde sempre (plano) → alteração para 120,00 a partir de Mai/2026
  Jan..Abr = 100,00 (intactas)   Mai em diante = 120,00
  ```

- Corrigir a **mesma** competência duas vezes substitui a vigência (é correção, não histórico novo) — e o valor antigo fica registrado no `before` da auditoria.
- Só mensalista ativo e não temporário tem mensalidade. Convidado — e o convidado temporário da lista colada — não entram.
- O **histórico de valores** de cada jogador é consultável, o que responde "qual era o valor vigente em determinado período".

### 14.2.1 Aplicar o novo valor às mensalidades em aberto

A não-retroatividade tinha um efeito colateral: a competência **já lançada** ficava presa no valor antigo sem nenhum caminho para corrigi-la em lote. O organizador alterava para R$ 90,00, a aba **Mensalistas** passava a mostrar R$ 90,00, a aba **Mensalidades** continuava em R$ 45,00, e a conclusão natural era que o sistema não tinha gravado.

Agora a alteração oferece, **como caixa desmarcada por padrão**, aplicar o valor às mensalidades daquela competência que ninguém pagou ainda: *"Aplicar também às 19 mensalidade(s) em aberto de Ago/2026"*.

Isto **não** é exceção à imutabilidade do histórico. É corrigir antes de cobrar. O que fica de fora, sempre, com o motivo dito na tela:

| Situação da mensalidade | Atualiza? | Por quê |
|---|---|---|
| Pendente, sem nenhuma baixa | ✅ | Ninguém pagou — não há passado para reescrever |
| **Paga** | ❌ | O dinheiro entrou; mudar o valor falsifica a prestação de contas |
| Com **baixa parcial** ativa | ❌ | Reescreveria o saldo de uma baixa que já existe |
| **Cancelada** | ❌ | Está fora do fluxo |
| Já com o valor certo | — | Nem alterada nem pulada: rodar de novo não faz nada |

Uma baixa **estornada** devolve a mensalidade ao estado "ninguém pagou", e ela volta a poder ser atualizada — o critério é o dinheiro ativo, não o histórico de tentativas.

A operação nunca atravessa competências (alterar agosto não mexe em julho) nem organizações. A auditoria registra um `charges_resynced` de lote — com os valores de origem, quantas mudaram e quantas ficaram de fora — **e** um `charge_updated` por mensalidade. O lote é resumo, não substituto.

O padrão do campo "aplicar a partir da competência" é o **mês corrente**, não o seguinte. Com "mês que vem" a alteração era invisível na tela (que mostra o mês atual) e o próprio aviso de "já lançadas" nunca disparava, porque o mês seguinte nunca tem mensalidade lançada. Agendar um reajuste futuro continua possível — é só escolher a competência.

### 14.3 Alteração em massa

- Altera vários (ou **todos**) os mensalistas de uma vez, a partir de uma competência. `players` vazio significa "todos os mensalistas ativos", e a lista é resolvida **no servidor** — a operação não depende de o navegador ter carregado a página inteira.
- Toda a operação compartilha um **`batch` (UUID)**: é o identificador que responde depois "o que aquela alteração de 87 mensalistas fez, exatamente". Cada jogador ainda gera seu próprio `fee_changed`; o registro do lote (`fee_bulk_changed`) é um resumo, não um substituto.
- A tela exige **confirmação explícita**, alimentada por uma prévia do servidor que não altera nada: quantidade de mensalistas, valores atuais, novo valor, competência inicial, o aviso de que as competências anteriores não mudam e **quantas competências dessa referência já estão lançadas** (que continuam com o valor antigo).

### 14.4 Status da mensalidade

`pending` · `paid` · `canceled` gravados, e **`overdue` derivado** (vencimento passou e não está paga) — nunca gravado, pelo mesmo motivo que vitória/derrota é derivada dos gols: um estado que envelhece sozinho exigiria uma rotina para virar e ficaria errado entre execuções. A tela lê `effective_status`, nunca `status`.

### 14.4.1 Multa por atraso

A organização configura, no plano, uma **multa fixa** por atraso (`late_fee_amount`). Zero — o padrão — desativa a cobrança. Percentual e juros por dia não existem: a regra é a que a pelada combina, "passou do dia 8, são mais R$ 10".

```
Valor: R$ 100,00 · Vencimento: dia 08 · Multa: R$ 10,00

pago dia 08 → R$ 100,00      (no dia ainda não atrasou)
pago dia 09 → R$ 110,00
pago dia 15 → R$ 110,00      (não acumula por dia)
```

Três regras sustentam isso:

1. **A multa é congelada na competência**, como o valor e o vencimento. Reajustar a multa do plano em setembro não cria dívida retroativa em agosto.
2. **A multa nunca é gravada como estado.** É derivada de vencimento + datas de pagamento, exatamente como `overdue`. Não existe "multa já cobrada" para sair de sincronia — **aplicar duas vezes é impossível por construção**, não por cuidado.
3. **Quem decide é a data do pagamento, não a de hoje.** Alguém que pagou no dia 08 e teve a baixa lançada no dia 12 pagou em dia. A multa pune o atraso de quem paga, não a demora de quem registra.

Numa cobrança **sem baixa**, a referência é hoje: é o que a pessoa pagaria agora. Com baixa lançada, é o **último** recebimento ativo — quem pagou metade em dia e a outra metade com uma semana de atraso atrasou. Estornar a baixa devolve a cobrança à previsão de hoje.

A cobrança só vira `paid` quando o recebido alcança **valor + multa devida**. Com multa zero, o comportamento é idêntico ao que sempre foi.

A tela mostra os dois números **separados** — "R$ 100,00 + R$ 10,00 de multa" — nunca um R$ 110,00 sem explicação. No lançamento da baixa, mudar a data do pagamento recalcula o valor sugerido na hora. A trilha registra a multa aplicada (`late_fee`) e o total devido em cada baixa.

Alterar valor, vencimento ou multa do plano passa a ser auditado (`fee_plan_changed`), com antes/depois **só dos campos que mudaram** — antes disso, mudar o dia do vencimento não deixava rastro nenhum.

### 14.5 Baixa e cancelamento de baixa (estorno)

- A baixa registra valor, data do pagamento, forma, observação, **usuário responsável** e data/hora — e pode ser **parcial**: a cobrança só vira `paid` quando o acumulado alcança o valor.
- **Cancelar uma baixa não apaga o pagamento.** O `Payment` muda para `canceled` e passa a guardar `cancelled_at`, `cancelled_by` e `cancellation_reason` — **motivo obrigatório**. A cobrança volta a ficar em aberto (e volta a contar como atrasada, se for o caso), porque `paid_amount` só soma baixas ativas. Uma baixa cancelada também não conta como receita no painel.
- Fluxo típico suportado: baixa → cancelamento com motivo → nova baixa. As duas baixas continuam no histórico.
- Uma mensalidade só pode ser cancelada se **não** tiver baixa ativa — a cancelada não trava mais o cancelamento.

### 14.6 Histórico completo (linha do tempo)

Cada competência tem uma linha do tempo montada **a partir da auditoria** — não dos estados atuais, que não sabem o que foi desfeito. Ela mostra, em ordem: lançamento da mensalidade, cada baixa (usuário, valor, forma), cada cancelamento (usuário, motivo) e cada alteração administrativa. O histórico nunca é apagado.

### 14.7 Despesas: custos fixos mensais e custos extras

- **Custo fixo mensal** (`kind=fixed`): vem de um `RecurringExpense` cadastrado (quadra, arbitragem, colete, água) e é lançado por competência. A geração é **idempotente** — rodar duas vezes no mesmo mês não dobra o aluguel da quadra.
- **Custo extra** (`kind=extra`): aconteceu uma vez (bola nova, churrasco, multa). A separação existe porque comparar dois meses sem ela esconde **por que** um custou mais que o outro.
- Reajustar um custo fixo **não** reescreve as despesas já geradas: o valor fica congelado na competência, exatamente como do lado da receita.
- Desativar um custo fixo (em vez de excluir) preserva as despesas já geradas, que continuam apontando para o cadastro que as originou.
- Cancelar uma despesa segue a mesma regra do estorno: não apaga, exige motivo, e a despesa cancelada deixa de contar no custo mas continua no histórico.
- O painel mostra, por competência: **receita arrecadada**, **em aberto**, **despesas** (separadas em fixo e extra) e **saldo** (arrecadado − despesas). O saldo usa o arrecadado, não o previsto: caixa é dinheiro que existe, não promessa. Saldo negativo aparece em vermelho.

### 14.8 Permissões (RBAC/ACL)

As operações financeiras têm **nomes** e cada papel possui um conjunto delas (`apps/finance/permissions.py`). Não é um segundo sistema de autorização: é o RBAC existente com as operações declaradas em uma tabela, em vez de espalhadas pelas views.

| Capacidade | Admin | Gerente | Visualizador | Jogador |
|---|:--:|:--:|:--:|:--:|
| `financial.view` | ✅ | ✅ | ❌ | ❌ |
| `financial.manage` (lançar, gerar, cancelar cobrança/despesa) | ✅ | ✅ | ❌ | ❌ |
| `financial.edit_fee` (alterar valor, individual ou em massa) | ✅ | ✅ | ❌ | ❌ |
| `financial.register_payment` | ✅ | ✅ | ❌ | ❌ |
| `financial.cancel_payment` | ✅ | ✅ | ❌ | ❌ |
| `financial.view_audit` (linha do tempo) | ✅ | ✅ | ❌ | ❌ |

- O **Visualizador não enxerga o dinheiro** da organização: ele vê a operação da pelada (jogadores, partidas, sorteios).
- O **Jogador** não tem capacidade nenhuma: o que ele acessa é o auto-serviço `/api/finance/charges/mine/`, filtrado pelo próprio login. Sem vínculo `Player.user`, a lista vem **vazia** — nunca "todas".
- O **Super Administrador** entra com um vínculo sintético de papel `admin` e cai na mesma tabela; não existe caminho paralelo de autorização para ele.
- A interface **pergunta ao servidor** o que pode fazer (`GET /api/finance/capabilities/`) em vez de deduzir do papel — a regra existe em um lugar só.

### 14.9 Isolamento entre organizações

Toda consulta, alteração e operação financeira filtra por `request.organization`. Um gerente da Organização A não lista, não altera valor, não dá baixa e não estorna nada da Organização B — a tentativa devolve 404 (registro fora do escopo) ou 400 (referência a jogador de outra organização). A mesma pessoa em duas organizações tem financeiros independentes, porque a ficha (`Player`) é por organização.

### 14.10 Operações destrutivas proibidas

- `DELETE /api/finance/charges/{id}/` e `DELETE /api/finance/expenses/{id}/` são **recusados** (400) com a orientação de cancelar.
- O `PATCH` de cobrança passa pelo serviço, que valida e audita — não existe reescrita silenciosa de linha. Alterar o **valor** de uma cobrança com baixa ativa é recusado: o caminho é cancelar a baixa (que deixa rastro) e relançar.
- Alterar o valor da mensalidade nunca emite `UPDATE ... SET valor = X` sobre competências passadas.

### 14.11 Geração e automação

- `generate_recurring_charges` lança a mensalidade da competência para cada mensalista ativo, usando o **valor vigente daquele jogador** (com o plano como padrão). Idempotente e disponível como task do Celery Beat e como botão na tela.
- `generate_fixed_expenses` faz o mesmo do lado da despesa para os custos fixos ativos.

### 14.12 Operações em massa da tela de mensalidades

Três ações agem sobre a seleção da aba **Mensalidades**: gerar a mensalidade da competência, alterar o vencimento e dar baixa. As três seguem a mesma regra de convivência, e ela é o que impede a operação de virar um "deu erro" sem dono:

- **Cada registro por si.** Um jogador que não pode receber a ação é **pulado com motivo** e não derruba os demais. A resposta é sempre um resumo — processados, pulados (com o porquê de cada um) e total —, e a tela mostra os motivos em vez de um número solto. O oposto (abortar tudo no primeiro problema) faria uma seleção de 40 mensalistas depender do cadastro mais bagunçado da lista.
- **Sem recorte significa "todos", resolvido no servidor.** A lista nunca vem do navegador quando a ação é "para todos" — o cliente mandaria uma foto possivelmente velha da tela.
- **A auditoria é dupla**: um registro de lote (resumo) **e** um por registro afetado. O lote é resumo, nunca substituto — a mesma regra de §14.3.
- **Repetir a operação não duplica nada.** Rodar duas vezes a geração cobra uma vez só; repetir a baixa não gera pagamento novo.

Duas particularidades por ação:

- **Vencimento** (`bulk_change_due_date`) recebe **cobranças**, não jogadores — é o que a tela seleciona, e é o que permite uma seleção atravessar competências. O pedido é "dia 10", mas `due_date` é uma data: o dia é resolvido contra a competência **de cada cobrança** (dia 31 escorrega para o último dia de fevereiro). Cobrança paga e cancelada ficam de fora; com baixa parcial é alterada, porque mudar o prazo não mexe no dinheiro já recebido. **Adiar o vencimento de uma cobrança atrasada faz a multa deixar de incidir** — efeito intencional (§14.4.1), marcado no resultado para a tela avisar.
- **Baixa em massa** (`bulk_register_payments`) cobra de cada um o **próprio** saldo, multa inclusa, e completa o que falta em quem tinha baixa parcial — não é um valor único aplicado a todos.

---

## 15. Acesso ao sistema (login gerado, primeiro acesso e reset)

O organizador cadastra as fichas; o sistema transforma a ficha em acesso. Esta seção é sobre esse caminho — quem pode receber login, o que é criado, e o que a pessoa consegue fazer antes de escolher a própria senha.

### 15.1 Gerar login é uma operação de três passos

Criar um `User` não é gerar um acesso. São três coisas, e faltar qualquer uma entrega uma conta que não faz nada:

1. **`User`** — identidade global. `username` = **dígitos do telefone** da ficha (é o que a pessoa já sabe de cor). `email` fica **`NULL`**, nunca string vazia — vazio colidiria no índice único a partir do segundo login gerado.
2. **`Membership`** com papel `jogador` **nesta** organização — sem ela a pessoa autentica e não enxerga nada.
3. **`Player.user`** — o vínculo que faz a confirmação de presença funcionar. Sem ele a pessoa vê a pelada e não consegue confirmar.

A operação é **atômica por jogador**: ou os três passos, ou nenhum. E **nunca cria ficha**: gerar login age sobre quem já está cadastrado, jamais inventa um `Player`.

O escopo é o mesmo do financeiro — **mensalista ativo e não temporário**, pela mesma função `mensalistas_of`. Convidado não recebe login. Repetir o critério em outro lugar abriria espaço para as duas listas divergirem.

### 15.2 Nunca duplicar usuário

Três situações **bloqueiam** a ficha, e a tela mostra cada uma com o motivo em vez de omitir a linha:

| Situação | Motivo exibido |
|---|---|
| A ficha já tem login | `já possui login` |
| A ficha não tem telefone | `sem telefone cadastrado` |
| Duas fichas com o mesmo telefone | `telefone repetido com outra ficha` — **as duas** ficam bloqueadas |

O telefone repetido bloqueia os dois lados porque não há como saber de quem é a conta. Escolher um entregaria o acesso à pessoa errada, e um sufixo automático (`11928241409-2`) criaria um login que ninguém adivinha e cujo dono nem saberia existir.

Quando já existe um `User` com aquele `username`, ele é **reaproveitado** — é a mesma pessoa jogando em outra pelada, e ela deve ter um login só. Mas se aquele login já pertence a outra ficha **da mesma organização**, a operação recusa.

### 15.3 Senha temporária e primeiro acesso

- Todo login nasce com a **mesma senha inicial**, uma constante conhecida dos dois lados (`SENHA_TEMPORARIA_PADRAO`). Ela **não trafega**: o servidor nunca devolve senha em resposta nenhuma, e a tela a exibe porque a conhece, não porque a recebeu.
- Uma senha igual para todos abre uma janela em que quem souber o telefone de alguém entra na conta dessa pessoa antes dela. Quem fecha a janela é **`must_change_password`**: enquanto a marca existir, a conta **autentica mas não usa** o sistema. A troca obrigatória não é um extra — é a outra metade do mecanismo.
- O bloqueio é um **middleware** (`MustChangePasswordMiddleware`), não uma permissão do DRF. Uma view que declara `permission_classes` substitui a lista inteira, e o projeto declara em 26 lugares: como permissão, a regra valeria quase em lugar nenhum. O middleware roda antes da view independentemente do que ela declare.
- Ficam **de fora** do bloqueio quatro rotas, cada uma por um motivo: `token/` (é preciso autenticar para poder trocar), `token/refresh/` (senão a sessão morre no meio da troca), `change-password/` (é a saída do estado) e `me/` (a tela precisa saber quem está trocando). Todo o resto responde **403 com `code: "must_change_password"`** — é o código que o frontend usa para redirecionar, porque comparar mensagem seria frágil.
- Na troca, a **senha atual é exigida** mesmo sendo a temporária (sem isso, um token vazado viraria troca de senha direta), a nova **não pode ser a temporária** (senão a marca seria limpa sem nada mudar), não pode ser igual à atual, e passa pelos validadores do Django. `password_changed_at` registra quando aconteceu.
- A tela de troca **não tem saída**: sem menu, sem barra inferior, sem link. As duas únicas portas são trocar a senha ou sair da conta. O bloqueio de verdade é do servidor — a tela é a porta, não a fechadura —, mas oferecer um desvio só faria a pessoa bater no 403 sem entender por quê.

### 15.4 Reset de senha pelo gestor

- Devolve o acesso de um jogador à senha temporária e remarca o primeiro acesso. A senha anterior **deixa de funcionar na hora**.
- Quem reseta **não vê** a senha atual de ninguém: ela é substituída, não revelada. Não existe rota que devolva senha.
- O escopo é a organização do `request`: um Gerente não alcança ficha de outra pelada.
- **Não alcança quem administra a organização.** Resetar a senha de um Gerente ou Admin por aqui seria um caminho lateral para tomar a conta de quem administra — a gestão de membros tem rota própria.

### 15.5 A auditoria não guarda senha

`login_generated`, `logins_bulk_generated`, `password_reset` e `password_changed` registram **que** um acesso foi criado, redefinido ou trocado — nunca **qual é**. Nem o valor, nem o hash, nem o tamanho entram no payload. A trilha responde "quem deu acesso a quem, e quando", que é a pergunta que ela existe para responder.

A troca da própria senha é da **identidade global**, não de uma pelada, e `AuditLog` exige organização: por isso quem audita é a view, que conhece o contexto da requisição.

### 15.6 Permissões

- Gerar login e resetar senha são de **Admin e Organizador**, dentro da própria organização. Visualizador e Jogador recebem 403.
- Um gerente de outra organização não alcança ficha alheia — nem para gerar, nem para resetar, nem para listar a situação de acesso.
