import { Box, Card, CardContent, Skeleton, Stack } from "@mui/material";

interface PageSkeletonProps {
  /** Quantos blocos de conteúdo desenhar. */
  rows?: number;
  /** Fileira de cartões de métrica no topo (dashboard, financeiro). */
  stats?: number;
}

/**
 * Esqueleto de página inteira.
 *
 * O `DataTable` já tinha skeleton próprio, mas fora dele (dashboard, detalhe da
 * partida, carregamento de rota com `React.lazy`) a tela ficava em branco ou
 * piscava um spinner solto. Um esqueleto com a forma aproximada do conteúdo
 * evita o salto de layout quando os dados chegam.
 */
export function PageSkeleton({ rows = 3, stats = 0 }: PageSkeletonProps) {
  return (
    <Box role="status" aria-busy="true" aria-label="Carregando">
      <Skeleton variant="text" width="45%" height={40} />
      <Skeleton variant="text" width="65%" height={20} sx={{ mb: 3 }} />

      {stats > 0 && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr 1fr", md: `repeat(${Math.min(stats, 4)}, 1fr)` },
            gap: 2,
            mb: 3,
          }}
        >
          {Array.from({ length: stats }).map((_, index) => (
            <Card key={index}>
              <CardContent>
                <Skeleton variant="text" width="70%" />
                <Skeleton variant="text" width="45%" height={36} />
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      <Stack spacing={2}>
        {Array.from({ length: rows }).map((_, index) => (
          <Card key={index}>
            <CardContent>
              <Skeleton variant="text" width="40%" />
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="60%" />
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
