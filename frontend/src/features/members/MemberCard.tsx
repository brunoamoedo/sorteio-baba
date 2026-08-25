import { Box, Card, CardContent, MenuItem, Stack, TextField, Typography } from "@mui/material";

import { DeleteIcon } from "../../shared/icons";
import { OverflowMenu } from "../../shared/components/OverflowMenu";
import { PlayerAvatar } from "../../shared/components/PlayerAvatar";
import { StatusChip } from "../../shared/components/StatusChip";
import { ROLE_LABELS, type MembershipRole } from "../../core/types/organization";

import type { OrganizationMember } from "../../api/membersApi";

interface MemberCardProps {
  member: OrganizationMember;
  isBusy: boolean;
  onChangeRole: (member: OrganizationMember, role: MembershipRole) => void;
  onRemove: (member: OrganizationMember) => void;
}

/** Pessoa da organização como card. O seletor de perfil fica no card mesmo —
 * é a ação que o gerente vem fazer nesta tela. */
export function MemberCard({ member, isBusy, onChangeRole, onRemove }: MemberCardProps) {
  return (
    <Card>
      <CardContent sx={{ py: 1.75, "&:last-child": { pb: 1.75 } }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
          <PlayerAvatar name={member.username} size={40} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
              {member.username}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              {member.email}
            </Typography>
          </Box>
          {member.is_active ? (
            <OverflowMenu
              label={`Ações de ${member.username}`}
              actions={[
                {
                  label: "Remover da organização",
                  icon: DeleteIcon,
                  destructive: true,
                  onClick: () => onRemove(member),
                },
              ]}
            />
          ) : (
            <StatusChip label="Removido" tone="default" />
          )}
        </Stack>

        <Box sx={{ mt: 1 }}>
          {member.linked_player_name ? (
            <Typography variant="caption" color="text.secondary">
              Ficha: {member.linked_player_name}
            </Typography>
          ) : (
            // Sem ficha, a pessoa não confirma a própria presença — o gerente
            // precisa ver isso justamente aqui, onde pensa em acessos.
            <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>
              Sem ficha de jogador vinculada
            </Typography>
          )}
        </Box>

        <TextField
          select
          size="small"
          fullWidth
          label="Perfil"
          value={member.role}
          disabled={isBusy || !member.is_active}
          onChange={(event) => onChangeRole(member, event.target.value as MembershipRole)}
          sx={{ mt: 1.5 }}
        >
          {(Object.keys(ROLE_LABELS) as MembershipRole[]).map((role) => (
            <MenuItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </MenuItem>
          ))}
        </TextField>
      </CardContent>
    </Card>
  );
}
