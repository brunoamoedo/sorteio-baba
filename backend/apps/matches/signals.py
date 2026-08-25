import structlog
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import RecurringGame

logger = structlog.get_logger(__name__)


@receiver(post_save, sender=RecurringGame, dispatch_uid="matches.sync_future_matches")
def sync_future_matches_on_recurring_game_saved(sender, instance, created, **kwargs):
    """Qualquer alteração num jogo recorrente realinha as partidas futuras.

    Mora num sinal, e não na view, de propósito: a regra é "uma partida futura
    nunca fica com configuração mais velha que a da recorrência", e isso precisa
    valer para **todo** caminho de escrita — API, Django admin, shell, seed,
    data migration, comando de gestão. Amarrar no endpoint deixaria os outros
    caminhos produzindo a mesma inconsistência que este sinal existe para
    eliminar.

    Na criação não há o que sincronizar (a primeira partida ainda nem existe),
    então o sinal sai fora — mantendo o `save()` de criação barato.

    A seleção do que pode ou não ser realinhado fica em
    `sync_match_with_recurring_game`: partida já sorteada, passada, cancelada ou
    concluída é preservada e continua sinalizando a divergência em vermelho.
    """
    if created:
        return

    from .services import sync_future_matches

    synced = sync_future_matches(instance)
    if synced:
        logger.info(
            "recurring_game_future_matches_synced",
            recurring_game_id=instance.pk,
            organization_id=instance.organization_id,
            matches_synced=synced,
        )
