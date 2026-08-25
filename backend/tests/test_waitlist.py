"""Fila de espera e respeito à configuração da partida.

Regras acordadas com o usuário e cobertas aqui:
- capacidade = times × (jogadores de linha + 1 goleiro);
- excedentes nunca são descartados — vão para a fila;
- ordem da fila: mensalistas na frente, depois ordem de inscrição;
- cancelar uma presença promove automaticamente o primeiro da fila;
- promover alguém **não** refaz o sorteio.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.draws.services import execute_draw
from apps.matches.models import Confirmation, Match, WaitlistEntry
from apps.matches.services import (
    confirmed_confirmations,
    count_confirmed,
    get_match_capacity,
    set_all_confirmations,
    set_confirmation,
    waitlist_entries,
)
from apps.players.models import Player
from common.exceptions import DomainError, InsufficientPlayersError
from common.permissions import ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import MatchFactory, MembershipFactory, OrganizationFactory, PlayerFactory


def authenticated_client(user, organization=None):
    client = APIClient()
    access = str(RefreshToken.for_user(user).access_token)
    headers = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
    if organization is not None:
        headers["HTTP_X_ORGANIZATION_ID"] = str(organization.id)
    client.credentials(**headers)
    return client


def make_match(org, *, teams_count=2, line_per_team=6, min_players=2, goalkeepers=1):
    """Partida configurada no mesmo modelo mental da interface:
    `teams_count` times × (`line_per_team` de linha + `goalkeepers` goleiro).

    `goalkeepers=1` é explícito porque este módulo inteiro raciocina sobre a
    vaga de goleiro reservada; o **padrão do sistema** é 0 (o goleiro da pelada
    é fixo e não entra na conta) — ver `test_goalkeepers_per_team.py`."""
    return MatchFactory(
        organization=org,
        teams_count=teams_count,
        goalkeepers_per_team=goalkeepers,
        min_players=min_players,
        max_players=teams_count * (line_per_team + goalkeepers),
    )


def confirm(match, players):
    return [
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
        for player in players
    ]


# --- Capacidade -------------------------------------------------------------


@pytest.mark.django_db
def test_capacity_is_derived_from_match_configuration():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=6)

    capacity = get_match_capacity(match)

    assert capacity.teams_count == 2
    assert capacity.line_players_per_team == 6
    assert capacity.goalkeepers_per_team == 1
    assert capacity.total_goalkeepers == 2
    assert capacity.total_line_players == 12
    assert capacity.max_players == 14


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("teams_count", "line_per_team", "expected_max"),
    [(2, 6, 14), (3, 5, 18), (4, 4, 20)],
)
def test_capacity_for_two_three_and_four_teams(teams_count, line_per_team, expected_max):
    org = OrganizationFactory()
    match = make_match(org, teams_count=teams_count, line_per_team=line_per_team)

    assert get_match_capacity(match).max_players == expected_max


# --- Entrada na fila --------------------------------------------------------


@pytest.mark.django_db
def test_confirming_beyond_capacity_sends_player_to_waitlist():
    """Cenário exato do pedido: 2 times × 6 de linha + 1 goleiro = 14 vagas.
    Com 16 confirmando, 14 entram e 2 ficam na espera."""
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=6)
    players = [PlayerFactory(organization=org) for _ in range(16)]

    outcomes = confirm(match, players)

    assert count_confirmed(match) == 14
    assert [o.waitlisted for o in outcomes].count(True) == 2
    assert list(waitlist_entries(match).values_list("position", flat=True)) == [1, 2]
    assert [entry.player_id for entry in waitlist_entries(match)] == [
        players[14].id,
        players[15].id,
    ]


@pytest.mark.django_db
def test_waitlist_keeps_registration_order():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1)  # 4 vagas
    players = [PlayerFactory(organization=org) for _ in range(7)]

    confirm(match, players)

    assert [entry.player_id for entry in waitlist_entries(match)] == [
        players[4].id,
        players[5].id,
        players[6].id,
    ]


@pytest.mark.django_db
def test_mensalista_jumps_ahead_of_convidados_in_the_waitlist():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1)  # 4 vagas
    titulares = [PlayerFactory(organization=org) for _ in range(4)]
    convidado_a = PlayerFactory(organization=org, player_type=Player.PlayerType.CONVIDADO)
    convidado_b = PlayerFactory(organization=org, player_type=Player.PlayerType.CONVIDADO)
    mensalista_atrasado = PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA)

    confirm(match, titulares)
    confirm(match, [convidado_a, convidado_b, mensalista_atrasado])

    assert [entry.player_id for entry in waitlist_entries(match)] == [
        mensalista_atrasado.id,
        convidado_a.id,
        convidado_b.id,
    ]


@pytest.mark.django_db
def test_exact_capacity_does_not_create_a_waitlist():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=6)
    players = [PlayerFactory(organization=org) for _ in range(14)]

    confirm(match, players)

    assert count_confirmed(match) == 14
    assert waitlist_entries(match).count() == 0


# --- Promoção ---------------------------------------------------------------


@pytest.mark.django_db
def test_declining_a_confirmation_promotes_the_first_in_line():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1)  # 4 vagas
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm(match, players)
    esperando = players[4]

    outcome = set_confirmation(match=match, player=players[0], status=Confirmation.Status.DECLINED)

    assert [player.id for player in outcome.promoted] == [esperando.id]
    assert count_confirmed(match) == 4
    assert [entry.player_id for entry in waitlist_entries(match)] == [players[5].id]
    assert waitlist_entries(match).first().position == 1


@pytest.mark.django_db
def test_manual_promotion_requires_an_open_slot():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm(match, players)

    client_error = None
    try:
        from apps.matches.services import promote_from_waitlist

        promote_from_waitlist(match=match, player=players[4])
    except DomainError as error:
        client_error = error

    assert client_error is not None
    assert count_confirmed(match) == 4


@pytest.mark.django_db
def test_promotion_does_not_redraw_the_teams():
    """Decisão de produto: promover alguém da fila não reescreve times já
    divulgados — o organizador aciona "Sortear novamente" quando quiser."""
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1, min_players=4)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm(match, players)
    draw = execute_draw(match=match)

    set_confirmation(match=match, player=players[0], status=Confirmation.Status.DECLINED)

    assert match.draws.filter(is_current=True).count() == 1
    assert match.draws.get(is_current=True).id == draw.id


# --- Sorteio ----------------------------------------------------------------


@pytest.mark.django_db
def test_draw_never_exceeds_configured_capacity():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=6, min_players=4)
    players = [PlayerFactory(organization=org) for _ in range(16)]
    confirm(match, players)

    draw = execute_draw(match=match)

    total_drawn = sum(team.team_players.count() for team in draw.teams.all())
    assert total_drawn == 14
    assert draw.teams.count() == 2
    assert waitlist_entries(match).count() == 2


@pytest.mark.django_db
def test_draw_moves_legacy_overflow_to_the_waitlist_without_discarding():
    """Dados legados (confirmados acima do teto, gravados antes da fila
    existir) são reorganizados no momento do sorteio, sem perder ninguém."""
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1, min_players=4)  # 4 vagas
    players = [PlayerFactory(organization=org) for _ in range(6)]
    # Confirmação direta, sem passar pelo controle de capacidade.
    for player in players:
        set_confirmation(
            match=match, player=player, status=Confirmation.Status.CONFIRMED, allow_waitlist=False
        )
    assert count_confirmed(match) == 6

    draw = execute_draw(match=match)

    assert sum(team.team_players.count() for team in draw.teams.all()) == 4
    assert waitlist_entries(match).count() == 2


@pytest.mark.django_db
def test_draw_still_requires_the_minimum():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=6, min_players=10)
    confirm(match, [PlayerFactory(organization=org) for _ in range(4)])

    with pytest.raises(InsufficientPlayersError):
        execute_draw(match=match)


@pytest.mark.django_db
def test_inactive_and_deleted_players_never_reach_the_draw():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=6, min_players=4)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm(match, players)

    players[0].status = Player.Status.INATIVO
    players[0].save(update_fields=["status"])
    players[1].delete()  # soft-delete

    draw = execute_draw(match=match)
    drawn_ids = {
        team_player.player_id for team in draw.teams.all() for team_player in team.team_players.all()
    }

    assert players[0].id not in drawn_ids
    assert players[1].id not in drawn_ids
    assert len(drawn_ids) == 4


@pytest.mark.django_db
def test_confirming_an_inactive_player_is_rejected():
    org = OrganizationFactory()
    match = make_match(org)
    player = PlayerFactory(organization=org, status=Player.Status.INATIVO)

    with pytest.raises(DomainError):
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)


# --- Operações em lote ------------------------------------------------------


@pytest.mark.django_db
def test_confirm_all_respects_capacity_and_fills_the_waitlist():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1)  # 4 vagas
    for _ in range(7):
        PlayerFactory(organization=org)

    result = set_all_confirmations(match=match, status=Confirmation.Status.CONFIRMED)

    assert result.confirmed == 4
    assert result.waitlisted == 3
    assert count_confirmed(match) == 4


@pytest.mark.django_db
def test_confirm_all_fills_slots_with_mensalistas_first():
    """Com mais jogadores do que vagas, quem entra em campo segue a mesma
    prioridade da fila. (Ordenar por `player_type` no banco fazia o oposto:
    "convidado" vem antes de "mensalista" no alfabeto.)"""
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1)  # 4 vagas
    mensalistas = [
        PlayerFactory(organization=org, player_type=Player.PlayerType.MENSALISTA) for _ in range(4)
    ]
    convidados = [
        PlayerFactory(organization=org, player_type=Player.PlayerType.CONVIDADO) for _ in range(3)
    ]

    set_all_confirmations(match=match, status=Confirmation.Status.CONFIRMED)

    confirmed_ids = {c.player_id for c in confirmed_confirmations(match)}
    assert confirmed_ids == {player.id for player in mensalistas}
    assert [entry.player_id for entry in waitlist_entries(match)] == [p.id for p in convidados]


@pytest.mark.django_db
def test_clearing_all_confirmations_empties_the_waitlist():
    org = OrganizationFactory()
    match = make_match(org, teams_count=2, line_per_team=1)
    for _ in range(7):
        PlayerFactory(organization=org)
    set_all_confirmations(match=match, status=Confirmation.Status.CONFIRMED)

    set_all_confirmations(match=match, status=Confirmation.Status.DECLINED)

    assert count_confirmed(match) == 0
    assert waitlist_entries(match).count() == 0


# --- API --------------------------------------------------------------------


@pytest.mark.django_db
def test_waitlist_endpoints_reorder_and_remove():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = make_match(org, teams_count=2, line_per_team=1)
    players = [PlayerFactory(organization=org) for _ in range(7)]
    confirm(match, players)
    client = authenticated_client(membership.user, organization=org)

    listing = client.get(f"/api/matches/{match.id}/waitlist/")
    assert listing.status_code == 200
    assert [entry["player_id"] for entry in listing.json()] == [p.id for p in players[4:]]

    moved = client.post(
        f"/api/matches/{match.id}/waitlist/move/",
        {"player": players[6].id, "position": 1},
        format="json",
    )
    assert [entry["player_id"] for entry in moved.json()] == [
        players[6].id,
        players[4].id,
        players[5].id,
    ]

    removed = client.post(
        f"/api/matches/{match.id}/waitlist/remove/",
        {"player": players[4].id},
        format="json",
    )
    assert [entry["player_id"] for entry in removed.json()] == [players[6].id, players[5].id]
    assert [entry["position"] for entry in removed.json()] == [1, 2]


@pytest.mark.django_db
def test_set_confirmation_endpoint_reports_waitlisting():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = make_match(org, teams_count=2, line_per_team=1)
    players = [PlayerFactory(organization=org) for _ in range(5)]
    confirm(match, players[:4])
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        f"/api/matches/{match.id}/set-confirmation/",
        {"player": players[4].id, "status": "confirmed"},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["waitlisted"] is True
    assert response.json()["waitlist_position"] == 1
    assert response.json()["confirmed_count"] == 4


@pytest.mark.django_db
def test_match_payload_exposes_capacity_and_waitlist_count():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = make_match(org, teams_count=3, line_per_team=5)  # 18 vagas
    players = [PlayerFactory(organization=org) for _ in range(20)]
    confirm(match, players)
    client = authenticated_client(membership.user, organization=org)

    payload = client.get(f"/api/matches/{match.id}/").json()

    assert payload["capacity"]["teams_count"] == 3
    assert payload["capacity"]["line_players_per_team"] == 5
    assert payload["capacity"]["total_goalkeepers"] == 3
    assert payload["capacity"]["max_players"] == 18
    assert payload["confirmed_count"] == 18
    assert payload["waitlist_count"] == 2


@pytest.mark.django_db
def test_visualizador_cannot_change_the_waitlist():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    match = make_match(org, teams_count=2, line_per_team=1)
    players = [PlayerFactory(organization=org) for _ in range(6)]
    confirm(match, players)
    client = authenticated_client(membership.user, organization=org)

    assert client.get(f"/api/matches/{match.id}/waitlist/").status_code == 200
    assert (
        client.post(
            f"/api/matches/{match.id}/waitlist/remove/", {"player": players[4].id}, format="json"
        ).status_code
        == 403
    )


@pytest.mark.django_db
def test_waitlist_is_isolated_between_organizations():
    org = OrganizationFactory()
    other_org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = make_match(org, teams_count=2, line_per_team=1)
    confirm(match, [PlayerFactory(organization=org) for _ in range(6)])
    intruder = PlayerFactory(organization=other_org)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        f"/api/matches/{match.id}/waitlist/remove/", {"player": intruder.id}, format="json"
    )

    assert response.status_code == 400
    assert WaitlistEntry.objects.filter(match=match).count() == 2


@pytest.mark.django_db
def test_canceled_match_is_not_recreated_and_can_be_reactivated():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = make_match(org)
    client = authenticated_client(membership.user, organization=org)

    canceled = client.post(f"/api/matches/{match.id}/cancel/")
    assert canceled.status_code == 200
    assert canceled.json()["status"] == Match.Status.CANCELED

    reactivated = client.post(f"/api/matches/{match.id}/reactivate/")
    assert reactivated.json()["status"] == Match.Status.SCHEDULED
