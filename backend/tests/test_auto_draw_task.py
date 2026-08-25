import datetime

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.draws.models import Draw
from apps.draws.services import execute_automatic_draw, execute_draw
from apps.draws.tasks import auto_draw_tick
from apps.matches.models import Confirmation, Match
from apps.matches.services import ensure_next_match, set_confirmation

from .factories import (
    MatchFactory,
    OrganizationFactory,
    PlayerFactory,
    RecurringGameFactory,
    match_time_still_ahead,
)


@pytest.mark.django_db
def test_auto_draw_tick_executes_draw_when_draw_time_matches_now():
    org = OrganizationFactory()
    now = timezone.localtime()
    current_minute = now.time().replace(second=0, microsecond=0)

    recurring_game = RecurringGameFactory(
        organization=org, draw_time=current_minute, min_players=4, teams_count=2
    )
    match = MatchFactory(
        organization=org,
        recurring_game=recurring_game,
        scheduled_date=now.date(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    players = [PlayerFactory(organization=org) for _ in range(6)]
    for player in players:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    executed = auto_draw_tick()

    match.refresh_from_db()
    assert executed == 1
    assert match.status == Match.Status.DRAWN
    assert match.draws.filter(is_current=True).exists()


@pytest.mark.django_db
def test_auto_draw_tick_skips_matches_when_draw_time_does_not_match():
    org = OrganizationFactory()
    now = timezone.localtime()
    other_minute = (now.replace(hour=(now.hour + 1) % 24)).time().replace(second=0, microsecond=0)

    recurring_game = RecurringGameFactory(organization=org, draw_time=other_minute)
    MatchFactory(
        organization=org,
        recurring_game=recurring_game,
        scheduled_date=now.date(),
        status=Match.Status.SCHEDULED,
    )

    executed = auto_draw_tick()

    assert executed == 0


@pytest.mark.django_db
def test_auto_draw_tick_executes_manual_match_with_own_draw_time():
    """Partida avulsa (sem jogo recorrente) sorteia sozinha quando tem
    draw_time próprio."""
    org = OrganizationFactory()
    now = timezone.localtime()
    current_minute = now.time().replace(second=0, microsecond=0)

    match = MatchFactory(
        organization=org,
        recurring_game=None,
        draw_time=current_minute,
        scheduled_date=now.date(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    for _ in range(6):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )

    executed = auto_draw_tick()

    match.refresh_from_db()
    assert executed == 1
    assert match.status == Match.Status.DRAWN


@pytest.mark.django_db
def test_auto_draw_tick_ignores_manual_match_without_draw_time():
    org = OrganizationFactory()
    now = timezone.localtime()

    match = MatchFactory(
        organization=org,
        recurring_game=None,
        draw_time=None,
        scheduled_date=now.date(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    for _ in range(6):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )

    executed = auto_draw_tick()

    match.refresh_from_db()
    assert executed == 0
    assert match.status == Match.Status.SCHEDULED


@pytest.mark.django_db
def test_match_draw_time_takes_precedence_over_recurring_game():
    """Quando a partida tem horário próprio, ele vence o do jogo recorrente —
    e o horário do recorrente deixa de disparar o sorteio."""
    org = OrganizationFactory()
    now = timezone.localtime()
    current_minute = now.time().replace(second=0, microsecond=0)
    other_minute = (now.replace(hour=(now.hour + 1) % 24)).time().replace(second=0, microsecond=0)

    recurring_game = RecurringGameFactory(organization=org, draw_time=other_minute)
    match = MatchFactory(
        organization=org,
        recurring_game=recurring_game,
        draw_time=current_minute,
        scheduled_date=now.date(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    for _ in range(6):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )

    assert match.effective_draw_time == current_minute

    executed = auto_draw_tick()

    match.refresh_from_db()
    assert executed == 1
    assert match.status == Match.Status.DRAWN


@pytest.mark.django_db
def test_automatic_draw_flag_distinguishes_recurring_from_manual_match():
    """O critério do sorteio automático é um só e mora no model: partida com
    agendamento válido → `automatic_draw=True`; avulsa sem horário → `False`."""
    org = OrganizationFactory()
    recurring_game = RecurringGameFactory(organization=org)

    from_recurring = MatchFactory(organization=org, recurring_game=recurring_game, draw_time=None)
    standalone_without_time = MatchFactory(organization=org, recurring_game=None, draw_time=None)
    standalone_with_time = MatchFactory(
        organization=org, recurring_game=None, draw_time=datetime.time(20, 0)
    )

    assert from_recurring.automatic_draw is True
    assert from_recurring.automatic_draw_source == "recurring_game"
    assert from_recurring.effective_draw_time == recurring_game.draw_time

    assert standalone_without_time.automatic_draw is False
    assert standalone_without_time.automatic_draw_source is None
    assert standalone_without_time.automatic_draw_at is None

    assert standalone_with_time.automatic_draw is True
    assert standalone_with_time.automatic_draw_source == "match"


@pytest.mark.django_db
def test_auto_draw_tick_skips_and_does_not_crash_when_insufficient_players():
    org = OrganizationFactory()
    now = timezone.localtime()
    current_minute = now.time().replace(second=0, microsecond=0)

    recurring_game = RecurringGameFactory(
        organization=org, draw_time=current_minute, min_players=4, teams_count=2
    )
    match = MatchFactory(
        organization=org,
        recurring_game=recurring_game,
        scheduled_date=now.date(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    players = [PlayerFactory(organization=org) for _ in range(2)]
    for player in players:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    executed = auto_draw_tick()

    match.refresh_from_db()
    assert executed == 0
    assert match.status == Match.Status.SCHEDULED


# ---------------------------------------------------------------------------
# Segurança contra duplicidade
# ---------------------------------------------------------------------------


def _recurring_match_ready_to_draw(*, players=6):
    """Partida recorrente de hoje, com o horário do sorteio já vencido e
    confirmados suficientes — o cenário feliz do sorteio automático."""
    org = OrganizationFactory()
    now = timezone.localtime()
    current_minute = now.time().replace(second=0, microsecond=0)

    # O dia da semana acompanha hoje para que `ensure_next_match` reconheça
    # esta partida como a ocorrência do jogo recorrente (usado no teste de
    # reabertura).
    recurring_game = RecurringGameFactory(
        organization=org,
        weekday=now.date().weekday(),
        draw_time=current_minute,
        # O jogo ainda vai acontecer hoje — senão a ocorrência de hoje deixa de
        # valer como "a próxima" e o teste dependeria da hora em que roda.
        match_time=match_time_still_ahead(),
        min_players=4,
        teams_count=2,
    )
    match = MatchFactory(
        organization=org,
        recurring_game=recurring_game,
        scheduled_date=now.date(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    for _ in range(players):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    return match


@pytest.mark.django_db
def test_auto_draw_records_trigger_and_audit():
    match = _recurring_match_ready_to_draw()

    assert auto_draw_tick() == 1

    draw = Draw.objects.get(match=match, is_current=True)
    assert draw.trigger == Draw.Trigger.AUTOMATIC
    assert draw.executed_by is None

    log = AuditLog.objects.get(match=match, action=AuditLog.Action.DRAW_CREATED)
    assert log.draw_id == draw.id
    assert log.after["trigger"] == "automatic"
    assert log.after["players_count"] == 6


@pytest.mark.django_db
def test_auto_draw_tick_is_idempotent_across_repeated_runs():
    """Ticks repetidos dentro da janela de tolerância não sorteiam de novo —
    é o mesmo caminho de uma reinicialização da aplicação, que só recoloca a
    task de pé e a faz varrer as partidas do dia outra vez."""
    match = _recurring_match_ready_to_draw()

    assert auto_draw_tick() == 1
    teams_after_first = list(
        Draw.objects.get(match=match, is_current=True).teams.values_list("id", flat=True)
    )

    assert auto_draw_tick() == 0
    assert auto_draw_tick() == 0

    assert Draw.objects.filter(match=match).count() == 1
    assert list(
        Draw.objects.get(match=match, is_current=True).teams.values_list("id", flat=True)
    ) == teams_after_first


@pytest.mark.django_db
def test_auto_draw_skips_match_already_drawn_manually():
    """A partida recorrente foi sorteada no botão antes do horário automático:
    o agendamento não sobrescreve os times já divulgados."""
    match = _recurring_match_ready_to_draw()
    manual_draw = execute_draw(match=match)
    match.refresh_from_db()

    assert auto_draw_tick() == 0
    assert Draw.objects.filter(match=match).count() == 1
    assert Draw.objects.get(match=match, is_current=True).id == manual_draw.id
    assert manual_draw.trigger == Draw.Trigger.MANUAL


@pytest.mark.django_db
def test_auto_draw_skips_drawn_match_whose_status_was_reset():
    """Trava por evidência, não por status: mesmo que a partida volte para
    `Agendada` com um sorteio salvo (reabertura de ocorrência), ela não é
    sorteada de novo."""
    match = _recurring_match_ready_to_draw()
    execute_automatic_draw(match=match)

    Match.objects.filter(pk=match.pk).update(
        status=Match.Status.SCHEDULED, draw_executed_at=None
    )
    match.refresh_from_db()
    assert match.has_draw is True
    assert match.is_automatic_draw_pending is False

    assert auto_draw_tick() == 0
    assert Draw.objects.filter(match=match).count() == 1


@pytest.mark.django_db
def test_execute_automatic_draw_refuses_match_without_schedule():
    """Chamada direta na partida avulsa sem horário: nada acontece, nem sorteio
    nem exceção — o critério é reavaliado dentro do serviço."""
    org = OrganizationFactory()
    match = MatchFactory(
        organization=org,
        recurring_game=None,
        draw_time=None,
        scheduled_date=timezone.localdate(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    for _ in range(6):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )

    assert execute_automatic_draw(match=match) is None
    assert Draw.objects.filter(match=match).count() == 0


@pytest.mark.django_db
def test_manual_draw_still_works_on_standalone_match_without_schedule():
    """A partida avulsa sem agendamento continua sorteando normalmente pelo
    botão — o comportamento dela não mudou."""
    org = OrganizationFactory()
    match = MatchFactory(
        organization=org,
        recurring_game=None,
        draw_time=None,
        scheduled_date=timezone.localdate(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    for _ in range(6):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )

    draw = execute_draw(match=match)
    match.refresh_from_db()

    assert draw.trigger == Draw.Trigger.MANUAL
    assert match.status == Match.Status.DRAWN
    assert sum(team.team_players.count() for team in draw.teams.all()) == 6


@pytest.mark.django_db
@pytest.mark.parametrize("status", [Match.Status.CANCELED, Match.Status.COMPLETED])
def test_auto_draw_ignores_canceled_and_completed_matches(status):
    match = _recurring_match_ready_to_draw()
    Match.objects.filter(pk=match.pk).update(status=status)

    assert auto_draw_tick() == 0
    assert Draw.objects.filter(match=match).count() == 0


@pytest.mark.django_db
def test_reopened_occurrence_with_draw_comes_back_as_drawn():
    """Reabrir uma ocorrência cancelada que já tinha sorteio devolve o status
    `Sorteada` — antes voltava como `Agendada` e reentrava na fila do sorteio
    automático mesmo já tendo times."""
    match = _recurring_match_ready_to_draw()
    execute_automatic_draw(match=match)

    recurring_game = match.recurring_game
    Match.objects.filter(pk=match.pk).update(status=Match.Status.CANCELED)
    match.refresh_from_db()
    match.delete()

    reopened = ensure_next_match(recurring_game, force=True)

    assert reopened is not None
    assert reopened.id == match.id
    assert reopened.status == Match.Status.DRAWN
    assert auto_draw_tick() == 0
    assert Draw.objects.filter(match=match).count() == 1
