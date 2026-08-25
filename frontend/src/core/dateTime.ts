/** Tratamento de data e hora — estratégia única da aplicação.
 *
 * O sistema trabalha com **três tipos distintos**, e misturá-los é a origem
 * clássica de erro de fuso. Cada um tem exatamente uma função aqui:
 *
 * 1. **Data do calendário** (`scheduled_date`, `"2026-08-11"`) — é um dia, não
 *    um instante. Não tem fuso.
 * 2. **Hora de parede** (`scheduled_time`, `draw_time`, `"21:00:00"`) — é o
 *    horário do relógio da quadra. Também não tem fuso: no backend são
 *    `TimeField` naive, e `USE_TZ` não os converte.
 * 3. **Instante** (`created_at`, `draw_executed_at`) — momento real na linha do
 *    tempo, trafega em UTC e **deve** ser convertido para o fuso de quem olha.
 *
 * As duas armadilhas que estas funções eliminam:
 *
 * - `new Date("2026-08-11")` é interpretado como **meia-noite UTC**. No Brasil
 *   (UTC-3) isso vira 21:00 do dia 10, e a tela mostra o dia errado. Por isso a
 *   data sempre é montada com `T00:00:00`, que força meia-noite **local**.
 * - Passar uma hora de parede por `new Date()` a transforma num instante e
 *   convida a uma conversão de fuso que não deve existir: "21:00" é 21:00 na
 *   quadra, sempre. Por isso `formatTime` é recorte de string, nunca `Date`.
 */

/** Data do calendário (`"2026-08-11"`) → `"11/08/2026"`, sem risco de cair no
 * dia anterior por causa do fuso. */
export function formatMatchDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("pt-BR");
}

/** Hora de parede (`"21:00:00"`) → `"21:00"`. Recorte de string de propósito:
 * converter para `Date` aqui reintroduziria o fuso que este valor não tem. */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

/** Instante em UTC (`created_at`) → data e hora no fuso de quem está olhando. */
export function formatTimestamp(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString("pt-BR");
}

/** Hoje no formato `YYYY-MM-DD`, pelo calendário **local**.
 *
 * `new Date().toISOString().slice(0, 10)` daria a data em UTC — no Brasil,
 * qualquer horário a partir das 21:00 já devolveria o dia seguinte. O
 * deslocamento pelo offset local corrige isso. */
export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Agora no formato `"HH:MM"`, pelo relógio **local** — o mesmo tipo "hora de
 * parede" que o backend guarda. Usado como padrão da partida avulsa, que por
 * definição é para jogar agora. */
export function nowTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
