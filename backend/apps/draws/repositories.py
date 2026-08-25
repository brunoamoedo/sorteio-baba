from itertools import combinations

from .models import Draw


class PairHistoryRepository:
    @staticmethod
    def compute(*, organization, window: int, exclude_match=None) -> dict[tuple[int, int], float]:
        """
        Calcula o peso de repetição de cada dupla de jogadores considerando
        os últimos `window` sorteios vigentes (is_current=True) da
        organização — o mais recente pesa 1.0, decaindo linearmente até o
        mais antigo da janela.

        `exclude_match` tira da janela os sorteios da própria partida que está
        sendo sorteada. Sem isso, ao "Sortear novamente" o sorteio que está
        sendo substituído entrava na história como se fosse uma semana anterior
        e penalizava as duplas dele — enviesando o novo sorteio contra o
        resultado que o organizador acabou de descartar.
        """
        queryset = Draw.objects.filter(organization=organization, is_current=True)
        if exclude_match is not None:
            queryset = queryset.exclude(match=exclude_match)

        recent_draws = list(
            queryset.prefetch_related("teams__team_players").order_by("-created_at")[:window]
        )

        weights: dict[tuple[int, int], float] = {}
        total = len(recent_draws)
        if total == 0:
            return weights

        for position, draw in enumerate(recent_draws):
            recency_weight = (total - position) / total
            for team in draw.teams.all():
                player_ids = sorted(tp.player_id for tp in team.team_players.all())
                for a, b in combinations(player_ids, 2):
                    weights[(a, b)] = weights.get((a, b), 0.0) + recency_weight

        return weights
