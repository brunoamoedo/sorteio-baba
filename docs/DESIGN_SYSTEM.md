# Design System

> Documento vivo. Se você mudar um token, um componente ou uma regra de uso, atualize aqui junto — do mesmo jeito que `REGRAS_DE_NEGOCIO.md` acompanha o código do domínio.

O sistema é **mobile first**: a tela de 375px é a tela de projeto, e o desktop é a adaptação para cima — nunca o contrário.

```
❌ sx={{ display: "flex", flexDirection: { xs: "column" } }}      // desktop-first
✅ sx={{ display: "flex", flexDirection: { xs: "column", md: "row" } }}
```

---

## 1. Onde as coisas moram

| O quê | Onde |
|---|---|
| Tokens (cor, raio, sombra, toque) | `frontend/src/shared/theme/tokens.ts` |
| Tema MUI montado a partir deles | `frontend/src/shared/theme/ColorModeContext.tsx` |
| Ícones | `frontend/src/shared/icons/index.ts` |
| Componentes compartilhados | `frontend/src/shared/components/` |
| Layout e navegação | `frontend/src/shared/layout/` |

**Nenhum hexadecimal solto em componente.** Quem precisa de cor lê do tema (`theme.palette…`) ou de `tokens.ts`.

---

## 2. Cores

Definidas em `tokens.ts::PALETTE`, com variante para claro e escuro.

| Token | Uso |
|---|---|
| `primary` | Ação principal e identidade (verde de futebol) |
| `primaryText` | Verde para **texto/ícone**, nunca o mesmo do preenchimento |
| `secondary` | Ação secundária, links |
| `success` · `warning` · `danger` · `info` | Estados |
| `background` · `surface` · `surfaceVariant` | Fundo, card, cabeçalho de tabela |
| `text` · `muted` | Texto principal e auxiliar |
| `border` · `focus` | Divisores e anel de foco |
| `pitchGrass` · `pitchStripe` · `pitchLine` · `pitchGoal` | Campo em SVG |
| `TEAM_COLORS[modo][i]` | Identidade dos times, na mesma ordem dos emojis 🔵🔴🟠… |

### Contraste — a regra que não se negocia

Os pares abaixo foram **calculados** pela fórmula da WCAG 2.1, não estimados no olho:

| Par | Razão | Exigência |
|---|---|---|
| `primary` `#1c8639` + branco (light) | **4,65:1** | ✅ AA (texto normal) |
| `primary` `#4caf6f` + `#06140b` (dark) | **7,4:1** | ✅ AAA |
| `primaryText` `#146c2e` sobre `#f6f7f9` | **6,3:1** | ✅ AA |
| `primaryText` `#7fd39b` sobre `#0f1115` | **10,5:1** | ✅ AAA |
| `muted` `#5a677a` sobre `#f6f7f9` | **5,4:1** | ✅ AA |
| `muted` `#98a4b8` sobre `#0f1115` | **7,5:1** | ✅ AAA |

> O verde anterior (`#1e8e3e`) dava **4,21:1** e reprovava por pouco em botões preenchidos. O ajuste é de dois pontos de luminosidade — imperceptível lado a lado, e passa.
>
> Mínimos: **4,5:1** texto normal · **3:1** texto ≥18,66px bold e componentes de interface.

---

## 3. Tipografia

Fonte **Inter**, auto-hospedada (`@fontsource-variable/inter`). Antes era declarada no tema mas nunca carregada — o sistema caía no fallback do SO.

Escala fluida com `clamp()`: o título cresce com a tela sem precisar de um breakpoint por tamanho.

| Papel | Variante | Mobile → Desktop | Peso |
|---|---|---|---|
| Título de página | `h1` | 24 → 30px | 700 |
| Título de seção | `h2` | 20 → 24px | 700 |
| Título de card | `h3` | 17 → 18px | 700 |
| Subtítulo | `subtitle1` | 15 → 16px | 600 |
| Corpo | `body1` | 15 → 16px | 400 |
| Corpo compacto | `body2` | 14px | 400 |
| Rótulo | `overline` | 12px | 600, maiúsculas |
| Auxiliar | `caption` | 12px | 400, cor `muted` |
| Botão | `button` | 15px | 600, sem `text-transform` |

**Nunca abaixo de 12px.** Corpo nunca abaixo de 14px.

O título de página usa `component="h1"` (via `PageHeader`) — antes nenhuma tela do sistema tinha `<h1>` e a navegação por headings ficava quebrada.

---

## 4. Espaçamento, raio e elevação

- **Espaçamento**: unidade base 8px do MUI. Escala permitida: `0.5, 1, 1.5, 2, 3, 4, 6, 8`. Sem valores mágicos em px.
- **Raio** (`RADIUS`): `sm: 8` (botão, input, chip) · `md: 12` (padrão) · `lg: 16` (card, dialog) · `full: 999` (avatar).
- **Elevação**: duas escalas, uma por modo. A do tema escuro é preta e mais opaca — a escala única anterior usava azul-escuro nos dois e a sombra simplesmente sumia no escuro.

---

## 5. Alvo de toque

`TOUCH.min = 44` · `TOUCH.comfortable = 48`

44px é o piso das diretrizes da Apple e o mínimo do WCAG 2.2 (2.5.8); 48px é o Material 3 e vale para navegação, onde o erro custa mais.

O tema aplica isso automaticamente abaixo de `md` em `Button`, `IconButton`, `OutlinedInput`, `Checkbox` e `Radio`. **Um "botão de texto" montado à mão (`Box component="button"`) não herda o override** — declare `minHeight: 44` nele.

**O override é sempre um piso (`minWidth`/`minHeight`), nunca só `padding`.** `Checkbox` e `Radio` já tiveram `padding: 10`, que acerta os 44px no tamanho padrão (ícone de 24) e entrega **40px** no `size="small"` (ícone de 20) — justamente o tamanho usado nas listas que se marcam em série. Padding depende do que ele está envolvendo; o piso não depende de nada.

---

## 6. Breakpoints

Os valores são os padrão do MUI. Alterá-los reescreveria o significado de todo `{ xs, sm, md }` já espalhado pelo código. O que existe é a **intenção documentada** (`BREAKPOINT_INTENT`):

| Alias | px | Dispositivo |
|---|---|---|
| `xs` | 0–599 | Celular (320 / 375 / 390 / 414) |
| `sm` | 600–899 | Celular deitado / tablet pequeno |
| `md` | 900–1199 | Tablet grande / notebook |
| `lg` | 1200–1535 | Desktop |
| `xl` | 1536+ | Desktop grande / 4K |

**Corte principal de layout: `md`** — é onde a navegação troca abas por menu hamburger e onde as listagens trocam tabela por card.

---

## 7. Componentes

### Compartilhados (`shared/components/`)

| Componente | Para quê |
|---|---|
| `DataTable` | Listagem. Com `renderCard`, vira lista de cards abaixo de `md` |
| `PageHeader` | Título (`h1`) + descrição + ação primária |
| `StatusChip` | Todo badge de estado. Nunca só cor — sempre com texto |
| `ConfirmDialog` | Toda ação destrutiva |
| `FormDrawer` | Formulário lateral, com cabeçalho e rodapé fixos |
| `BottomSheet` | Escolha vinda de baixo (celular) / painel lateral (desktop) |
| `FilterSheet` | Filtros em painel + chips do que está ativo |
| `OverflowMenu` | Menu ⋮ — substitui fileiras de ícones pequenos |
| `EmptyState` | Estado vazio com ícone, explicação e CTA |
| `PageSkeleton` | Carregamento de página inteira e fallback de rota |
| `AppActionBar` | Ação primária fixa no rodapé do celular |
| `PlayerAvatar` | Avatar com iniciais, cor derivada do nome e `loading="lazy"` |
| `StatTile` | Bloco de métrica |
| `SegmentedControl` | Alternância entre poucas opções (filtro) |
| `ToastProvider` | Confirmação de ação, com duração proporcional ao texto |

### Regras de uso

- **Não crie um segundo componente para a mesma finalidade.** Se falta algo, estenda o que existe.
- Estado vazio **sempre** tem próximo passo. "Nenhum registro encontrado." sozinho não ajuda ninguém.
- Erro de carregamento é distinto de lista vazia — `DataTable` já trata os dois.
- Formulário longo: ações no rodapé fixo, nunca no fim do conteúdo.

---

## 8. Ícones

Fonte única: `shared/icons/index.ts`, que reexporta de `@mui/icons-material`.

**Ação usa ícone daqui.** Emoji como ícone renderiza diferente em cada SO, é verbalizado pelo leitor de tela no meio do rótulo e nunca alinha com o texto.

### O que continua sendo emoji, de propósito

Emoji que é **conteúdo**, não decoração:

- a mensagem pronta para o WhatsApp (`features/matches/shareFormat.ts`) — ela é colada num app que não tem os nossos ícones, e o formato é regra de negócio documentada;
- a identidade dos times (🔵 🔴 🟠 🟢 🟣 🟡 ⚫ ⚪ 🟤) — o mesmo símbolo aparece na tela e na mensagem, e é assim que o jogador reconhece o time dele no grupo.

Ícone **nunca substitui o texto** no menu: os dois sempre juntos.

---

## 9. Acessibilidade

Checklist de qualquer tela nova:

- [ ] **Contraste** ≥ 4,5:1 (texto normal) ou 3:1 (texto grande / componente). Medir, não estimar.
- [ ] **Alvo de toque** ≥ 44px em `xs`.
- [ ] **Nunca só cor.** Todo estado tem texto ou forma junto (convidado: chip "Convidado" + anel tracejado no campo).
- [ ] **Nunca só hover.** Tooltip é reforço para quem usa mouse; a informação essencial fica visível. Não existe hover em toque.
- [ ] **Nunca só arrastar.** Toda operação de arrastar tem caminho equivalente por toque e por teclado.
- [ ] **Foco visível** — o tema aplica o anel; não sobrescreva com `outline: none`.
- [ ] **Hierarquia de headings**: um `<h1>` por página (via `PageHeader`), seções em `h2`/`h3`.
- [ ] **Rótulo acessível** em todo botão de ícone (`aria-label`).
- [ ] **Landmarks**: `header`, `nav`, `main` — o `AppLayout` já provê.
- [ ] `aria-live` ao mudar a quantidade de resultados de um filtro.
- [ ] `role="group"`, não `role="img"`, em SVG com filhos interativos — `img` remove os descendentes da árvore de acessibilidade.

---

## 10. Tema claro e escuro

- O modo inicial respeita `prefers-color-scheme` na primeira visita; depois vale a escolha salva.
- `<meta name="theme-color">` por modo, para a barra do navegador acompanhar.
- Toda cor nova precisa de variante nos **dois** modos — inclusive as do campo em SVG e as de identidade dos times.

---

## 11. Performance

- Rotas carregam sob demanda (`React.lazy`), com `PageSkeleton` como fallback.
- Bibliotecas separadas em pacotes por ciclo de vida (`react`, `mui`, `charts`, `dnd`): o que muda raramente fica em cache entre deploys.
- Listagens usam miniatura de avatar (`photo_thumb`), nunca a foto original.
- O service worker faz precache **apenas do shell** e **nunca** intercepta `/api/`.
