"""Leitura da lista colada do WhatsApp.

A lista real do grupo é numerada e tem emojis e anotações. Antes, a linha
inteira ("1- João Busquets") era comparada com os mensalistas: a numeração
entrava como palavra no casamento por token, derrubava a média abaixo do
limiar e **nenhuma** das 20 linhas era reconhecida — colar a lista criava 20
convidados duplicados, inclusive de mensalistas já cadastrados.
"""

import pytest

from apps.matches.models import Confirmation
from apps.matches.name_matching import best_match, parse_roster_line
from apps.matches.services import quick_confirm_names
from apps.players.models import Player

from .factories import MatchFactory, OrganizationFactory, PlayerFactory, PositionFactory

# A lista exata que o organizador cola no sistema.
LISTA_DO_GRUPO = """1- João Busquets
2 - Sacra
3 - Zango ♟️(Sacra) PAGO
4 - Jonathan
5 - Bibito
6 - Barba
7 - macedo\x20
8 - Digs
9 - Emanuel\x20
10 - Rafael\x20
11 - Firmino\x20
12 - Diego
13 - Santiago\x20
14 - Astro
15 - Serginho\x20
16 - Almada
17 - Weslley
18 - Dieguinho
\U0001f44b - Vitor
\U0001f44b - dentinho"""


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1- João Busquets", "João Busquets"),
        ("2 - Sacra", "Sacra"),
        ("3 - Zango ♟️(Sacra) PAGO", "Zango"),
        ("7 - macedo ", "macedo"),
        ("10 - Rafael ", "Rafael"),
        ("18 - Dieguinho", "Dieguinho"),
        ("\U0001f44b - Vitor", "Vitor"),
        ("12. Diego", "Diego"),
        ("13) Santiago", "Santiago"),
        ("14 – Astro", "Astro"),  # travessão, não hífen
        ("⚽ 5 - Bibito", "Bibito"),
        ("Barba", "Barba"),  # linha já limpa continua funcionando
    ],
)
def test_parse_roster_line_extracts_the_name(raw, expected):
    line = parse_roster_line(raw)
    assert line is not None
    assert line.name == expected
    assert line.raw == raw.strip()


@pytest.mark.parametrize("raw", ["", "   ", "19 -", "\U0001f44b", "♟️", "(só anotação)"])
def test_parse_roster_line_discards_lines_without_a_name(raw):
    assert parse_roster_line(raw) is None


@pytest.mark.parametrize(
    ("raw", "is_out"),
    [
        ("\U0001f44b - Vitor", True),
        ("❌ - Vitor", True),
        ("1 - Vitor", False),
        ("♟️ 3 - Zango", False),  # emoji qualquer não é marcador de saída
    ],
)
def test_parse_roster_line_flags_who_left_the_list(raw, is_out):
    line = parse_roster_line(raw)
    assert line is not None
    assert line.is_out is is_out


def test_annotation_alone_is_kept_as_text_instead_of_vanishing():
    """Uma linha que é só "PAGO" não some em silêncio — vira uma linha visível
    na conferência, para o organizador perceber que colou algo estranho."""
    line = parse_roster_line("PAGO")
    assert line is not None
    assert line.name == "PAGO"


# ---------------------------------------------------------------------------
# Casamento com os mensalistas
# ---------------------------------------------------------------------------


def _mensalistas(org, names):
    position = PositionFactory(organization=org)
    return [
        PlayerFactory(
            organization=org,
            name=name,
            player_type=Player.PlayerType.MENSALISTA,
            primary_position=position,
        )
        for name in names
    ]


@pytest.mark.django_db
def test_numbered_line_now_matches_the_mensalista():
    """A regressão principal: com a numeração na frente, o score caía de 1.0
    para 0.33 e o mensalista virava um convidado duplicado."""
    org = OrganizationFactory()
    players = _mensalistas(org, ["João Busquets"])

    assert best_match("1- João Busquets", players)[0] is None  # linha crua: não reconhece

    line = parse_roster_line("1- João Busquets")
    matched, score = best_match(line.name, players)
    assert matched == players[0]
    assert score == pytest.approx(1.0)


@pytest.mark.django_db
def test_tie_between_similar_mensalistas_prefers_the_exact_name():
    """"Barba" pontua 1.0 para "Barba" e para "Bruno barba" — vence o nome
    inteiro, não o primeiro da consulta."""
    org = OrganizationFactory()
    bruno, barba = _mensalistas(org, ["Bruno barba", "Barba"])

    assert best_match("Barba", [bruno, barba])[0] == barba
    assert best_match("Barba", [barba, bruno])[0] == barba
    assert best_match("Bruno barba", [barba, bruno])[0] == bruno


@pytest.mark.django_db
def test_full_whatsapp_list_recognizes_mensalistas_and_skips_who_left():
    org = OrganizationFactory()
    _mensalistas(
        org,
        [
            "João Busquets",
            "Sacra Rifas Novo",
            "Jonathan Baba",
            "Barba",
            "Macedo",
            "Digs",
            "Felipe Santiago Firmino",
            "Diego Ferreira",
            "Astro",
            "Almada",
            "Dieguinho",
        ],
    )
    match = MatchFactory(organization=org, max_players=40, min_players=2)

    results = quick_confirm_names(match=match, raw_names=LISTA_DO_GRUPO.split("\n"))

    by_line = {item["input_name"]: item for item in results}

    # Reconhecidos como mensalistas, apesar da numeração.
    assert by_line["1- João Busquets"]["resolution"] == "mensalista"
    assert by_line["1- João Busquets"]["player_name"] == "João Busquets"
    assert by_line["2 - Sacra"]["player_name"] == "Sacra Rifas Novo"
    assert by_line["6 - Barba"]["player_name"] == "Barba"
    assert by_line["7 - macedo"]["player_name"] == "Macedo"
    assert by_line["18 - Dieguinho"]["player_name"] == "Dieguinho"

    # Anotações fora do nome: o convidado nasce "Zango", não "3 - Zango ♟️(Sacra) PAGO".
    zango = by_line["3 - Zango ♟️(Sacra) PAGO"]
    assert zango["resolution"] == "convidado_criado"
    assert zango["player_name"] == "Zango"

    # Quem saiu da lista é relatado e não confirmado.
    vitor = by_line["\U0001f44b - Vitor"]
    assert vitor["resolution"] == "fora_da_lista"
    assert vitor["player_id"] is None
    assert not Player.objects.filter(organization=org, name__iexact="Vitor").exists()

    # Nenhum mensalista virou convidado duplicado.
    assert not Player.objects.filter(
        organization=org, player_type=Player.PlayerType.CONVIDADO, name__iexact="Barba"
    ).exists()

    confirmed = set(
        Confirmation.objects.filter(match=match, status=Confirmation.Status.CONFIRMED).values_list(
            "player__name", flat=True
        )
    )
    assert "Vitor" not in confirmed
    assert "dentinho" not in confirmed
    assert {"João Busquets", "Sacra Rifas Novo", "Barba", "Macedo", "Zango"} <= confirmed
    # 20 linhas - 2 marcadas com 👋 = 18 nomes processados, mas 17 jogadores:
    # "11 - Firmino" e "13 - Santiago" se parecem os dois com o mensalista
    # "Felipe Santiago Firmino" (o nome dele contém as duas palavras). É uma
    # ambiguidade dos dados, não do parser.
    #
    # A primeira linha leva o mensalista; a segunda **não** o reconhece de novo
    # (ele já está confirmado e saiu da disputa) e é relatada como
    # `ja_confirmado` — a tela mostra o conflito em vez de marcar as duas linhas
    # com o mesmo ✅ e deixar a segunda pessoa de fora sem ninguém perceber.
    assert len(confirmed) == 17
    assert by_line["11 - Firmino"]["resolution"] == "mensalista"
    assert by_line["11 - Firmino"]["player_name"] == "Felipe Santiago Firmino"
    assert by_line["13 - Santiago"]["resolution"] == "ja_confirmado"
    assert by_line["13 - Santiago"]["player_name"] == "Felipe Santiago Firmino"


@pytest.mark.django_db
def test_pasting_the_same_list_twice_does_not_duplicate_guests():
    """Recolar a lista (comum quando o grupo atualiza) reaproveita o convidado
    já criado em vez de criar outro."""
    org = OrganizationFactory()
    _mensalistas(org, ["Barba"])
    match = MatchFactory(organization=org, max_players=40, min_players=2)

    quick_confirm_names(match=match, raw_names=LISTA_DO_GRUPO.split("\n"))
    before = Player.objects.filter(organization=org).count()
    quick_confirm_names(match=match, raw_names=LISTA_DO_GRUPO.split("\n"))

    assert Player.objects.filter(organization=org).count() == before
    assert Player.objects.filter(organization=org, name__iexact="Zango").count() == 1


# ---------------------------------------------------------------------------
# Só concorre ao reconhecimento quem ainda não está confirmado
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_two_similar_lines_do_not_take_the_same_mensalista():
    """Duas linhas parecidas não podem casar com o mesmo mensalista.

    Antes, "Firmino" e "Santiago" caíam ambas em "Felipe Santiago Firmino": a
    segunda reconfirmava quem já estava dentro (no-op invisível) e a pessoa
    daquela linha ficava de fora sem ninguém perceber.
    """
    org = OrganizationFactory()
    _mensalistas(org, ["Felipe Santiago Firmino"])
    match = MatchFactory(organization=org, max_players=40, min_players=2)

    results = quick_confirm_names(match=match, raw_names=["Firmino", "Santiago"])

    assert results[0]["resolution"] == "mensalista"
    assert results[0]["player_name"] == "Felipe Santiago Firmino"
    assert results[1]["resolution"] == "ja_confirmado"
    assert results[1]["player_name"] == "Felipe Santiago Firmino"
    assert Confirmation.objects.filter(
        match=match, status=Confirmation.Status.CONFIRMED
    ).count() == 1


@pytest.mark.django_db
def test_mensalista_already_confirmed_by_hand_is_not_recognized_again():
    """Quem já foi confirmado na tela sai da disputa: colar o nome dele de novo
    é relatado como repetição, sem criar convidado homônimo."""
    org = OrganizationFactory()
    [barba] = _mensalistas(org, ["Barba"])
    match = MatchFactory(organization=org, max_players=40, min_players=2)
    quick_confirm_names(match=match, raw_names=["Barba"])

    results = quick_confirm_names(match=match, raw_names=["Barba"])

    assert results[0]["resolution"] == "ja_confirmado"
    assert results[0]["player_id"] == barba.id
    assert not Player.objects.filter(
        organization=org, player_type=Player.PlayerType.CONVIDADO, name__iexact="Barba"
    ).exists()


@pytest.mark.django_db
def test_a_second_mensalista_still_wins_when_one_is_taken():
    """Tirar o confirmado da disputa não empurra a linha para "convidado": o
    reconhecimento continua entre os mensalistas que sobraram."""
    org = OrganizationFactory()
    _mensalistas(org, ["Diego Ferreira", "Dieguinho"])
    match = MatchFactory(organization=org, max_players=40, min_players=2)

    results = quick_confirm_names(match=match, raw_names=["Dieguinho", "Diego Ferreira"])

    assert [item["player_name"] for item in results] == ["Dieguinho", "Diego Ferreira"]
    assert all(item["resolution"] == "mensalista" for item in results)


@pytest.mark.django_db
def test_declined_mensalista_is_still_available_for_recognition():
    """Só "confirmado" tira o mensalista da disputa. Quem desmarcou a presença
    (ou nunca respondeu) continua podendo ser reconhecido na lista colada."""
    org = OrganizationFactory()
    [barba] = _mensalistas(org, ["Barba"])
    match = MatchFactory(organization=org, max_players=40, min_players=2)
    Confirmation.objects.create(match=match, player=barba, status=Confirmation.Status.DECLINED)

    results = quick_confirm_names(match=match, raw_names=["Barba"])

    assert results[0]["resolution"] == "mensalista"
    assert results[0]["player_id"] == barba.id
