from datetime import timedelta

import structlog
from celery import shared_task
from django.conf import settings
from django.db.models import Exists, OuterRef
from django.utils import timezone

from apps.matches.models import Match
from common.exceptions import DomainError

from .models import Draw
from .services import execute_automatic_draw

logger = structlog.get_logger(__name__)


def pending_automatic_draw_matches(*, on_date):
    """Partidas candidatas ao sorteio automático em `on_date`.

    O filtro do banco reproduz `Match.is_automatic_draw_pending` no que dá para
    reproduzir em SQL (status e ausência de sorteio); o critério de agendamento
    em si (`automatic_draw`) é aplicado em Python, porque depende do horário do
    jogo recorrente herdado.

    A exclusão por sorteio existente é o que torna a task segura a
    reinicializações: a evidência de "já sorteada" está no banco, então subir a
    aplicação de novo não sorteia nada outra vez.
    """
    has_current_draw = Draw.objects.filter(match=OuterRef("pk"), is_current=True)
    return (
        Match.objects.filter(
            scheduled_date=on_date,
            status__in=[Match.Status.SCHEDULED, Match.Status.CONFIRMING],
            draw_executed_at__isnull=True,
        )
        .annotate(has_current_draw=Exists(has_current_draw))
        .filter(has_current_draw=False)
        .select_related("recurring_game", "organization")
    )


@shared_task
def auto_draw_tick():
    """
    Executa a cada minuto (via Celery Beat): sorteia as partidas de hoje que têm
    **sorteio automático habilitado**, cujo horário já chegou e que ainda não
    foram sorteadas.

    Sorteio automático habilitado (`Match.automatic_draw`) significa ter uma
    configuração de agendamento válida: horário próprio da partida ou herdado do
    jogo recorrente que a gerou. Partida avulsa criada sem horário de sorteio
    nunca entra aqui — ela só é sorteada pelo botão manual.

    A comparação é por **janela** (`horário <= agora <= horário + tolerância`),
    não por igualdade exata ao minuto. Antes, bastava o worker atrasar 60
    segundos — ou o beat perder um tick — para o sorteio automático daquele dia
    simplesmente nunca acontecer, sem nenhum registro. A tolerância é
    configurável em `DRAW_AUTO_DRAW_GRACE_MINUTES` (padrão 60 min) e serve
    também de retentativa: uma partida que ainda não bateu o mínimo de
    confirmados é tentada de novo nos minutos seguintes.

    A task é idempotente em três camadas: o filtro já descarta partidas
    sorteadas, `execute_automatic_draw` trava a linha e reavalia, e o sorteio
    gravado muda o status para `drawn`.
    """
    now = timezone.localtime()
    grace = timedelta(minutes=getattr(settings, "DRAW_AUTO_DRAW_GRACE_MINUTES", 60))

    executed = 0
    for match in pending_automatic_draw_matches(on_date=now.date()):
        if not match.automatic_draw:
            continue

        scheduled_at = match.automatic_draw_at
        if not (scheduled_at <= now <= scheduled_at + grace):
            continue

        try:
            if execute_automatic_draw(match=match) is not None:
                executed += 1
        except DomainError as error:
            logger.warning(
                "auto_draw_skipped",
                match_id=match.id,
                organization_id=match.organization_id,
                detail=str(error),
            )

    return executed
