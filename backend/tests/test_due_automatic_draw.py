"""Sorteio automático baseado na configuração ATUAL da partida.

Contexto: uma partida avulsa foi criada sem horário de sorteio e depois
**editada** para ganhar um. O sorteio nunca acontecia, por dois buracos que
nada têm a ver com a origem da partida (não existe gate por origem no código):

1. O único gatilho era a task periódica do Celery Beat — se o worker/beat não
   está de pé (ambiente local sem Celery, worker caído), o horário passa em
   silêncio.
2. Mesmo com o beat rodando, a janela de tolerância fecha 60 min depois do
   horário: uma configuração feita **depois disso** nascia fora da janela e
   nunca disparava.

A correção: `run_due_automatic_draw` avalia a configuração atual nos pontos de
contato da partida (criação, edição, abertura da tela). Vencido = habilitado +
não sorteado + dia da partida + horário já chegou — sem teto de tolerância.
"""

import datetime

import pytest
from django.utils import timezone

from apps.draws.models import Draw
from apps.draws.tasks import auto_draw_tick
from apps.matches.models import Confirmation, Match
from apps.matches.services import cancel_match, set_confirmation

from .factories import (
    MatchFactory,
    MembershipFactory,
    OrganizationFactory,
    PlayerFactory,
    RecurringGameFactory,
)
from .test_matches import authenticated_client

# 00:00 é sempre "hoje, já passou" — determinístico em qualquer horário em que
# a suíte rode (diferente de `now - 3h`, que atravessa a meia-noite).
MIDNIGHT = datetime.time(0, 0)


def _standalone_match(org, *, draw_time=None, confirmed=6):
    match = MatchFactory(
        organization=org,
        recurring_game=None,
        draw_time=draw_time,
        scheduled_date=timezone.localdate(),
        min_players=4,
        teams_count=2,
        status=Match.Status.SCHEDULED,
    )
    for _ in range(confirmed):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    return match


def _organizer_client(org):
    from common.permissions import ROLE_ORGANIZADOR

    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    return authenticated_client(membership.user, organization=org)


# ---------------------------------------------------------------------------
# Caso 2 — avulsa sem configuração: nada acontece
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_standalone_without_draw_time_never_draws_by_any_trigger(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=None)
    client = _organizer_client(org)

    assert match.is_automatic_draw_due is False
    assert auto_draw_tick() == 0

    response = client.get(f"/api/matches/{match.id}/")

    assert response.status_code == 200
    assert response.json()["status"] == "scheduled"
    assert Draw.objects.filter(match=match).count() == 0


# ---------------------------------------------------------------------------
# Caso 3 — avulsa editada: a configuração atual manda
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_editing_standalone_match_with_overdue_time_draws_on_save(settings):
    """O cenário exato do problema relatado: a partida avulsa ganha um horário
    de sorteio na edição — um horário que já passou (fora até da janela de
    tolerância, grace=0) — e o sorteio sai na própria resposta do PATCH,
    sem depender do Celery."""
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=None)
    client = _organizer_client(org)

    assert auto_draw_tick() == 0  # sem configuração, o beat não faz nada

    response = client.patch(
        f"/api/matches/{match.id}/", {"draw_time": MIDNIGHT.strftime("%H:%M")}, format="json"
    )

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["automatic_draw"] is True
    assert body["automatic_draw_source"] == "match"
    assert body["status"] == "drawn"
    assert body["draw_executed_at"] is not None

    draw = Draw.objects.get(match=match, is_current=True)
    assert draw.trigger == Draw.Trigger.AUTOMATIC
    assert draw.executed_by is None


@pytest.mark.django_db
def test_opening_the_match_page_catches_up_an_overdue_draw(settings):
    """Beat fora do ar (ou janela perdida): abrir a tela da partida executa o
    sorteio vencido — é o gatilho que garante 'atualizar a tela'."""
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=MIDNIGHT)
    client = _organizer_client(org)

    assert auto_draw_tick() == 0  # fora da janela de tolerância: o beat pula

    response = client.get(f"/api/matches/{match.id}/")

    assert response.status_code == 200
    assert response.json()["status"] == "drawn"
    assert Draw.objects.get(match=match, is_current=True).trigger == Draw.Trigger.AUTOMATIC


@pytest.mark.django_db
def test_editing_with_future_time_only_schedules(settings):
    """Horário ainda por vir: a edição só grava a configuração; quem dispara na
    hora é o beat (comportamento pontual preservado)."""
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=None)
    client = _organizer_client(org)

    response = client.patch(f"/api/matches/{match.id}/", {"draw_time": "23:59"}, format="json")

    assert response.status_code == 200
    body = response.json()
    assert body["automatic_draw"] is True
    assert body["status"] == "scheduled"
    assert Draw.objects.filter(match=match).count() == 0


@pytest.mark.django_db
def test_insufficient_players_does_not_break_the_edit(settings):
    """O PATCH que habilita um sorteio vencido numa partida sem o mínimo de
    confirmados salva normalmente — o sorteio fica pendente e é retentado no
    próximo gatilho (ex.: releitura da tela após confirmar presenças)."""
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=None, confirmed=2)  # mínimo é 4
    client = _organizer_client(org)

    response = client.patch(
        f"/api/matches/{match.id}/", {"draw_time": MIDNIGHT.strftime("%H:%M")}, format="json"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "scheduled"
    assert Draw.objects.filter(match=match).count() == 0

    # O mínimo é atingido depois; a próxima leitura da tela completa o sorteio.
    for _ in range(2):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    response = client.get(f"/api/matches/{match.id}/")

    assert response.json()["status"] == "drawn"


# ---------------------------------------------------------------------------
# Alterar horário / desativar
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_changing_the_time_updates_the_schedule(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=None, confirmed=0)
    client = _organizer_client(org)

    first = client.patch(f"/api/matches/{match.id}/", {"draw_time": "22:00"}, format="json")
    second = client.patch(f"/api/matches/{match.id}/", {"draw_time": "23:30"}, format="json")

    assert first.json()["effective_draw_time"] == "22:00:00"
    assert second.json()["effective_draw_time"] == "23:30:00"
    # Não existe registro de agendamento a duplicar: o horário efetivo é a
    # única fonte, e ele reflete sempre a última edição.
    assert "23:30:00" in second.json()["automatic_draw_at"]


@pytest.mark.django_db
def test_clearing_draw_time_disables_automatic_draw(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=MIDNIGHT, confirmed=2)  # insuficiente: nada sorteia
    client = _organizer_client(org)

    response = client.patch(f"/api/matches/{match.id}/", {"draw_time": None}, format="json")

    assert response.status_code == 200
    assert response.json()["automatic_draw"] is False

    # Agora com confirmados de sobra, nenhum gatilho pode sortear.
    for _ in range(4):
        set_confirmation(
            match=match, player=PlayerFactory(organization=org), status=Confirmation.Status.CONFIRMED
        )
    assert auto_draw_tick() == 0
    assert client.get(f"/api/matches/{match.id}/").json()["status"] == "scheduled"
    assert Draw.objects.filter(match=match).count() == 0


# ---------------------------------------------------------------------------
# Duplicidade e limites
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_repeated_edits_and_reads_produce_exactly_one_draw(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=None)
    client = _organizer_client(org)

    client.patch(f"/api/matches/{match.id}/", {"draw_time": MIDNIGHT.strftime("%H:%M")}, format="json")
    teams = list(Draw.objects.get(match=match).teams.values_list("id", flat=True))

    client.patch(f"/api/matches/{match.id}/", {"location": "Quadra nova"}, format="json")
    client.get(f"/api/matches/{match.id}/")
    assert auto_draw_tick() == 0

    assert Draw.objects.filter(match=match).count() == 1
    assert list(Draw.objects.get(match=match).teams.values_list("id", flat=True)) == teams


@pytest.mark.django_db
def test_canceled_match_is_not_drawn_by_catch_up(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=MIDNIGHT)
    cancel_match(match=match)
    client = _organizer_client(org)

    response = client.get(f"/api/matches/{match.id}/")

    assert response.json()["status"] == "canceled"
    assert Draw.objects.filter(match=match).count() == 0


@pytest.mark.django_db
def test_due_is_limited_to_the_match_day(settings):
    """Partida de ontem que nunca foi sorteada não é sorteada hoje pela
    recuperação — depois que o dia passa, seria surpresa, não automação."""
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=MIDNIGHT)
    Match.objects.filter(pk=match.pk).update(
        scheduled_date=timezone.localdate() - datetime.timedelta(days=1)
    )
    match.refresh_from_db()
    client = _organizer_client(org)

    assert match.is_automatic_draw_due is False
    response = client.get(f"/api/matches/{match.id}/")

    assert response.json()["status"] == "scheduled"
    assert Draw.objects.filter(match=match).count() == 0


# ---------------------------------------------------------------------------
# Caso 1 — recorrente: comportamento preservado, mesma regra
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_recurring_match_is_caught_up_by_the_same_rule(settings):
    """A partida de jogo recorrente usa exatamente o mesmo caminho: horário
    herdado vencido + beat fora do ar → a tela recupera o sorteio."""
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    recurring_game = RecurringGameFactory(
        organization=org, draw_time=MIDNIGHT, min_players=4, teams_count=2
    )
    match = MatchFactory(
        organization=org,
        recurring_game=recurring_game,
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
    client = _organizer_client(org)

    assert match.automatic_draw_source == "recurring_game"
    response = client.get(f"/api/matches/{match.id}/")

    assert response.json()["status"] == "drawn"
    assert Draw.objects.get(match=match, is_current=True).trigger == Draw.Trigger.AUTOMATIC


# ---------------------------------------------------------------------------
# Sorteio vencido e travado por falta de gente: motivo visível + retentativa
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_blocked_reason_explains_why_an_overdue_draw_did_not_run(settings):
    """O caso relatado como "o sorteio automático não funcionou": o horário
    passou, mas faltavam confirmados. Antes isso era um no-op silencioso — a
    partida ficava parada e nada na tela dizia o porquê."""
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=MIDNIGHT, confirmed=2)  # mínimo é 4
    client = _organizer_client(org)

    body = client.get(f"/api/matches/{match.id}/").json()

    assert body["status"] == "scheduled"
    reason = body["automatic_draw_blocked_reason"]
    assert reason is not None
    assert "faltam 2" in reason.lower()
    assert "4" in reason


@pytest.mark.django_db
def test_blocked_reason_is_absent_when_there_is_nothing_to_explain(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    client = _organizer_client(org)

    sem_agendamento = _standalone_match(org, draw_time=None, confirmed=2)
    futuro = _standalone_match(org, draw_time=datetime.time(23, 59), confirmed=2)
    sorteada = _standalone_match(org, draw_time=MIDNIGHT, confirmed=6)

    assert client.get(f"/api/matches/{sem_agendamento.id}/").json()["automatic_draw_blocked_reason"] is None
    assert client.get(f"/api/matches/{futuro.id}/").json()["automatic_draw_blocked_reason"] is None
    # Esta sorteia na própria leitura; depois não há mais o que explicar.
    sorteada_body = client.get(f"/api/matches/{sorteada.id}/").json()
    assert sorteada_body["status"] == "drawn"
    assert sorteada_body["automatic_draw_blocked_reason"] is None


@pytest.mark.django_db
def test_confirming_the_missing_player_triggers_the_overdue_draw(settings):
    """Confirmar presença é o que destrava — então a retentativa acontece na
    própria confirmação, sem depender de alguém reabrir a tela."""
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=MIDNIGHT, confirmed=3)  # mínimo é 4
    client = _organizer_client(org)
    assert client.get(f"/api/matches/{match.id}/").json()["status"] == "scheduled"

    faltante = PlayerFactory(organization=org)
    response = client.post(
        f"/api/matches/{match.id}/set-confirmation/",
        {"player": faltante.id, "status": "confirmed"},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["match_status"] == "drawn"
    match.refresh_from_db()
    assert match.status == Match.Status.DRAWN
    assert Draw.objects.get(match=match, is_current=True).trigger == Draw.Trigger.AUTOMATIC


@pytest.mark.django_db
def test_confirming_everyone_at_once_also_triggers_the_overdue_draw(settings):
    settings.DRAW_AUTO_DRAW_GRACE_MINUTES = 0
    org = OrganizationFactory()
    match = _standalone_match(org, draw_time=MIDNIGHT, confirmed=0)
    for _ in range(6):
        PlayerFactory(organization=org)
    client = _organizer_client(org)

    response = client.post(
        f"/api/matches/{match.id}/set-all-confirmations/", {"status": "confirmed"}, format="json"
    )

    assert response.status_code == 200
    match.refresh_from_db()
    assert match.status == Match.Status.DRAWN
