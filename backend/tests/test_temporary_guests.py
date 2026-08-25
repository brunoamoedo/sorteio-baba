"""Convidado da lista colada não é cadastro.

Colar a lista do WhatsApp criava um `Player` permanente para cada nome não
reconhecido. Depois de algumas semanas o cadastro de Jogadores virava um
depósito de gente que jogou uma vez.

Regra: o convidado da lista **precisa** de um registro (o sorteio, a
confirmação e a lista de espera todos têm FK para `Player`), mas ele existe só
para aquela partida — fica fora do cadastro e é removido quando a partida é
concluída. O resultado já divulgado continua intacto.
"""

import pytest

from apps.draws.services import execute_draw, set_match_results
from apps.matches.models import Confirmation, Match
from apps.matches.services import (
    cleanup_temporary_guests,
    quick_confirm_names,
    set_all_confirmations,
    set_confirmation,
)
from apps.players.models import Player
from common.permissions import ROLE_ORGANIZADOR

from .factories import (
    MatchFactory,
    MembershipFactory,
    OrganizationFactory,
    PlayerFactory,
    PositionFactory,
)
from .test_matches import authenticated_client


def _org_with_position():
    org = OrganizationFactory()
    PositionFactory(organization=org, code="ZAG", name="Zagueiro")
    return org


@pytest.mark.django_db
def test_guest_from_pasted_list_is_temporary():
    org = _org_with_position()
    match = MatchFactory(organization=org, max_players=20, min_players=2)

    quick_confirm_names(match=match, raw_names=["Zango", "Bibito"])

    guests = Player.all_objects.filter(organization=org, player_type=Player.PlayerType.CONVIDADO)
    assert guests.count() == 2
    assert all(guest.is_temporary for guest in guests)


@pytest.mark.django_db
def test_temporary_guest_is_hidden_from_the_players_registry():
    org = _org_with_position()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    mensalista = PlayerFactory(organization=org, name="Barba", player_type=Player.PlayerType.MENSALISTA)
    match = MatchFactory(organization=org, max_players=20, min_players=2)

    quick_confirm_names(match=match, raw_names=["Zango"])

    listados = [p["name"] for p in client.get("/api/players/").json()["results"]]
    assert mensalista.name in listados
    assert "Zango" not in listados


@pytest.mark.django_db
def test_temporary_guest_still_appears_in_its_own_match_roster():
    """Ele não é cadastro, mas o organizador precisa vê-lo na partida para
    conferir e, se quiser, desmarcar a presença."""
    org = _org_with_position()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    match = MatchFactory(organization=org, max_players=20, min_players=2)

    quick_confirm_names(match=match, raw_names=["Zango"])

    roster = client.get(f"/api/matches/{match.id}/roster/").json()
    nomes = {linha["player"]["name"] for linha in roster}
    assert "Zango" in nomes
    assert next(linha for linha in roster if linha["player"]["name"] == "Zango")[
        "confirmation_status"
    ] == "confirmed"


@pytest.mark.django_db
def test_a_temporary_guest_from_another_match_does_not_leak_into_the_roster():
    org = _org_with_position()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    outra = MatchFactory(organization=org, max_players=20, min_players=2)
    minha = MatchFactory(organization=org, max_players=20, min_players=2)

    quick_confirm_names(match=outra, raw_names=["Zango"])

    roster = client.get(f"/api/matches/{minha.id}/roster/").json()
    assert "Zango" not in {linha["player"]["name"] for linha in roster}


@pytest.mark.django_db
def test_confirm_all_does_not_drag_in_temporary_guests_from_other_matches():
    org = _org_with_position()
    PlayerFactory(organization=org, name="Barba")
    outra = MatchFactory(organization=org, max_players=20, min_players=2)
    minha = MatchFactory(organization=org, max_players=20, min_players=2)
    quick_confirm_names(match=outra, raw_names=["Zango"])

    set_all_confirmations(match=minha, status=Confirmation.Status.CONFIRMED)

    confirmados = set(
        Confirmation.objects.filter(match=minha, status=Confirmation.Status.CONFIRMED).values_list(
            "player__name", flat=True
        )
    )
    assert "Barba" in confirmados
    assert "Zango" not in confirmados


# ---------------------------------------------------------------------------
# Limpeza ao concluir — e o histórico sobrevivendo a ela
# ---------------------------------------------------------------------------


def _match_ready(org, *, guests):
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=20)
    for _ in range(4):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    quick_confirm_names(match=match, raw_names=guests)
    return match


@pytest.mark.django_db
def test_completing_the_match_removes_the_temporary_guests():
    org = _org_with_position()
    match = _match_ready(org, guests=["Zango", "Bibito"])
    draw = execute_draw(match=match)

    assert Player.objects.filter(organization=org, is_temporary=True).count() == 2

    set_match_results(
        match=match, results=[{"team_id": team.id, "goals_scored": 1} for team in draw.teams.all()]
    )

    assert Player.objects.filter(organization=org, is_temporary=True).count() == 0


@pytest.mark.django_db
def test_the_draw_result_still_shows_the_removed_guest():
    """A promessa de histórico imutável: o convidado sai do banco de trabalho,
    mas o resultado já divulgado continua completo — nome, posição e estrelas."""
    org = _org_with_position()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    match = _match_ready(org, guests=["Zango"])
    draw = execute_draw(match=match)

    set_match_results(
        match=match, results=[{"team_id": team.id, "goals_scored": 1} for team in draw.teams.all()]
    )
    assert not Player.objects.filter(name="Zango").exists()  # removido do cadastro

    payload = client.get(f"/api/draws/{draw.id}/").json()
    escalados = [
        jogador
        for time in payload["teams"]
        for jogador in time["team_players"]
    ]
    zango = next(j for j in escalados if j["player_name"] == "Zango")
    assert zango["position_snapshot"]["code"] == "ZAG"
    assert zango["skill_snapshot"] >= 1


@pytest.mark.django_db
def test_a_guest_still_playing_another_open_match_is_preserved():
    """A mesma pessoa pode ter sido colada na lista da semana seguinte antes de
    esta partida ser concluída — não pode sumir do jogo que ainda vai acontecer."""
    org = _org_with_position()
    esta_semana = _match_ready(org, guests=["Zango"])
    proxima_semana = MatchFactory(organization=org, max_players=20, min_players=2)
    quick_confirm_names(match=proxima_semana, raw_names=["Zango"])

    draw = execute_draw(match=esta_semana)
    set_match_results(
        match=esta_semana,
        results=[{"team_id": team.id, "goals_scored": 0} for team in draw.teams.all()],
    )

    assert Player.objects.filter(name="Zango", is_temporary=True).exists()
    assert (
        Confirmation.objects.get(match=proxima_semana, player__name="Zango").status
        == Confirmation.Status.CONFIRMED
    )


@pytest.mark.django_db
def test_cleanup_never_touches_registered_players():
    """Mensalistas e convidados cadastrados à mão não são temporários e ficam."""
    org = _org_with_position()
    mensalista = PlayerFactory(organization=org, name="Barba")
    convidado_cadastrado = PlayerFactory(
        organization=org, name="Visitante fixo", player_type=Player.PlayerType.CONVIDADO
    )
    match = MatchFactory(organization=org, max_players=20, min_players=2)
    for player in (mensalista, convidado_cadastrado):
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
    quick_confirm_names(match=match, raw_names=["Zango"])

    removidos = cleanup_temporary_guests(match=match)

    assert [p.name for p in removidos] == ["Zango"]
    assert Player.objects.filter(id=mensalista.id).exists()
    assert Player.objects.filter(id=convidado_cadastrado.id).exists()


@pytest.mark.django_db
def test_cleanup_is_idempotent():
    org = _org_with_position()
    match = MatchFactory(organization=org, max_players=20, min_players=2)
    quick_confirm_names(match=match, raw_names=["Zango"])

    assert len(cleanup_temporary_guests(match=match)) == 1
    assert cleanup_temporary_guests(match=match) == []


@pytest.mark.django_db
def test_pasting_the_same_name_again_recreates_the_guest():
    """Removido o convidado, colar o nome de novo simplesmente cria outro —
    nada quebra."""
    org = _org_with_position()
    match = MatchFactory(organization=org, max_players=20, min_players=2)
    quick_confirm_names(match=match, raw_names=["Zango"])
    cleanup_temporary_guests(match=match)

    outra = MatchFactory(organization=org, max_players=20, min_players=2)
    resultado = quick_confirm_names(match=outra, raw_names=["Zango"])

    assert resultado[0]["resolution"] == "convidado_criado"
    assert Player.objects.filter(name="Zango", is_temporary=True).count() == 1


@pytest.mark.django_db
def test_canceled_match_status_does_not_keep_a_guest_alive():
    """Uma partida cancelada não segura o convidado: ela não vai acontecer."""
    org = _org_with_position()
    cancelada = MatchFactory(
        organization=org, max_players=20, min_players=2, status=Match.Status.CANCELED
    )
    quick_confirm_names(match=cancelada, raw_names=["Zango"])
    atual = MatchFactory(organization=org, max_players=20, min_players=2)
    quick_confirm_names(match=atual, raw_names=["Zango"])

    removidos = cleanup_temporary_guests(match=atual)

    assert [p.name for p in removidos] == ["Zango"]
