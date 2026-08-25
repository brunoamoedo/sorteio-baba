import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

from apps.players.models import Player

MATCH_THRESHOLD = 0.72


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return " ".join(text.strip().lower().split())


# ---------------------------------------------------------------------------
# Leitura da lista colada do WhatsApp
# ---------------------------------------------------------------------------
#
# A lista real do grupo não vem como "um nome por linha, limpo". Vem assim:
#
#     1- João Busquets
#     2 - Sacra
#     3 - Zango ♟️(Sacra) PAGO
#     ...
#     👋 - Vitor
#
# Antes o sistema comparava a **linha inteira** com os mensalistas. A numeração
# ("1 -") entrava como palavra no casamento por token e derrubava a média
# abaixo do limiar: numa lista real de 20 linhas, **nenhuma** era reconhecida, e
# colar a lista criava 20 convidados duplicados — inclusive de mensalistas que
# já estavam cadastrados. Por isso a linha é decomposta antes de comparar.

_LEADING_ORDER = re.compile(r"^\s*\d+\s*[-–—.):]+\s*")
_LEADING_SEPARATOR = re.compile(r"^\s*[-–—.):]+\s*")
_BRACKETED = re.compile(r"[(\[{][^)\]}]*[)\]}]")

# Escapes em vez dos caracteres literais de propósito: vários deles (o seletor
# de variação U+FE0F, o ZWJ, o keycap) são invisíveis no editor e sumiriam numa
# edição descuidada, sem ninguém perceber.
_EMOJI = re.compile(
    "["
    "\U0001f000-\U0001faff"  # pictogramas e emojis modernos (👋 🙌 ⚽ …)
    "←-⇿"  # setas
    "⌀-➿"  # símbolos diversos (♟ ❌ ✅ …)
    "⬀-⯿"
    "️‍⃣"  # seletor de variação, ZWJ, keycap
    "]"
)

# Marcadores que, na convenção do grupo, dizem que a pessoa **saiu** da lista
# em vez de indicar uma posição. Testados antes de os emojis serem removidos.
OUT_MARKERS = (
    "\U0001f44b",  # 👋 mãozinha de tchau
    "❌",  # ❌
    "✖",  # ✖
    "❎",  # ❎
    "\U0001f6ab",  # 🚫
    "⛔",  # ⛔
    "\U0001f645",  # 🙅
)

# Anotações de controle do organizador que não fazem parte do nome. Só são
# descartadas quando sobra algum nome depois — se a linha inteira for "PAGO",
# ela continua sendo tratada como texto e vira uma linha visível na conferência,
# em vez de sumir em silêncio.
_ANNOTATION_WORDS = frozenset(
    {"pago", "pagou", "pg", "pix", "deve", "devendo", "falta", "faltou", "ok"}
)


@dataclass(frozen=True)
class RosterLine:
    """Uma linha da lista colada, já decomposta."""

    raw: str
    """Linha original — é ela que volta para a tela, para o organizador
    reconhecer o que colou."""

    name: str
    """Só o nome, pronto para o casamento (e para virar convidado, se for o
    caso — antes um convidado nascia chamado "1- Fulano")."""

    is_out: bool
    """Linha marcada com 👋/❌: a pessoa saiu da lista."""


def parse_roster_line(raw: str) -> RosterLine | None:
    """Extrai o nome de uma linha da lista colada. Devolve `None` quando não
    sobra nome nenhum (linha vazia, só numeração ou só emoji)."""
    text = raw.strip()
    if not text:
        return None

    is_out = any(marker in text for marker in OUT_MARKERS)

    # Emojis primeiro: eles podem vir **antes** da numeração ("⚽ 5 - Bibito"),
    # e aí a numeração só é reconhecida como início de linha depois que o emoji
    # sai. Remover emoji não mexe nos parênteses, então "♟️(Sacra)" continua
    # delimitado para o passo seguinte.
    text = _EMOJI.sub(" ", text)
    text = _LEADING_ORDER.sub("", text)
    text = _BRACKETED.sub(" ", text)
    # O separador que sobrou depois de um emoji-marcador ("👋 - Vitor").
    text = _LEADING_SEPARATOR.sub("", text)

    words = text.split()
    kept = [word for word in words if normalize(word) not in _ANNOTATION_WORDS]
    name = " ".join(kept or words).strip()

    if not normalize(name):
        return None
    return RosterLine(raw=raw.strip(), name=name, is_out=is_out)


# ---------------------------------------------------------------------------
# Casamento de nomes
# ---------------------------------------------------------------------------


def _token_score(input_tokens: list[str], candidate_tokens: list[str]) -> float:
    """Pontua a semelhança palavra a palavra, não a string inteira. Evita que um
    sobrenome em comum (ex.: "marocas") vença por a string inteira ser mais curta
    e "parecer" mais parecida, mesmo quando o primeiro nome não bate nada."""
    if not input_tokens or not candidate_tokens:
        return 0.0
    per_token_best = [
        max(SequenceMatcher(None, token, candidate_token).ratio() for candidate_token in candidate_tokens)
        for token in input_tokens
    ]
    return sum(per_token_best) / len(per_token_best)


def best_match(name: str, candidates: list[Player]) -> tuple[Player | None, float]:
    """Encontra o mensalista mais parecido com `name` (nome ou apelido), ignorando
    acentos/caixa. Usado para reconhecer mensalistas a partir de uma lista de nomes
    colada manualmente (ex.: WhatsApp), tolerando pequenas variações de digitação.

    Empate é decidido pelo candidato **mais específico**: "Barba" pontua 1.0
    tanto para o mensalista "Barba" quanto para "Bruno barba" (o token bate nos
    dois), e sem critério de desempate vencia simplesmente o primeiro da
    consulta. Ganha quem bate o nome inteiro; depois, quem tem menos palavras
    sobrando em relação ao que foi digitado."""
    input_tokens = normalize(name).split()
    normalized_input = " ".join(input_tokens)

    best_player: Player | None = None
    best_score = 0.0
    best_rank: tuple[float, int, int] = (0.0, 0, 0)

    for player in candidates:
        for candidate_name in filter(None, [player.name, player.nickname]):
            candidate_tokens = normalize(candidate_name).split()
            score = _token_score(input_tokens, candidate_tokens)
            rank = (
                score,
                1 if " ".join(candidate_tokens) == normalized_input else 0,
                -abs(len(candidate_tokens) - len(input_tokens)),
            )
            if rank > best_rank:
                best_rank = rank
                best_score = score
                best_player = player

    if best_score >= MATCH_THRESHOLD:
        return best_player, best_score
    return None, best_score
