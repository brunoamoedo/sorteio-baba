import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";

import { useOrganization } from "./OrganizationContext";

export function OrganizationSelectorPage() {
  const { memberships, selectOrganization } = useOrganization();

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      {/* Largura fluida com teto: `width: 420` fixo estourava a tela em 375px. */}
      <Stack spacing={2} sx={{ width: "100%", maxWidth: 420 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Selecione a organização
        </Typography>
        {memberships.map((membership) => (
          <Card key={membership.organization.id}>
            <CardActionArea onClick={() => selectOrganization(membership.organization.id)}>
              <CardContent
                sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <Typography variant="body1">{membership.organization.name}</Typography>
                <Chip label={membership.role} size="small" />
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
