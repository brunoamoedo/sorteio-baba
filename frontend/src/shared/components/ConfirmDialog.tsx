import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  isConfirming?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Diálogo de confirmação central — toda ação destrutiva (excluir jogador,
 * jogo recorrente, partida etc.) deve usar este componente em vez de um
 * `Dialog` montado na mão em cada tela.
 *
 * No celular os botões empilham e o **destrutivo fica embaixo**, longe do
 * polegar em repouso: quem quer confirmar precisa mirar, e quem quer desistir
 * acerta o botão mais fácil. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = true,
  isConfirming = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{description}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: "column-reverse", sm: "row" }, gap: 1, px: 3, pb: 2.5 }}>
        <Button onClick={onClose} fullWidth variant="outlined" sx={{ m: { xs: 0, sm: undefined } }}>
          {cancelLabel}
        </Button>
        <Button
          color={destructive ? "error" : "primary"}
          variant="contained"
          onClick={onConfirm}
          disabled={isConfirming}
          fullWidth
          sx={{ m: { xs: 0, sm: undefined } }}
        >
          {isConfirming ? "Aguarde..." : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
