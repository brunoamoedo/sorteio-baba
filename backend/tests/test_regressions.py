"""Regressões corrigidas na auditoria (ver docs/AUDITORIA_BUGS.md).

Cada teste aqui trava um bug específico que já chegou a acontecer em produção
ou estava latente no código.
"""
import datetime

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.draws.services import execute_draw, move_player_to_team
from apps.draws.tasks import auto_draw_tick
from apps.matches.models import Confirmation, Match
from apps.matches.services import ensure_next_match, quick_confirm_names, set_confirmation
from apps.players.models import Player, Position
from apps.players.services import seed_default_positions
from common.exceptions import DomainError
from common.permissions import ROLE_ORGANIZADOR

from .factories import (
    MatchFactory,
    MembershipFactory,
    OrganizationFactory,
    PlayerFactory,
    RecurringGameFactory,
    match_time_still_ahead,
)


def authenticated_client(user, organization=None):
    client = APIClient()
    access = str(RefreshToken.for_user(user).access_token)
    headers = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
    if organization is not None:
        headers["HTTP_X_ORGANIZATION_ID"] = str(organization.id)
    client.credentials(**headers)
    return client


# --- B4: POST de jogo recorrente sem campos opcionais retornava 500 ----------


@pytest.mark.django_db
def test_creating_recurring_game_without_optional_fields_uses_model_defaults():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/recurring-games/",
        {"name": "Quarta", "weekday": 2, "match_time": "21:00", "draw_time": "20:30"},
        format="json",
    )

    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["teams_count"] == 2
    assert body["goalkeepers_per_team"] == 0  # padrão: goleiro fixo, fora da conta
    assert body["max_players"] == 2 * (8 + 0)


# --- B5: o corpo de erro do DRF não pode ser re-embrulhado ------------------


@pytest.mark.django_db
def test_validation_errors_keep_their_field_names():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(
        "/api/recurring-games/",
        {"name": "Solo", "weekday": 2, "match_time": "21:00", "draw_time": "20:30", "teams_count": 1},
        format="json",
    )

    assert response.status_code == 400
    # O erro chega no campo, não aninhado em {"detail": {...}}.
    assert "teams_count" in response.json()
    assert "detail" not in response.json()


# --- B7: convidado criado pela lista de nomes não pode virar atacante -------


@pytest.mark.django_db
def test_guest_created_by_name_matching_gets_a_line_position_not_the_last_one():
    org = OrganizationFactory()
    seed_default_positions(org)
    match = MatchFactory(organization=org, teams_count=2, min_players=2, max_players=20)

    results = quick_confirm_names(match=match, raw_names=["Zé da Padaria"])

    guest = Player.objects.get(id=results[0]["player_id"])
    assert guest.player_type == Player.PlayerType.CONVIDADO
    assert guest.primary_position.code != "GOL"
    # A última posição do seed é AT — era ela que o código antigo escolhia.
    assert guest.primary_position.code != "AT"
    assert guest.primary_position == Position.objects.filter(organization=org).order_by("sort_order")[1]


# --- B8: partida removida/cancelada não pode ser recriada pela task ---------


@pytest.mark.django_db
def test_removed_recurring_match_is_not_recreated_by_the_generator():
    org = OrganizationFactory()
    recurring_game = RecurringGameFactory(organization=org)

    first = ensure_next_match(recurring_game)
    assert first is not None
    first.delete()  # soft-delete

    assert ensure_next_match(recurring_game) is None
    assert Match.objects.filter(recurring_game=recurring_game).count() == 0


@pytest.mark.django_db
def test_canceled_match_does_not_auto_draw():
    org = OrganizationFactory()
    match = MatchFactory(
        organization=org,
        scheduled_date=datetime.date.today(),
        draw_time=datetime.time(0, 0),
        min_players=2,
        max_players=20,
        status=Match.Status.CANCELED,
    )
    for player in [PlayerFactory(organization=org) for _ in range(4)]:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    assert auto_draw_tick() == 0


# --- R5: criar jogo recorrente precisa gerar a partida na hora ---------------


@pytest.mark.django_db
def test_creating_recurring_game_generates_its_next_match_immediately():
    """Antes, a geração dependia só da task periódica (de hora em hora): o
    organizador cadastrava a pelada e não via partida nenhuma."""
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)
    today = datetime.date.today()

    # O horário precisa estar **à frente de agora** para a ocorrência de hoje
    # valer como "a próxima" (§4). Com um horário fixo, este teste passava de
    # manhã e falhava à noite — a suíte é que dependia da hora, não o código.
    response = client.post(
        "/api/recurring-games/",
        {
            "name": "Pelada de hoje",
            "weekday": today.weekday(),  # o mesmo dia da semana de hoje
            "match_time": match_time_still_ahead().strftime("%H:%M"),
            "draw_time": "00:01",
        },
        format="json",
    )

    assert response.status_code == 201
    match = Match.objects.get(recurring_game_id=response.json()["id"])
    assert match.scheduled_date == today


@pytest.mark.django_db
def test_reactivating_a_recurring_game_generates_its_next_match():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    recurring_game = RecurringGameFactory(
        organization=org, weekday=datetime.date.today().weekday(), is_active=False
    )
    client = authenticated_client(membership.user, organization=org)

    assert Match.objects.filter(recurring_game=recurring_game).count() == 0

    client.patch(f"/api/recurring-games/{recurring_game.id}/", {"is_active": True}, format="json")

    assert Match.objects.filter(recurring_game=recurring_game).count() == 1


@pytest.mark.django_db
def test_generate_match_action_revives_a_removed_occurrence_with_its_history():
    """A geração automática respeita a remoção (B8). A ação explícita reabre a
    mesma partida — preservando id, confirmações e sorteios."""
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    recurring_game = RecurringGameFactory(
        organization=org, weekday=datetime.date.today().weekday()
    )
    original = ensure_next_match(recurring_game)
    player = PlayerFactory(organization=org)
    set_confirmation(match=original, player=player, status=Confirmation.Status.CONFIRMED)
    original.delete()

    # Automático continua respeitando a remoção.
    assert ensure_next_match(recurring_game) is None

    client = authenticated_client(membership.user, organization=org)
    response = client.post(f"/api/recurring-games/{recurring_game.id}/generate-match/")

    assert response.status_code == 200
    assert response.json()["id"] == original.id  # mesma partida, não uma duplicata
    assert Match.objects.filter(recurring_game=recurring_game).count() == 1
    assert response.json()["confirmed_count"] == 1  # confirmação preservada


@pytest.mark.django_db
def test_generate_match_action_ignores_the_generation_window():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    # Ocorrência daqui a vários dias, com antecedência mínima: a task não geraria.
    recurring_game = RecurringGameFactory(
        organization=org,
        weekday=(datetime.date.today().weekday() + 4) % 7,
        days_before_to_generate=1,
    )
    assert ensure_next_match(recurring_game) is None

    client = authenticated_client(membership.user, organization=org)
    response = client.post(f"/api/recurring-games/{recurring_game.id}/generate-match/")

    assert response.status_code == 200
    assert Match.objects.filter(recurring_game=recurring_game).count() == 1


@pytest.mark.django_db
def test_visualizador_cannot_generate_a_match():
    from common.permissions import ROLE_VISUALIZADOR

    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    recurring_game = RecurringGameFactory(organization=org)
    client = authenticated_client(membership.user, organization=org)

    assert (
        client.post(f"/api/recurring-games/{recurring_game.id}/generate-match/").status_code == 403
    )


# --- R8: alterar o jogo recorrente e a partida já gerada ---------------------
#
# A regra mudou: a partida futura ainda **sincronizável** (sem sorteio, não
# cancelada/concluída) passou a acompanhar a nova configuração automaticamente,
# em vez de só exibir o aviso vermelho — ver `test_recurring_game_sync.py`.
# O aviso continua existindo e é justamente o que estes testes cobrem: ele
# sobrevive para o que a sincronização **não** pode tocar (a data/dia da semana,
# e qualquer partida já sorteada).


@pytest.mark.django_db
def test_changing_the_weekday_syncs_the_config_but_still_flags_the_date():
    """Editar o jogo recorrente alinha horário/times na partida futura, mas
    **não** move a data: quem confirmou, confirmou para aquele dia. Só a
    divergência de dia da semana permanece."""
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    today = datetime.date.today()
    recurring_game = RecurringGameFactory(
        organization=org, weekday=today.weekday(), match_time=datetime.time(21, 0), teams_count=2
    )
    match = ensure_next_match(recurring_game)
    assert match.recurring_game_divergences == []
    original_date = match.scheduled_date

    client = authenticated_client(membership.user, organization=org)
    client.patch(
        f"/api/recurring-games/{recurring_game.id}/",
        {"weekday": (today.weekday() + 2) % 7, "match_time": "19:30", "teams_count": 3},
        format="json",
    )

    match.refresh_from_db()
    # Configuração alinhada...
    assert match.teams_count == 3
    assert match.scheduled_time == datetime.time(19, 30)
    # ...data preservada, e é a única divergência que sobra.
    assert match.scheduled_date == original_date
    assert {d["field"] for d in match.recurring_game_divergences} == {"weekday"}

    payload = client.get(f"/api/matches/{match.id}/").json()
    divergences = {d["field"]: d for d in payload["recurring_game_divergences"]}
    assert divergences["weekday"]["match_value"] != divergences["weekday"]["recurring_game_value"]


@pytest.mark.django_db
def test_drawn_match_keeps_reporting_divergence():
    """Partida já sorteada não é sincronizada (os times foram montados com
    aquela configuração) — para ela o aviso vermelho continua sendo o
    mecanismo."""
    org = OrganizationFactory()
    recurring_game = RecurringGameFactory(
        organization=org,
        weekday=datetime.date.today().weekday(),
        teams_count=2,
        min_players_per_team_line=4,
        max_players_per_team_line=9,
    )
    match = ensure_next_match(recurring_game)
    for _ in range(10):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    execute_draw(match=match)

    recurring_game.teams_count = 4
    recurring_game.save()

    match.refresh_from_db()
    assert match.teams_count == 2
    assert "teams_count" in {d["field"] for d in match.recurring_game_divergences}


@pytest.mark.django_db
def test_standalone_and_finished_matches_never_report_divergence():
    org = OrganizationFactory()
    avulsa = MatchFactory(organization=org)
    assert avulsa.recurring_game_divergences == []

    recurring_game = RecurringGameFactory(
        organization=org, weekday=datetime.date.today().weekday(), teams_count=2
    )
    match = ensure_next_match(recurring_game)
    # Concluída sai do alcance da sincronização; divergir de uma config alterada
    # depois é o esperado e não deve virar ruído na tela.
    match.status = Match.Status.COMPLETED
    match.save(update_fields=["status"])

    recurring_game.teams_count = 4
    recurring_game.save()

    match.refresh_from_db()
    assert match.teams_count == 2
    assert match.recurring_game_divergences == []


@pytest.mark.django_db
def test_past_matches_do_not_report_divergence():
    org = OrganizationFactory()
    recurring_game = RecurringGameFactory(organization=org, teams_count=2)
    past = MatchFactory(
        organization=org,
        recurring_game=recurring_game,
        scheduled_date=datetime.date.today() - datetime.timedelta(days=7),
        teams_count=2,
    )
    recurring_game.teams_count = 4
    recurring_game.save()

    past.refresh_from_db()
    assert past.recurring_game_divergences == []


# --- B9: sorteio automático não pode depender do minuto exato ---------------


@pytest.mark.django_db
def test_auto_draw_still_runs_after_the_exact_minute_has_passed(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 24 * 60
    org = OrganizationFactory()
    match = MatchFactory(
        organization=org,
        scheduled_date=datetime.date.today(),
        # Horário bem no início do dia: o minuto exato certamente já passou.
        draw_time=datetime.time(0, 0),
        teams_count=2,
        min_players=2,
        max_players=20,
    )
    for player in [PlayerFactory(organization=org) for _ in range(4)]:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    assert auto_draw_tick() == 1
    match.refresh_from_db()
    assert match.status == Match.Status.DRAWN
    # Idempotente: a segunda passagem não sorteia de novo.
    assert auto_draw_tick() == 0


@pytest.mark.django_db
def test_auto_draw_ignores_matches_outside_the_grace_window(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 1
    org = OrganizationFactory()
    match = MatchFactory(
        organization=org,
        scheduled_date=datetime.date.today(),
        draw_time=datetime.time(0, 0),
        min_players=2,
        max_players=20,
    )
    for player in [PlayerFactory(organization=org) for _ in range(4)]:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    assert auto_draw_tick() == 0
    match.refresh_from_db()
    assert match.status == Match.Status.SCHEDULED


# --- B12: histórico de sorteio é imutável -----------------------------------


@pytest.mark.django_db
def test_historic_draw_cannot_be_edited():
    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=20)
    for player in [PlayerFactory(organization=org) for _ in range(6)]:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    old_draw = execute_draw(match=match)
    execute_draw(match=match)  # "Sortear novamente" — old_draw vira histórico
    old_draw.refresh_from_db()

    team_player = old_draw.teams.first().team_players.first()
    other_team = old_draw.teams.last()

    with pytest.raises(DomainError):
        move_player_to_team(
            draw=old_draw, team_player_id=team_player.id, target_team_id=other_team.id
        )


# --- B13: dashboard não pode perder a partida do dia depois do sorteio ------


@pytest.mark.django_db
def test_dashboard_keeps_showing_the_match_after_it_is_drawn():
    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=20)
    for player in [PlayerFactory(organization=org) for _ in range(6)]:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
    execute_draw(match=match)

    client = authenticated_client(membership.user, organization=org)
    summary = client.get("/api/dashboard/summary/").json()

    assert summary["next_match"] is not None
    assert summary["next_match"]["id"] == match.id
    assert summary["next_match"]["status"] == Match.Status.DRAWN


# --- B14: o sorteio sendo substituído não pode contaminar o histórico -------


@pytest.mark.django_db
def test_redraw_does_not_penalise_pairs_from_the_draw_it_replaces():
    from apps.draws.repositories import PairHistoryRepository

    org = OrganizationFactory()
    match = MatchFactory(organization=org, teams_count=2, min_players=4, max_players=20)
    for player in [PlayerFactory(organization=org) for _ in range(6)]:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
    execute_draw(match=match)

    history = PairHistoryRepository.compute(organization=org, window=10, exclude_match=match)

    assert history == {}


# --- B16: slugs de organizações homônimas ----------------------------------


@pytest.mark.django_db
def test_duplicate_organization_names_get_sequential_slugs():
    first = OrganizationFactory(name="Pelada do Bairro")
    second = OrganizationFactory(name="Pelada do Bairro")
    third = OrganizationFactory(name="Pelada do Bairro")

    assert first.slug == "pelada-do-bairro"
    assert second.slug == "pelada-do-bairro-2"
    assert third.slug == "pelada-do-bairro-3"
