"""A "próxima partida" nunca nasce com a bola já rolando.

Cenário relatado: pelada de sexta às 16:00; às 16:12 o organizador aperta
"Gerar a próxima partida agora" e recebe uma partida **de hoje às 16:00** — um
jogo que já começou, sem tempo de confirmar presença nem de sortear. O esperado
é a semana seguinte.

O horário do jogo (`match_time`) é o corte: passou, a ocorrência de hoje deixa
de valer como próxima — tanto para criar uma nova quanto para devolver uma já
existente.

O "agora" é controlado por um stub local em vez de `freezegun`: a suíte roda a
qualquer hora do dia, e datas relativas ao relógio real (`agora - 5min`)
quebrariam perto da meia-noite. Trocar isso por uma dependência nova não se
justifica para um único módulo.
"""

import datetime
from unittest import mock

import pytest
from django.utils import timezone as django_timezone

from apps.matches import services
from apps.matches.models import Match, RecurringGame
from apps.matches.services import ensure_next_match, generate_upcoming_matches

from .factories import OrganizationFactory

# Sexta-feira — o mesmo dia da semana do caso relatado.
SEXTA = datetime.date(2026, 8, 7)
PROXIMA_SEXTA = datetime.date(2026, 8, 14)
WEEKDAY_SEXTA = SEXTA.weekday()


class _FixedClock:
    """Substitui `django.utils.timezone` dentro de `services` por um relógio
    parado. Só o "agora" muda; o resto delega para o Django de verdade."""

    def __init__(self, moment: datetime.datetime):
        self._moment = django_timezone.make_aware(
            moment, django_timezone.get_current_timezone()
        )

    def localtime(self, value=None):
        return self._moment if value is None else django_timezone.localtime(value)

    def localdate(self, value=None):
        return self.localtime(value).date()

    def now(self):
        return self._moment

    def __getattr__(self, name):
        return getattr(django_timezone, name)


def clock_at(hour: int, minute: int, *, on: datetime.date = SEXTA):
    return mock.patch.object(
        services, "timezone", _FixedClock(datetime.datetime.combine(on, datetime.time(hour, minute)))
    )


def _recurring_game(org, *, match_time, weekday=WEEKDAY_SEXTA):
    return RecurringGame.objects.create(
        organization=org,
        name="Pelada de sexta",
        weekday=weekday,
        match_time=match_time,
        draw_time=datetime.time(15, 0),
        teams_count=2,
        min_players_per_team_line=4,
        max_players_per_team_line=6,
    )


@pytest.mark.django_db
def test_generating_after_kickoff_creates_next_week():
    """O caso exato do relato: são 16:12 e o jogo era 16:00."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, match_time=datetime.time(16, 0))
    Match.objects.filter(recurring_game=recurring_game).delete()

    with clock_at(16, 12):
        match = ensure_next_match(recurring_game, force=True)

    assert match.scheduled_date == PROXIMA_SEXTA
    assert match.scheduled_time == datetime.time(16, 0)


@pytest.mark.django_db
def test_generating_before_kickoff_still_creates_today():
    """Jogo ainda por vir hoje: continua sendo a partida de hoje."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, match_time=datetime.time(16, 30))
    Match.objects.filter(recurring_game=recurring_game).delete()

    with clock_at(16, 12):
        match = ensure_next_match(recurring_game, force=True)

    assert match.scheduled_date == SEXTA
    assert match.scheduled_time == datetime.time(16, 30)


@pytest.mark.django_db
def test_exactly_at_kickoff_counts_as_started():
    """No minuto do jogo a bola já rolou — não adianta organizar."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, match_time=datetime.time(16, 0))
    Match.objects.filter(recurring_game=recurring_game).delete()

    with clock_at(16, 0):
        assert ensure_next_match(recurring_game, force=True).scheduled_date == PROXIMA_SEXTA


@pytest.mark.django_db
def test_an_open_match_from_today_whose_kickoff_passed_does_not_block():
    """A partida de hoje existe e está "Agendada", mas o horário do jogo já
    passou: o botão avança para a semana seguinte em vez de devolvê-la."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, match_time=datetime.time(16, 0))
    hoje = Match.objects.create(
        organization=org,
        recurring_game=recurring_game,
        scheduled_date=SEXTA,
        scheduled_time=datetime.time(16, 0),
        teams_count=2,
        goalkeepers_per_team=0,
        min_players=8,
        max_players=12,
        status=Match.Status.SCHEDULED,
    )

    with clock_at(16, 12):
        proxima = ensure_next_match(recurring_game, force=True)

    assert proxima.id != hoje.id
    assert proxima.scheduled_date == PROXIMA_SEXTA
    hoje.refresh_from_db()
    assert hoje.scheduled_date == SEXTA  # a de hoje continua intacta


@pytest.mark.django_db
def test_an_open_match_from_today_before_kickoff_still_blocks():
    """A trava contra duplicata continua valendo enquanto o jogo não começou."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, match_time=datetime.time(16, 30))

    with clock_at(16, 12):
        primeira = ensure_next_match(recurring_game, force=True)
        assert ensure_next_match(recurring_game, force=True).id == primeira.id

    assert Match.objects.filter(recurring_game=recurring_game).count() == 1


@pytest.mark.django_db
def test_pressing_generate_twice_after_kickoff_creates_only_one_next_week():
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, match_time=datetime.time(16, 0))
    Match.objects.filter(recurring_game=recurring_game).delete()

    with clock_at(16, 12):
        primeira = ensure_next_match(recurring_game, force=True)
        segunda = ensure_next_match(recurring_game, force=True)

    assert primeira.id == segunda.id
    assert primeira.scheduled_date == PROXIMA_SEXTA
    assert Match.objects.filter(recurring_game=recurring_game).count() == 1


@pytest.mark.django_db
def test_the_periodic_task_also_skips_a_started_kickoff():
    """A geração automática também não cria partida com a bola rolando."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, match_time=datetime.time(16, 0))
    Match.objects.filter(recurring_game=recurring_game).delete()

    with clock_at(16, 12):
        generate_upcoming_matches()

    assert Match.objects.get(recurring_game=recurring_game).scheduled_date == PROXIMA_SEXTA


@pytest.mark.django_db
def test_a_normal_midweek_generation_is_unaffected():
    """Fora do dia da pelada nada muda: a próxima sexta continua sendo a
    próxima sexta, qualquer que seja a hora."""
    org = OrganizationFactory()
    recurring_game = _recurring_game(org, match_time=datetime.time(16, 0))
    Match.objects.filter(recurring_game=recurring_game).delete()

    with clock_at(23, 50, on=datetime.date(2026, 8, 5)):  # quarta-feira, tarde
        assert ensure_next_match(recurring_game, force=True).scheduled_date == SEXTA


@pytest.mark.django_db
def test_new_recurring_game_defaults_to_no_goalkeeper():
    """Padrão do sistema: o goleiro é fixo e não entra na conta. Só jogadores
    de linha precisam confirmar."""
    org = OrganizationFactory()
    recurring_game = RecurringGame.objects.create(
        organization=org,
        name="Pelada nova",
        weekday=WEEKDAY_SEXTA,
        match_time=datetime.time(16, 0),
        draw_time=datetime.time(15, 0),
        teams_count=3,
        min_players_per_team_line=6,
        max_players_per_team_line=6,
    )

    assert recurring_game.goalkeepers_per_team == 0
    assert (recurring_game.min_players, recurring_game.max_players) == (18, 18)
