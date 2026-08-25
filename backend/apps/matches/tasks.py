import structlog
from celery import shared_task

from .services import generate_upcoming_matches

logger = structlog.get_logger(__name__)


@shared_task
def generate_upcoming_matches_task():
    count = generate_upcoming_matches()
    logger.info("generate_upcoming_matches_task_completed", matches_ensured=count)
    return count
