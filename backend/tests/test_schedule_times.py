"""Horário e data da partida gerada — nenhum deslocamento, em nenhum caminho.

Investigação do relato "a próxima partida é criada com outro horário":

- `RecurringGame.match_time` e `Match.scheduled_time` são `TimeField`, ou seja,
  hora **naive**. `USE_TZ` só afeta `DateTimeField`; um `TimeField` não passa por
  conversão UTC↔local em nenhum ponto (Django, psycopg ou Postgres).
- `_next_occurrence` é aritmética de `date` pura, sem `datetime` no meio.
- No frontend, `scheduled_time` é exibida com `.slice(0, 5)` sobre a string da
  API — nunca passa por `new Date()`, que é onde um deslocamento apareceria.

O horário divergente que motivou o relato vinha da configuração **velha**: o
botão "Gerar a próxima partida agora" devolvia a ocorrência já existente sem
realinhá-la (ver `test_recurring_game_sync.py`). Estes testes travam a ausência
de deslocamento para que a explicação não precise ser reconstruída depois.
"""

import datetime

import pytest
from django.utils import timezone

from apps.matches.models import Match, RecurringGame
from apps.matches.services import ensure_next_match, generate_upcoming_matches
from apps.matches.tasks import generate_upcoming_matches_task

from .factories import OrganizationFactory

# Os horários pedidos, mais os extremos que costumam quebrar conversão de fuso:
# meia-noite, um minuto antes e um minuto depois.
HORARIOS = [
    datetime.time(19, 0),
    datetime.time(20, 30),
    datetime.time(21, 0),
    datetime.time(23, 59),
    datetime.time(0, 0),
    datetime.time(0, 1),
    datetime.time(12, 0),
    datetime.time(23, 30),
]


def _recurring_game(org, *, weekday, match_time, draw_time=datetime.time(20, 30)):
    return RecurringGame.objects.create(
        organization=org,
        name=f"Pelada {weekday} {match_time}",
        weekday=weekday,
        match_time=match_time,
        draw_time=draw_time,
        teams_count=2,
        min_players_per_team_line=4,
        max_players_per_team_line=6,
    )


@pytest.mark.django_db
@pytest.mark.parametrize("match_time", HORARIOS)
def test_manual_generation_keeps_the_exact_time(match_time):
    """Geração manual (botão "Gerar a próxima partida agora")."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, weekday=1, match_time=match_time)

    match = ensure_next_match(recurring_game, force=True)

    assert match.scheduled_time == match_time
    assert match.scheduled_time.hour == match_time.hour
    assert match.scheduled_time.minute == match_time.minute
    assert match.scheduled_time.second == 0


@pytest.mark.django_db
@pytest.mark.parametrize("match_time", HORARIOS)
def test_automatic_generation_keeps_the_exact_time(match_time):
    """Geração automática (task periódica do Celery Beat)."""
    org = OrganizationFactory()
    # `weekday` de amanhã garante que a ocorrência caia dentro da janela padrão
    # de antecedência (7 dias), que é o que a task respeita.
    tomorrow = timezone.localdate() + datetime.timedelta(days=1)
    recurring_game = _recurring_game(org, weekday=tomorrow.weekday(), match_time=match_time)
    Match.objects.filter(recurring_game=recurring_game).delete()

    generate_upcoming_matches()

    match = Match.objects.get(recurring_game=recurring_game)
    assert match.scheduled_time == match_time
    assert match.scheduled_date == tomorrow


@pytest.mark.django_db
@pytest.mark.parametrize("weekday", [0, 1, 2, 3, 4, 5, 6])
def test_every_weekday_generates_on_the_right_day_and_time(weekday):
    org = OrganizationFactory()
    match_time = datetime.time(21, 0)
    recurring_game = _recurring_game(org, weekday=weekday, match_time=match_time)

    match = ensure_next_match(recurring_game, force=True)

    assert match.scheduled_date.weekday() == weekday
    assert match.scheduled_date > timezone.localdate() - datetime.timedelta(days=1)
    assert match.scheduled_time == match_time


@pytest.mark.django_db
def test_time_survives_the_api_round_trip():
    """Ida e volta pela API: o horário sai como veio, sem reinterpretação."""
    from common.permissions import ROLE_ORGANIZADOR

    from .factories import MembershipFactory
    from .test_matches import authenticated_client

    org = OrganizationFactory()
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, organization=org)

    created = client.post(
        "/api/recurring-games/",
        {
            "name": "Pelada da meia-noite",
            "weekday": 1,
            "match_time": "23:59",
            "draw_time": "23:30",
            "teams_count": 2,
            "min_players_per_team_line": 4,
            "max_players_per_team_line": 6,
        },
        format="json",
    ).json()

    assert created["match_time"] == "23:59:00"
    assert created["draw_time"] == "23:30:00"

    generated = client.post(f"/api/recurring-games/{created['id']}/generate-match/").json()

    assert generated["scheduled_time"] == "23:59:00"
    assert generated["effective_draw_time"] == "23:30:00"

    # E relido do banco, sem depender do que o POST devolveu.
    assert client.get(f"/api/matches/{generated['id']}/").json()["scheduled_time"] == "23:59:00"


@pytest.mark.django_db
def test_editing_the_time_reaches_the_generated_match():
    """O caso que gerou o relato: alterar o horário na recorrência e mandar
    gerar — a partida passa a mostrar o horário novo, não o antigo."""
    org = OrganizationFactory()
    tomorrow = timezone.localdate() + datetime.timedelta(days=1)
    recurring_game = _recurring_game(
        org, weekday=tomorrow.weekday(), match_time=datetime.time(15, 0)
    )
    match = ensure_next_match(recurring_game, force=True)
    assert match.scheduled_time == datetime.time(15, 0)

    recurring_game.match_time = datetime.time(15, 30)
    recurring_game.save()

    match = ensure_next_match(recurring_game, force=True)
    assert match.scheduled_time == datetime.time(15, 30)


@pytest.mark.django_db
def test_time_fields_are_naive_and_never_carry_an_offset():
    """Trava a premissa da arquitetura: horário de jogo/sorteio é hora local
    "de parede" (`TimeField` naive). Se algum dia virar `DateTimeField`, este
    teste quebra e obriga a revisar todas as conversões."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, weekday=1, match_time=datetime.time(21, 0))
    match = ensure_next_match(recurring_game, force=True)
    match.refresh_from_db()

    assert match.scheduled_time.tzinfo is None
    assert recurring_game.match_time.tzinfo is None
    assert match.effective_draw_time.tzinfo is None
    # O único ponto que vira datetime com fuso é o momento do sorteio
    # automático, e ele usa o fuso da aplicação — não o do navegador.
    assert match.automatic_draw_at.tzinfo is not None
    assert match.automatic_draw_at.timetz().replace(tzinfo=None) == match.effective_draw_time


@pytest.mark.django_db
def test_celery_task_generates_with_the_configured_time():
    org = OrganizationFactory()
    tomorrow = timezone.localdate() + datetime.timedelta(days=1)
    recurring_game = _recurring_game(
        org, weekday=tomorrow.weekday(), match_time=datetime.time(19, 0)
    )
    Match.objects.filter(recurring_game=recurring_game).delete()

    generate_upcoming_matches_task()

    assert Match.objects.get(recurring_game=recurring_game).scheduled_time == datetime.time(19, 0)
