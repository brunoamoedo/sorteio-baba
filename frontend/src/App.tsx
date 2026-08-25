import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppThemeProvider } from "./shared/theme/ColorModeContext";
import { PageSkeleton } from "./shared/components/PageSkeleton";
import { ToastProvider } from "./shared/components/ToastProvider";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { ChangePasswordPage } from "./features/auth/ChangePasswordPage";
import { LoginPage } from "./features/auth/LoginPage";
import { OrganizationProvider } from "./features/organization/OrganizationContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RequireOrganization } from "./routes/RequireOrganization";
import { RequireRole } from "./routes/RequireRole";

/**
 * As telas são carregadas sob demanda.
 *
 * Antes tudo era importado estaticamente: um jogador que só confirma presença
 * baixava o módulo financeiro inteiro e o `@mui/x-charts` (que só a tela de
 * Estatísticas usa) antes de ver qualquer coisa. Em 4G isso é tempo puro de
 * espera.
 *
 * `LoginPage` fica de fora de propósito — é a primeira tela de quem não tem
 * sessão, e adiar o carregamento dela só atrasaria o que importa.
 */
const DashboardPage = lazy(() =>
  import("./features/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const PlayersPage = lazy(() =>
  import("./features/players/PlayersPage").then((m) => ({ default: m.PlayersPage })),
);
const RecurringGamesPage = lazy(() =>
  import("./features/recurringGames/RecurringGamesPage").then((m) => ({
    default: m.RecurringGamesPage,
  })),
);
const MatchesPage = lazy(() =>
  import("./features/matches/MatchesPage").then((m) => ({ default: m.MatchesPage })),
);
const MatchDetailPage = lazy(() =>
  import("./features/matches/MatchDetailPage").then((m) => ({ default: m.MatchDetailPage })),
);
const DrawAvulsoPage = lazy(() =>
  import("./features/matches/DrawAvulsoPage").then((m) => ({ default: m.DrawAvulsoPage })),
);
const StatisticsPage = lazy(() =>
  import("./features/statistics/StatisticsPage").then((m) => ({ default: m.StatisticsPage })),
);
const AuditLogPage = lazy(() =>
  import("./features/audit/AuditLogPage").then((m) => ({ default: m.AuditLogPage })),
);
const FinancePage = lazy(() =>
  import("./features/finance/FinancePage").then((m) => ({ default: m.FinancePage })),
);
const MyChargesPage = lazy(() =>
  import("./features/finance/MyChargesPage").then((m) => ({ default: m.MyChargesPage })),
);
const MyMatchesPage = lazy(() =>
  import("./features/matches/MyMatchesPage").then((m) => ({ default: m.MyMatchesPage })),
);
const SystemAdminPage = lazy(() =>
  import("./features/admin/SystemAdminPage").then((m) => ({ default: m.SystemAdminPage })),
);
const MembersPage = lazy(() =>
  import("./features/members/MembersPage").then((m) => ({ default: m.MembersPage })),
);
const LoginsPage = lazy(() =>
  import("./features/players/LoginsPage").then((m) => ({ default: m.LoginsPage })),
);

function AppRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <RequireChangedPassword>
        <RequireOrganization>
          <RequireRole>{children}</RequireRole>
        </RequireOrganization>
      </RequireChangedPassword>
    </ProtectedRoute>
  );
}

/**
 * Primeiro acesso: quem está com a senha temporária só vê a tela de troca.
 *
 * Vem **antes** de `RequireOrganization` porque a pessoa precisa trocar a
 * senha mesmo sem ter escolhido organização — e porque o servidor recusaria a
 * consulta das organizações de qualquer jeito.
 *
 * O bloqueio de verdade é do middleware do backend. Isto aqui só evita mostrar
 * uma tela que responderia 403 em tudo.
 */
function RequireChangedPassword({ children }: { children: ReactNode }) {
  const { user, reloadUser } = useAuth();
  if (!user?.must_change_password) return <>{children}</>;
  return <ChangePasswordPage onDone={reloadUser} />;
}

const PROTECTED_ROUTES: { path: string; element: ReactNode }[] = [
  { path: "/", element: <DashboardPage /> },
  { path: "/jogadores", element: <PlayersPage /> },
  { path: "/jogos-recorrentes", element: <RecurringGamesPage /> },
  { path: "/partidas", element: <MatchesPage /> },
  { path: "/partidas/:id", element: <MatchDetailPage /> },
  { path: "/sorteio-avulso", element: <DrawAvulsoPage /> },
  { path: "/estatisticas", element: <StatisticsPage /> },
  { path: "/auditoria", element: <AuditLogPage /> },
  { path: "/financeiro", element: <FinancePage /> },
  // Auto-serviço do jogador — as rotas do backend filtram pelo login dele.
  { path: "/minhas-partidas", element: <MyMatchesPage /> },
  { path: "/minhas-mensalidades", element: <MyChargesPage /> },
  { path: "/pessoas", element: <MembersPage /> },
  { path: "/logins", element: <LoginsPage /> },
  { path: "/sistema", element: <SystemAdminPage /> },
];

export default function App() {
  return (
    <AppThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <OrganizationProvider>
              {/* O esqueleto no lugar da tela em branco enquanto o pedaço da
                  rota chega. */}
              <Suspense fallback={<PageSkeleton rows={3} stats={3} />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  {PROTECTED_ROUTES.map(({ path, element }) => (
                    <Route key={path} path={path} element={<AppRoute>{element}</AppRoute>} />
                  ))}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </OrganizationProvider>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </AppThemeProvider>
  );
}
