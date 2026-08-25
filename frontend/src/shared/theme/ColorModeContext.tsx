import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ThemeProvider, createTheme, type PaletteMode, type Shadows } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

import { PALETTE, RADIUS, SHADOWS, TOUCH } from "./tokens";

interface ColorModeContextValue {
  mode: PaletteMode;
  toggleColorMode: () => void;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

export function useColorMode(): ColorModeContextValue {
  const context = useContext(ColorModeContext);
  if (!context) {
    throw new Error("useColorMode deve ser usado dentro de AppThemeProvider");
  }
  return context;
}

const STORAGE_KEY = "pelada.theme.mode";

const FONT_STACK = [
  "Inter Variable",
  "Inter",
  "-apple-system",
  "BlinkMacSystemFont",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
].join(",");

/** Preferência inicial: o que a pessoa escolheu antes; na primeira visita, o
 * que o sistema operacional dela já diz. Antes o padrão era sempre claro, e
 * quem usa o celular no escuro levava um flash branco a cada abertura. */
function resolveInitialMode(): PaletteMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Escala tipográfica fluida.
 *
 * `clamp(mínimo, preferido, máximo)` deixa o título crescer com a tela sem
 * precisar de um breakpoint por tamanho — e garante o piso no celular, que é
 * onde a tipografia quebra. Nada abaixo de 12px; corpo nunca abaixo de 14px. */
const fluid = (minPx: number, maxPx: number) =>
  `clamp(${minPx}px, ${minPx}px + ${(maxPx - minPx) / 6}vw, ${maxPx}px)`;

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PaletteMode>(resolveInitialMode);

  const colorMode = useMemo(
    () => ({
      mode,
      toggleColorMode: () => {
        setMode((prev) => {
          const next = prev === "light" ? "dark" : "light";
          localStorage.setItem(STORAGE_KEY, next);
          return next;
        });
      },
    }),
    [mode],
  );

  const theme = useMemo(() => {
    const t = PALETTE[mode];
    const shadows = SHADOWS[mode] as Shadows;

    return createTheme({
      palette: {
        mode,
        primary: {
          main: t.primary,
          light: t.primaryLight,
          dark: t.primaryDark,
          contrastText: t.primaryContrast,
        },
        secondary: { main: t.secondary },
        error: { main: t.danger },
        warning: { main: t.warning },
        success: { main: t.success },
        info: { main: t.info },
        background: { default: t.background, paper: t.surface },
        text: { primary: t.text, secondary: t.muted },
        divider: t.border,
      },
      shape: { borderRadius: RADIUS.md },
      shadows,
      typography: {
        fontFamily: FONT_STACK,
        h1: { fontSize: fluid(24, 30), fontWeight: 700, letterSpacing: -0.6, lineHeight: 1.2 },
        h2: { fontSize: fluid(20, 24), fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.25 },
        h3: { fontSize: fluid(17, 18), fontWeight: 700, letterSpacing: -0.2, lineHeight: 1.3 },
        h4: { fontSize: fluid(20, 26), fontWeight: 700, letterSpacing: -0.5 },
        h5: { fontSize: fluid(18, 22), fontWeight: 700, letterSpacing: -0.3 },
        h6: { fontSize: fluid(16, 18), fontWeight: 700, letterSpacing: -0.2 },
        subtitle1: { fontSize: fluid(15, 16), fontWeight: 600 },
        subtitle2: { fontSize: 14, fontWeight: 600 },
        body1: { fontSize: fluid(15, 16), lineHeight: 1.55 },
        body2: { fontSize: 14, lineHeight: 1.5 },
        caption: { fontSize: 12, lineHeight: 1.45 },
        overline: { fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" },
        button: { fontSize: 15, fontWeight: 600, textTransform: "none" },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            // Um anel de foco visível e consistente. O padrão do MUI some sobre
            // superfícies coloridas — o card de time e o gramado do campo.
            "*:focus-visible": {
              outline: `2px solid ${t.focus}`,
              outlineOffset: 2,
              borderRadius: 4,
            },
          },
        },
        MuiButton: {
          defaultProps: { disableElevation: true },
          styleOverrides: {
            root: ({ theme: mt }) => ({
              borderRadius: RADIUS.sm,
              paddingInline: 16,
              // Abaixo de `md` todo botão respeita o alvo mínimo de toque —
              // inclusive os `size="small"` espalhados pelas telas, que
              // tinham 30px de altura.
              [mt.breakpoints.down("md")]: { minHeight: TOUCH.min },
            }),
            sizeSmall: ({ theme: mt }) => ({
              borderRadius: RADIUS.sm,
              [mt.breakpoints.down("md")]: { minHeight: TOUCH.min, paddingInline: 14 },
            }),
          },
        },
        MuiIconButton: {
          styleOverrides: {
            root: ({ theme: mt }) => ({
              [mt.breakpoints.down("md")]: { minWidth: TOUCH.min, minHeight: TOUCH.min },
            }),
          },
        },
        // `padding: 10` acerta o alvo só no tamanho padrão, onde o ícone tem
        // 24px. Com `size="small"` o ícone cai para 20 e o alvo ia a 40px —
        // medido a 375px nas caixas da lista de acesso e das mensalidades, que
        // são justamente as que se marca em série. O piso vale para os dois
        // tamanhos; o padding continua definindo o respiro visual.
        MuiCheckbox: {
          styleOverrides: {
            root: ({ theme: mt }) => ({
              [mt.breakpoints.down("md")]: {
                padding: 10,
                minWidth: TOUCH.min,
                minHeight: TOUCH.min,
              },
            }),
          },
        },
        MuiRadio: {
          styleOverrides: {
            root: ({ theme: mt }) => ({
              [mt.breakpoints.down("md")]: {
                padding: 10,
                minWidth: TOUCH.min,
                minHeight: TOUCH.min,
              },
            }),
          },
        },
        MuiCard: {
          styleOverrides: {
            root: ({ theme: mt }) => ({
              borderRadius: RADIUS.lg,
              border: `1px solid ${mt.palette.divider}`,
              boxShadow: shadows[2],
            }),
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: { backgroundImage: "none" },
            elevation1: { boxShadow: shadows[2] },
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: { borderRadius: RADIUS.lg },
          },
        },
        MuiDrawer: {
          styleOverrides: {
            paper: { borderRadius: 0, backgroundImage: "none" },
          },
        },
        MuiTextField: {
          // O `size: "small"` global dava 40px de altura em **todos** os campos
          // do sistema — abaixo do alvo de toque de 44px. Agora o padrão é
          // `medium` (confortável no celular) e as telas densas pedem `small`
          // explicitamente onde faz sentido em telas grandes.
          defaultProps: { size: "medium" },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: ({ theme: mt }) => ({
              borderRadius: RADIUS.sm + 2,
              // Telas densas (o financeiro tem 9 filtros) continuam podendo
              // pedir `size="small"`, mas no celular nem esses podem ficar
              // abaixo do alvo de toque. `minHeight` — nunca `height` — para
              // não quebrar campo multilinha.
              [mt.breakpoints.down("md")]: { minHeight: TOUCH.min },
            }),
          },
        },
        MuiChip: {
          styleOverrides: {
            root: { borderRadius: RADIUS.sm, fontWeight: 600 },
          },
        },
        MuiTableCell: {
          styleOverrides: {
            head: ({ theme: mt }) => ({
              fontWeight: 700,
              color: mt.palette.text.secondary,
              backgroundColor: t.surfaceVariant,
              whiteSpace: "nowrap",
            }),
          },
        },
        MuiTableRow: {
          styleOverrides: {
            root: { "&:last-child td": { borderBottom: 0 } },
          },
        },
        MuiAppBar: {
          styleOverrides: {
            root: ({ theme: mt }) => ({ borderBottom: `1px solid ${mt.palette.divider}` }),
          },
        },
        MuiListItemButton: {
          styleOverrides: {
            root: { borderRadius: RADIUS.sm },
          },
        },
        MuiTooltip: {
          // Tooltip nunca carrega informação essencial (não existe hover em
          // toque). Fica como reforço para quem usa mouse — e por isso pode
          // aparecer rápido.
          defaultProps: { enterDelay: 400 },
        },
      },
    });
  }, [mode]);

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
