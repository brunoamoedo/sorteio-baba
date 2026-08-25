import structlog
from celery import shared_task

from .services import generate_recurring_charges

logger = structlog.get_logger(__name__)


@shared_task
def generate_recurring_charges_task():
    """Lança a mensalidade do mês para os mensalistas de toda organização com
    plano ativo. Roda uma vez por dia (Celery Beat) e é idempotente: a partir
    da segunda execução do mês não cria nada."""
    count = generate_recurring_charges()
    logger.info("generate_recurring_charges_task_completed", charges_created=count)
    return count
