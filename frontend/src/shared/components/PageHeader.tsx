import type { ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{ justifyContent: "space-between", alignItems: { xs: "stretch", sm: "center" }, mb: 3 }}
    >
      <Box>
        {/* `component="h1"`: o título da página é o primeiro nível da hierarquia.
            Antes `variant="h5"` renderizava um `<h5>` e nenhuma tela do sistema
            tinha `<h1>` — a navegação por headings ficava quebrada. */}
        <Typography variant="h1" component="h1">
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  );
}
