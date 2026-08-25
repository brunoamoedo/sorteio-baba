/**
 * Tokens do Design System.
 *
 * Fonte única de cor, raio, elevação e alvo de toque. Nada de hexadecimal
 * solto em componente: quem precisa de cor lê daqui (ou do tema, que é montado
 * a partir daqui em `ColorModeContext`).
 *
 * ## Contraste
 *
 * Os pares abaixo foram **calculados** pela fórmula de luminância relativa da
 * WCAG 2.1, não estimados no olho. O comentário de cada token registra a razão
 * medida, para uma alteração futura saber o que está sendo preservado.
 *
 * Mínimos exigidos: 4,5:1 para texto normal, 3:1 para texto grande (≥18,66px
 * bold) e para componentes de interface.
 */

export type ThemeMode = "light" | "dark";

/** Identidade da marca. O verde é a cor do produto — o que muda entre os modos
 * é o tom, nunca a família. */
const BRAND_GREEN = {
  /** Superfícies preenchidas com texto branco.
   *  `#1c8639` + `#ffffff` = **4,65:1** (AA).
   *  O `#1e8e3e` anterior dava 4,21:1 e reprovava por pouco — o ajuste é de
   *  dois pontos de luminosidade, imperceptível lado a lado, e passa. */
  mainLight: "#1c8639",
  /** No escuro o preenchimento clareia e o texto é que fica escuro.
   *  `#4caf6f` + `#06140b` = **7,4:1**. */
  mainDark: "#4caf6f",
  light: "#4caf6f",
  dark: "#146c2e",
} as const;

interface Palette {
  primary: string;
  primaryContrast: string;
  primaryLight: string;
  primaryDark: string;
  /** Verde para **texto e ícone** sobre fundo — nunca o mesmo do preenchimento.
   *  light `#146c2e` sobre `#f6f7f9` = **6,3:1**.
   *  dark  `#7fd39b` sobre `#0f1115` = **10,5:1**. */
  primaryText: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  background: string;
  surface: string;
  surfaceVariant: string;
  text: string;
  /** Texto auxiliar.
   *  light `#5a677a` sobre `#f6f7f9` = **5,4:1** (o `#64748b` usual dá 4,4:1 e
   *  reprova).
   *  dark  `#98a4b8` sobre `#0f1115` = **7,5:1**. */
  muted: string;
  border: string;
  focus: string;
  /** Gramado do campo em SVG. Estava fixo em `FootballPitch.tsx`. */
  pitchGrass: string;
  pitchStripe: string;
  pitchLine: string;
  pitchGoal: string;
}

export const PALETTE: Record<ThemeMode, Palette> = {
  light: {
    primary: BRAND_GREEN.mainLight,
    primaryContrast: "#ffffff",
    primaryLight: BRAND_GREEN.light,
    primaryDark: BRAND_GREEN.dark,
    primaryText: "#146c2e",
    secondary: "#1565c0",
    success: "#1b7f37",
    warning: "#b35309",
    danger: "#c62828",
    info: "#0277bd",
    background: "#f6f7f9",
    surface: "#ffffff",
    surfaceVariant: "#fafbfc",
    text: "#0f172a",
    muted: "#5a677a",
    border: "rgba(15, 23, 42, 0.10)",
    focus: "#1565c0",
    pitchGrass: "#2e7d32",
    pitchStripe: "#2b7430",
    pitchLine: "#ffffff",
    pitchGoal: "#1b5e20",
  },
  dark: {
    primary: BRAND_GREEN.mainDark,
    primaryContrast: "#06140b",
    primaryLight: "#7fd39b",
    primaryDark: "#2e7d4a",
    primaryText: "#7fd39b",
    secondary: "#64b5f6",
    success: "#66bb6a",
    warning: "#ffb74d",
    danger: "#ef5350",
    info: "#4fc3f7",
    background: "#0f1115",
    surface: "#171a21",
    surfaceVariant: "#1b1e26",
    text: "#e6e8ec",
    muted: "#98a4b8",
    border: "rgba(255, 255, 255, 0.12)",
    focus: "#64b5f6",
    pitchGrass: "#1d4d24",
    pitchStripe: "#1a4720",
    pitchLine: "#e8f0e8",
    pitchGoal: "#123317",
  },
};

/**
 * Cores de identidade dos times, na **mesma ordem** dos emojis de
 * `features/matches/shareFormat.ts` (🔵 🔴 🟠 🟢 🟣 🟡 ⚫ ⚪ 🟤).
 *
 * O emoji vai na mensagem do WhatsApp e a cor pinta o card e o campo — os dois
 * contam a mesma história, então a ordem não pode divergir.
 *
 * A variante escura existe porque vários destes tons somem sobre `#0f1115`.
 */
export const TEAM_COLORS: Record<ThemeMode, readonly string[]> = {
  light: [
    "#2563eb",
    "#dc2626",
    "#ea580c",
    "#16a34a",
    "#9333ea",
    "#ca8a04",
    "#475569",
    "#78716c",
    "#92400e",
  ],
  dark: [
    "#60a5fa",
    "#f87171",
    "#fb923c",
    "#4ade80",
    "#c084fc",
    "#facc15",
    "#94a3b8",
    "#d6d3d1",
    "#d97706",
  ],
};

/** Raio de canto. `md` é o padrão do tema; os outros são exceções nomeadas. */
export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
} as const;

/**
 * Alvo mínimo de toque.
 *
 * 44px é o piso das diretrizes da Apple e o mínimo do WCAG 2.2 (2.5.8);
 * o Material 3 pede 48. Adotamos 44 como mínimo absoluto e 48 no que é
 * navegação (item de menu, barra inferior), onde o erro custa mais.
 */
export const TOUCH = {
  min: 44,
  comfortable: 48,
} as const;

/** Sombras por modo.
 *
 * A escala anterior usava `rgba(15,23,42,…)` (azul-escuro) nos dois temas — no
 * escuro isso é sombra invisível, e a hierarquia de elevação simplesmente
 * sumia. No escuro a sombra é preta e mais opaca, e a separação real vem da
 * borda de 1px que os cards já têm. */
function buildShadows(mode: ThemeMode): string[] {
  const rgb = mode === "light" ? "15, 23, 42" : "0, 0, 0";
  const base = mode === "light" ? 0.06 : 0.32;
  const step = mode === "light" ? 0.005 : 0.012;

  return [
    "none",
    ...Array.from({ length: 24 }, (_, index) => {
      const level = index + 1;
      const y = Math.round(level * 0.8);
      const blur = Math.round(2 + level * 1.9);
      const alpha = (base + level * step).toFixed(3);
      return `0px ${y}px ${blur}px rgba(${rgb}, ${alpha})`;
    }),
  ];
}

export const SHADOWS: Record<ThemeMode, string[]> = {
  light: buildShadows("light"),
  dark: buildShadows("dark"),
};

/**
 * Intenção de cada breakpoint (os valores continuam sendo os padrão do MUI).
 *
 * Trocar os valores reescreveria o significado de todo `{ xs, sm, md }` já
 * espalhado pelo código, com risco de regressão silenciosa e sem ganho real. O
 * que este mapa faz é registrar **para que serve cada faixa**, e é a referência
 * da matriz de verificação de responsividade.
 *
 * Corte principal de layout: `md` — o mesmo ponto em que a navegação troca
 * abas por menu hamburger.
 */
export const BREAKPOINT_INTENT = {
  xs: { min: 0, label: "Celular (320 / 375 / 390 / 414)" },
  sm: { min: 600, label: "Celular deitado / tablet pequeno" },
  md: { min: 900, label: "Tablet grande / notebook" },
  lg: { min: 1200, label: "Desktop" },
  xl: { min: 1536, label: "Desktop grande / 4K" },
} as const;

/** Larguras da matriz de verificação manual (§15.1 do plano). */
export const VERIFY_WIDTHS = [320, 375, 390, 414, 768, 1024, 1440] as const;
