import { Chip, type ChipProps } from "@mui/material";

export type StatusTone = "success" | "warning" | "error" | "info" | "default";

interface StatusChipProps extends Omit<ChipProps, "color"> {
  tone?: StatusTone;
}

/** Chip de status central do sistema — todo badge colorido (ativo/inativo,
 * confirmado/pendente, mensalista/convidado, pago/atrasado etc.) deve usar
 * este componente em vez de `Chip color=...` espalhado pelas telas. */
export function StatusChip({ tone = "default", variant, ...props }: StatusChipProps) {
  return (
    <Chip
      size="small"
      color={tone === "default" ? undefined : tone}
      variant={variant ?? (tone === "default" ? "outlined" : "filled")}
      {...props}
    />
  );
}

export function playerStatusTone(status: "ativo" | "inativo"): StatusTone {
  return status === "ativo" ? "success" : "default";
}

export function playerTypeLabel(type: "mensalista" | "convidado"): string {
  return type === "mensalista" ? "Mensalista" : "Convidado";
}

/** Convidado é sempre destacado em vermelho — regra de negócio explícita
 * (visibilidade de quem não é mensalista em qualquer lugar do sistema). */
export function playerTypeTone(type: "mensalista" | "convidado"): StatusTone {
  return type === "convidado" ? "error" : "default";
}

export function confirmationStatusTone(status: "confirmed" | "declined" | "pending"): StatusTone {
  if (status === "confirmed") return "success";
  if (status === "declined") return "error";
  return "default";
}

export function confirmationStatusLabel(status: "confirmed" | "declined" | "pending"): string {
  if (status === "confirmed") return "Confirmado";
  if (status === "declined") return "Recusado";
  return "Pendente";
}

const MATCH_STATUS_TONES: Record<string, StatusTone> = {
  scheduled: "default",
  confirming: "info",
  drawn: "warning",
  in_progress: "warning",
  completed: "success",
  canceled: "error",
};

export function matchStatusTone(status: string): StatusTone {
  return MATCH_STATUS_TONES[status] ?? "default";
}

const AUDIT_ACTION_TONES: Record<string, StatusTone> = {
  draw_created: "success",
  player_moved: "info",
  confirmation_changed: "warning",
  waitlist_added: "default",
  waitlist_promoted: "success",
  match_created: "success",
  match_updated: "info",
  match_canceled: "error",
  organization_created: "success",
  organization_updated: "info",
  membership_changed: "warning",
  charge_created: "info",
  charge_canceled: "error",
  payment_registered: "success",
};

export function auditActionTone(action: string): StatusTone {
  return AUDIT_ACTION_TONES[action] ?? "default";
}
