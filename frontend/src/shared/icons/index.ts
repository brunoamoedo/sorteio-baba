/**
 * Mapa central de ícones.
 *
 * O sistema misturava emoji (`🎲 Sortear`, `⚽ Lançar Placar`, `🗑️ Remover`)
 * com `@mui/icons-material`. Emoji como ícone tem três problemas: renderiza
 * diferente em cada sistema operacional, o leitor de tela verbaliza ("bola de
 * futebol") no meio do rótulo do botão, e o alinhamento vertical nunca bate com
 * o do texto ao lado.
 *
 * A regra passa a ser: **ação usa ícone daqui**.
 *
 * ## O que continua sendo emoji, de propósito
 *
 * Emoji que é **conteúdo**, não decoração de interface:
 *
 * - a mensagem pronta para o WhatsApp (`features/matches/shareFormat.ts`) — ela
 *   é colada num aplicativo que não tem os nossos ícones, e o formato é regra
 *   de negócio documentada;
 * - a identidade dos times (🔵 🔴 🟠 🟢 🟣 🟡 ⚫ ⚪ 🟤) — o mesmo símbolo
 *   aparece na tela e na mensagem, e é assim que o jogador reconhece o time
 *   dele no grupo.
 */

// -- Navegação --
export { default as HomeIcon } from "@mui/icons-material/Home";
export { default as MatchesIcon } from "@mui/icons-material/SportsSoccer";
export { default as PlayersIcon } from "@mui/icons-material/Groups";
export { default as RecurringGameIcon } from "@mui/icons-material/EventRepeat";
export { default as FinanceIcon } from "@mui/icons-material/Payments";
export { default as OrganizationIcon } from "@mui/icons-material/Apartment";
export { default as StatisticsIcon } from "@mui/icons-material/BarChart";
export { default as AuditIcon } from "@mui/icons-material/FactCheck";
export { default as SettingsIcon } from "@mui/icons-material/Settings";
export { default as MenuIcon } from "@mui/icons-material/Menu";
export { default as MoreIcon } from "@mui/icons-material/MoreVert";
export { default as LogoutIcon } from "@mui/icons-material/Logout";
export { default as SwitchOrgIcon } from "@mui/icons-material/SwapHoriz";

// -- Sorteio --
/** O dado. Substitui o emoji 🎲 do botão principal do produto. */
export { default as DrawIcon } from "@mui/icons-material/Casino";
export { default as RedrawIcon } from "@mui/icons-material/Autorenew";
export { default as TrophyIcon } from "@mui/icons-material/EmojiEvents";
export { default as ScoreIcon } from "@mui/icons-material/SportsScore";
export { default as FormationIcon } from "@mui/icons-material/Dashboard";
export { default as SwapIcon } from "@mui/icons-material/SwapVert";
export { default as MoveIcon } from "@mui/icons-material/SwapHoriz";
/** Sorteio automático — substitui o emoji 🤖. */
export { default as AutomaticIcon } from "@mui/icons-material/SmartToy";

// -- Presença e fila --
export { default as ConfirmIcon } from "@mui/icons-material/CheckCircle";
export { default as DeclineIcon } from "@mui/icons-material/Cancel";
export { default as WaitlistIcon } from "@mui/icons-material/HourglassEmpty";
export { default as PromoteIcon } from "@mui/icons-material/Login";
export { default as NamesListIcon } from "@mui/icons-material/PlaylistAddCheck";
export { default as PersonIcon } from "@mui/icons-material/Person";
export { default as PersonAddIcon } from "@mui/icons-material/PersonAdd";

// -- Compartilhamento e exportação --
export { default as CopyIcon } from "@mui/icons-material/ContentCopy";
export { default as ShareIcon } from "@mui/icons-material/Share";
export { default as WhatsAppIcon } from "@mui/icons-material/WhatsApp";
export { default as PrintIcon } from "@mui/icons-material/Print";
export { default as DownloadIcon } from "@mui/icons-material/Download";
export { default as ImageIcon } from "@mui/icons-material/Image";

// -- CRUD e listas --
export { default as AddIcon } from "@mui/icons-material/Add";
export { default as EditIcon } from "@mui/icons-material/Edit";
export { default as DeleteIcon } from "@mui/icons-material/Delete";
export { default as CloseIcon } from "@mui/icons-material/Close";
export { default as SearchIcon } from "@mui/icons-material/Search";
export { default as FilterIcon } from "@mui/icons-material/FilterList";
export { default as UpIcon } from "@mui/icons-material/ArrowUpward";
export { default as DownIcon } from "@mui/icons-material/ArrowDownward";
export { default as ChevronRightIcon } from "@mui/icons-material/ChevronRight";
export { default as ExpandIcon } from "@mui/icons-material/ExpandMore";
export { default as EmptyIcon } from "@mui/icons-material/Inbox";

// -- Estado e informação --
export { default as WarningIcon } from "@mui/icons-material/WarningAmber";
export { default as InfoIcon } from "@mui/icons-material/InfoOutlined";
export { default as StarIcon } from "@mui/icons-material/Star";
export { default as ScheduleIcon } from "@mui/icons-material/Schedule";
export { default as DateIcon } from "@mui/icons-material/Event";
export { default as LocationIcon } from "@mui/icons-material/LocationOn";
export { default as NotesIcon } from "@mui/icons-material/Notes";

// -- Tema --
export { default as LightModeIcon } from "@mui/icons-material/LightMode";
export { default as DarkModeIcon } from "@mui/icons-material/DarkMode";
