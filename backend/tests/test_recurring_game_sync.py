"""Alterar um jogo recorrente e refletir a mudança nas partidas futuras.

Causa raiz do problema relatado: `ensure_next_match` devolvia a partida futura
**já existente** sem nenhuma verificação de configuração. Como a partida é
gerada assim que o jogo recorrente é criado, editar o jogo e clicar em "Gerar a
próxima partida agora" caía sempre nesse atalho: nenhuma partida nova era
criada e a existente — montada com a configuração antiga — voltava intacta.

Não era cache, nem estado do frontend, nem objeto velho em memória: era o
retorno antecipado de um registro anterior à edição.
"""

import datetime

import pytest
from django.utils import timezone

from apps.draws.services import execute_draw
from apps.matches.models import Confirmation, Match, RecurringGame
from apps.matches.services import (
    count_confirmed,
    ensure_next_match,
    set_confirmation,
    sync_future_matches,
    waitlist_entries,
)
from common.permissions import ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import (
    MembershipFactory,
    OrganizationFactory,
    PlayerFactory,
    match_time_still_ahead,
)
from .test_matches import authenticated_client


def _recurring_game(org, **overrides):
    defaults = {
        "organization": org,
        "name": "Pelada da Terça",
        # A ocorrência cai sempre no futuro (amanhã), que é o caso real: a
        # partida já foi gerada e ainda vai acontecer.
        "weekday": (timezone.localdate() + datetime.timedelta(days=1)).weekday(),
        "match_time": match_time_still_ahead(),
        "draw_time": datetime.time(0, 1),
        "teams_count": 2,
        "min_players_per_team_line": 4,
        "max_players_per_team_line": 6,
        "goalkeepers_per_team": 1,
    }
    return RecurringGame.objects.create(**{**defaults, **overrides})


def _organizer_client(org):
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    return authenticated_client(membership.user, organization=org)


# ---------------------------------------------------------------------------
# O cenário relatado
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_generate_button_returns_match_with_the_current_configuration():
    """Editar o jogo recorrente e clicar em "Gerar a próxima partida agora"
    devolve a partida com a configuração **nova**, não a de antes da edição."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)

    assert (match.teams_count, match.goalkeepers_per_team) == (2, 1)
    assert (match.min_players, match.max_players) == (10, 14)

    recurring_game.teams_count = 3
    recurring_game.goalkeepers_per_team = 0
    recurring_game.min_players_per_team_line = 5
    recurring_game.max_players_per_team_line = 7
    recurring_game.match_time = datetime.time(19, 45)
    recurring_game.save()

    regenerated = ensure_next_match(recurring_game, force=True)

    assert regenerated.id == match.id  # continua sendo a mesma ocorrência
    assert regenerated.teams_count == 3
    assert regenerated.goalkeepers_per_team == 0
    assert regenerated.min_players == 15
    assert regenerated.max_players == 21
    assert regenerated.scheduled_time == datetime.time(19, 45)
    assert regenerated.recurring_game_divergences == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("teams_count", 4, {"teams_count": 4, "min_players": 20, "max_players": 28}),
        ("min_players_per_team_line", 2, {"min_players": 6}),
        ("max_players_per_team_line", 9, {"max_players": 20}),
        ("goalkeepers_per_team", 0, {"goalkeepers_per_team": 0, "min_players": 8, "max_players": 12}),
        ("match_time", datetime.time(18, 15), {"scheduled_time": datetime.time(18, 15)}),
    ],
)
def test_every_configuration_field_reaches_the_future_match(field, value, expected):
    """Um teste por campo editável, para não sobrar nenhuma divergência."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)

    setattr(recurring_game, field, value)
    recurring_game.save()
    match = ensure_next_match(recurring_game, force=True)

    for attribute, expected_value in expected.items():
        assert getattr(match, attribute) == expected_value, attribute
    assert match.recurring_game_divergences == []


@pytest.mark.django_db
def test_saving_the_recurring_game_through_the_api_syncs_without_pressing_generate():
    """A sincronização não depende do botão: salvar a edição já alinha as
    partidas futuras."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)
    client = _organizer_client(org)

    response = client.patch(
        f"/api/recurring-games/{recurring_game.id}/",
        {"teams_count": 3, "goalkeepers_per_team": 0, "max_players_per_team_line": 6},
        format="json",
    )

    assert response.status_code == 200
    match.refresh_from_db()
    assert match.teams_count == 3
    assert match.goalkeepers_per_team == 0
    assert match.max_players == 18


# ---------------------------------------------------------------------------
# O que a sincronização NÃO pode atropelar
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_already_drawn_match_keeps_its_configuration_and_shows_divergence():
    """Partida já sorteada é intocável: os times foram montados com aquela
    configuração. Ela continua avisando a divergência em vermelho."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)
    for _ in range(10):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    execute_draw(match=match)

    recurring_game.teams_count = 4
    recurring_game.save()
    match.refresh_from_db()

    assert match.teams_count == 2
    fields = {d["field"] for d in match.recurring_game_divergences}
    assert "teams_count" in fields


@pytest.mark.django_db
def test_past_and_finished_matches_are_never_touched():
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    yesterday = timezone.localdate() - datetime.timedelta(days=1)
    past = Match.objects.create(
        organization=org,
        recurring_game=recurring_game,
        scheduled_date=yesterday,
        scheduled_time=datetime.time(21, 0),
        teams_count=2,
        goalkeepers_per_team=1,
        min_players=10,
        max_players=14,
        status=Match.Status.COMPLETED,
    )

    recurring_game.teams_count = 3
    recurring_game.save()
    past.refresh_from_db()

    assert past.teams_count == 2


@pytest.mark.django_db
def test_canceled_future_match_is_not_synced():
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)
    Match.objects.filter(pk=match.pk).update(status=Match.Status.CANCELED)

    recurring_game.teams_count = 3
    recurring_game.save()
    match.refresh_from_db()

    assert match.teams_count == 2


@pytest.mark.django_db
def test_the_match_date_is_never_moved_by_a_weekday_change():
    """Mudar o dia da semana **não** arrasta a partida já gerada: as pessoas
    confirmaram para aquela data. A divergência é sinalizada e o organizador
    decide."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)
    original_date = match.scheduled_date

    recurring_game.weekday = (recurring_game.weekday + 2) % 7
    recurring_game.save()
    match.refresh_from_db()

    assert match.scheduled_date == original_date
    assert "weekday" in {d["field"] for d in match.recurring_game_divergences}


# ---------------------------------------------------------------------------
# Reconciliação da lotação depois da mudança de capacidade
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_shrinking_capacity_moves_the_excess_to_the_waitlist():
    """Diminuir a capacidade não descarta ninguém: o excedente vai para a fila
    na mesma hora, em vez de estourar o teto silenciosamente até o sorteio."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)
    for _ in range(14):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    assert count_confirmed(match) == 14

    recurring_game.max_players_per_team_line = 4
    recurring_game.save()
    match.refresh_from_db()

    assert match.max_players == 10
    assert count_confirmed(match) == 10
    assert waitlist_entries(match).count() == 4


@pytest.mark.django_db
def test_growing_capacity_promotes_from_the_waitlist():
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)
    for _ in range(16):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    assert count_confirmed(match) == 14
    assert waitlist_entries(match).count() == 2

    recurring_game.max_players_per_team_line = 8
    recurring_game.save()
    match.refresh_from_db()

    assert match.max_players == 18
    assert count_confirmed(match) == 16
    assert waitlist_entries(match).count() == 0


# ---------------------------------------------------------------------------
# Idempotência e permissões
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_syncing_twice_changes_nothing_and_creates_no_duplicate():
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    ensure_next_match(recurring_game, force=True)

    # `queryset.update()` não dispara `post_save` — é o único caminho de escrita
    # que escapa do sinal, e serve aqui para deixar a partida desalinhada de
    # propósito e exercitar `sync_future_matches` diretamente.
    RecurringGame.objects.filter(pk=recurring_game.pk).update(teams_count=3)
    recurring_game.refresh_from_db()

    assert sync_future_matches(recurring_game) == 1
    assert sync_future_matches(recurring_game) == 0
    assert sync_future_matches(recurring_game) == 0
    assert Match.objects.filter(recurring_game=recurring_game).count() == 1


@pytest.mark.django_db
def test_saving_the_recurring_game_by_any_path_syncs():
    """O realinhamento mora num sinal `post_save`, não na view: shell, admin,
    seed e scripts seguem a mesma regra que a API."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    match = ensure_next_match(recurring_game, force=True)

    recurring_game.teams_count = 3
    recurring_game.save()  # caminho de ORM puro, sem passar por nenhuma rota
    match.refresh_from_db()

    assert match.teams_count == 3
    assert match.recurring_game_divergences == []


@pytest.mark.django_db
def test_pressing_generate_repeatedly_never_duplicates_the_occurrence():
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    client = _organizer_client(org)

    ids = {
        client.post(f"/api/recurring-games/{recurring_game.id}/generate-match/").json()["id"]
        for _ in range(4)
    }

    assert len(ids) == 1
    assert Match.objects.filter(recurring_game=recurring_game).count() == 1


@pytest.mark.django_db
def test_visualizador_still_cannot_generate():
    org = OrganizationFactory()
    recurring_game = _recurring_game(org)
    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    client = authenticated_client(membership.user, organization=org)

    response = client.post(f"/api/recurring-games/{recurring_game.id}/generate-match/")

    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Ocorrência já sorteada não pode travar a geração da seguinte
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_generate_creates_the_next_occurrence_when_the_current_one_is_drawn():
    """O caso relatado: a partida da semana já foi sorteada, o organizador edita
    a recorrência e clica em "Gerar a próxima partida agora".

    A partida sorteada não pode ser realinhada (os times já foram montados com
    a configuração dela), então o botão precisa criar a **seguinte** — com a
    configuração nova. Antes ele devolvia justamente a partida velha."""
    org = OrganizationFactory()
    today = timezone.localdate()
    recurring_game = _recurring_game(org, weekday=today.weekday())
    atual = ensure_next_match(recurring_game, force=True)
    assert atual.scheduled_date == today

    for _ in range(10):
        set_confirmation(
            match=atual, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    execute_draw(match=atual)

    recurring_game.teams_count = 3
    recurring_game.goalkeepers_per_team = 0
    recurring_game.match_time = datetime.time(19, 0)
    recurring_game.save()

    proxima = ensure_next_match(recurring_game, force=True)

    assert proxima.id != atual.id
    assert proxima.scheduled_date == today + datetime.timedelta(days=7)
    assert proxima.teams_count == 3
    assert proxima.goalkeepers_per_team == 0
    assert proxima.scheduled_time == datetime.time(19, 0)
    assert proxima.max_players == 18
    assert proxima.recurring_game_divergences == []

    # A partida sorteada continua intacta, com a configuração dela.
    atual.refresh_from_db()
    assert atual.teams_count == 2
    assert atual.has_draw


@pytest.mark.django_db
@pytest.mark.parametrize(
    "status", [Match.Status.COMPLETED, Match.Status.CANCELED, Match.Status.IN_PROGRESS]
)
def test_generate_advances_past_any_spent_occurrence(status):
    org = OrganizationFactory()
    today = timezone.localdate()
    recurring_game = _recurring_game(org, weekday=today.weekday())
    atual = ensure_next_match(recurring_game, force=True)
    Match.objects.filter(pk=atual.pk).update(status=status)

    proxima = ensure_next_match(recurring_game, force=True)

    assert proxima.id != atual.id
    assert proxima.scheduled_date == today + datetime.timedelta(days=7)


@pytest.mark.django_db
def test_generate_does_not_duplicate_an_open_upcoming_match():
    """A trava contra duplicata continua valendo para a ocorrência ainda aberta:
    só a gasta libera a geração da seguinte."""
    org = OrganizationFactory()
    today = timezone.localdate()
    recurring_game = _recurring_game(org, weekday=today.weekday())

    primeira = ensure_next_match(recurring_game, force=True)
    for _ in range(3):
        assert ensure_next_match(recurring_game, force=True).id == primeira.id
    assert Match.objects.filter(recurring_game=recurring_game).count() == 1


@pytest.mark.django_db
def test_pressing_generate_twice_after_a_draw_creates_only_one_next_match():
    org = OrganizationFactory()
    today = timezone.localdate()
    recurring_game = _recurring_game(org, weekday=today.weekday())
    atual = ensure_next_match(recurring_game, force=True)
    for _ in range(10):
        set_confirmation(
            match=atual, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    execute_draw(match=atual)

    primeira = ensure_next_match(recurring_game, force=True)
    segunda = ensure_next_match(recurring_game, force=True)

    assert primeira.id == segunda.id
    assert Match.objects.filter(recurring_game=recurring_game).count() == 2


@pytest.mark.django_db
def test_the_periodic_task_still_waits_for_the_day_to_pass():
    """A geração automática **não** muda: uma partida sorteada hoje não faz a
    task criar a da semana seguinte antes da hora. Só o botão explícito avança."""
    org = OrganizationFactory()
    today = timezone.localdate()
    recurring_game = _recurring_game(org, weekday=today.weekday())
    atual = ensure_next_match(recurring_game, force=True)
    Match.objects.filter(pk=atual.pk).update(status=Match.Status.DRAWN)

    assert ensure_next_match(recurring_game).id == atual.id
    assert Match.objects.filter(recurring_game=recurring_game).count() == 1
