import { useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { CopyIcon, ExpandIcon, WhatsAppIcon } from "../../shared/icons";

interface WhatsAppShareCardProps {
  text: string;
  onCopied: () => void;
  /** Chamado quando o navegador recusa a cópia programática — o texto já foi
   * selecionado na tela, então a mensagem deve orientar o Ctrl+C. */
  onCopyFallback: () => void;
  onShare: () => void;
}

/** Bloco final da tela de resultado: a mensagem pronta para o grupo, sempre
 * regerada a partir dos times atuais (novo sorteio, troca de jogador ou placar
 * lançado já aparecem aqui), com cópia em um clique.
 *
 * ## Por que a prévia é colapsada
 *
 * O texto ficava num campo de 6 a 20 linhas **acima** dos botões. Num celular,
 * isso empurrava "Copiar para WhatsApp" — a ação mais usada do produto, o
 * motivo pelo qual o organizador abriu a tela — para fora da tela. Agora os
 * botões vêm primeiro e a prévia é opcional. */
export function WhatsAppShareCard({ text, onCopied, onCopyFallback, onShare }: WhatsAppShareCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onCopied();
      return;
    } catch {
      // Alguns navegadores (ou contextos sem permissão de clipboard) recusam a
      // escrita programática. Em vez de só avisar do erro, deixamos o texto
      // selecionado na tela para o usuário concluir com Ctrl+C / toque longo.
    }

    // O fallback depende de o campo estar montado — se a prévia estiver
    // fechada, abre antes de selecionar.
    setShowPreview(true);
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, text.length);
      }
      onCopyFallback();
    }, 0);
  };

  const firstLines = text.split("\n").slice(0, 4).join("\n");

  return (
    <Card className="no-print" sx={{ mt: 3 }}>
      <CardContent>
        <Typography variant="h3" component="h2" sx={{ mb: 1 }}>
          📲 Resultado para WhatsApp
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Texto gerado automaticamente a partir dos times atuais. Ele se atualiza a cada novo sorteio,
          troca de jogador ou placar lançado.
        </Typography>

        {/* Ações primeiro: no celular, o que importa é copiar. */}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button variant="contained" size="large" startIcon={<CopyIcon />} onClick={handleCopy} fullWidth>
            Copiar para WhatsApp
          </Button>
          <Button variant="outlined" size="large" startIcon={<WhatsAppIcon />} onClick={onShare} fullWidth>
            Enviar no WhatsApp
          </Button>
        </Stack>

        <Box
          component="button"
          type="button"
          onClick={() => setShowPreview((current) => !current)}
          aria-expanded={showPreview}
          sx={{
            mt: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            border: 0,
            background: "none",
            px: 0.5,
            // Alvo mínimo de toque, como nos `Button` do tema — um "botão de
            // texto" montado à mão não herda o override.
            minHeight: 44,
            color: "primary.main",
            font: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showPreview ? "Ocultar mensagem" : "Ver a mensagem"}
          <ExpandIcon
            fontSize="small"
            sx={{ transform: showPreview ? "rotate(180deg)" : "none", transition: "transform 150ms" }}
          />
        </Box>

        {!showPreview && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.5, whiteSpace: "pre-line", opacity: 0.75 }}
          >
            {firstLines}…
          </Typography>
        )}

        {/* `unmountOnExit`: sem ele o campo continua no DOM (só escondido) e
            um leitor de tela ainda o encontra — anunciando um bloco enorme de
            texto que a pessoa escolheu não ver. */}
        <Collapse in={showPreview} unmountOnExit>
          <TextField
            multiline
            fullWidth
            minRows={6}
            maxRows={20}
            value={text}
            inputRef={textareaRef}
            sx={{ mt: 1.5 }}
            slotProps={{
              input: { readOnly: true, sx: { fontFamily: "monospace", fontSize: 13 } },
              // O rótulo acessível vai no próprio `<textarea>`, não na raiz do
              // campo: é o elemento que o leitor de tela (e o teste) alcança.
              htmlInput: { "aria-label": "Mensagem para o WhatsApp" },
            }}
          />
        </Collapse>
      </CardContent>
    </Card>
  );
}
