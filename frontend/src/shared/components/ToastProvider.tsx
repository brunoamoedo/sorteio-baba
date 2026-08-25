import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Alert, Snackbar, useMediaQuery, useTheme } from "@mui/material";

type ToastSeverity = "success" | "error" | "info" | "warning";

interface ToastState {
  key: number;
  message: string;
  severity: ToastSeverity;
}

interface ToastContextValue {
  showToast: (message: string, severity?: ToastSeverity) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Feedback rápido de ações (ex.: "Confirmação salva") — usar em vez de só
 * invalidar a query silenciosamente. Erros de formulário continuam inline
 * (Alert dentro do form), este componente é para confirmações de ação. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast deve ser usado dentro de ToastProvider");
  }
  return context;
}

/** Tempo de leitura proporcional ao texto.
 *
 * 4s fixos eram pouco para mensagens de duas frases (várias do sistema têm) e
 * demais para "Jogador removido.". A conta é grosseira de propósito: ~13
 * caracteres por segundo de leitura, com piso de 3,5s e teto de 10s. */
function readingDuration(message: string): number {
  return Math.min(10000, Math.max(3500, Math.round((message.length / 13) * 1000)));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const showToast = useCallback((message: string, severity: ToastSeverity = "success") => {
    setToast({ key: Date.now(), message, severity });
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        key={toast?.key}
        open={!!toast}
        autoHideDuration={toast ? readingDuration(toast.message) : null}
        onClose={(_, reason) => {
          // Um toque na tela não deve descartar o aviso antes de ser lido.
          if (reason === "clickaway") return;
          setToast(null);
        }}
        // No celular o rodapé é ocupado pela navegação e pela barra de ação
        // primária — um toast ali cobriria justamente o botão que a pessoa
        // acabou de tocar.
        anchorOrigin={
          isMobile
            ? { vertical: "top", horizontal: "center" }
            : { vertical: "bottom", horizontal: "center" }
        }
        sx={{ maxWidth: { xs: "calc(100% - 24px)", sm: 560 } }}
      >
        {toast ? (
          <Alert
            onClose={() => setToast(null)}
            severity={toast.severity}
            variant="filled"
            sx={{ width: "100%" }}
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}
