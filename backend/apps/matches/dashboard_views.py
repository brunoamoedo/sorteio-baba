from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.finance.permissions import FINANCIAL_VIEW, has_capability
from apps.finance.services import current_reference, financial_summary
from apps.players.models import Player
from common.permissions import IsOrganizationMember

from .models import Match
from .serializers import DashboardSummarySerializer, MatchSerializer


class DashboardSummaryView(APIView):
    permission_classes = [IsOrganizationMember]

    @extend_schema(responses=DashboardSummarySerializer)
    def get(self, request):
        organization = request.organization
        today = timezone.localdate()

        # Exclui apenas o que de fato não é "a próxima partida": cancelada ou
        # concluída. Antes o filtro era `scheduled_date >= hoje` + status
        # agendada/confirmando, então a partida **sumia do dashboard assim que
        # era sorteada** — justamente no dia do jogo, quando é mais consultada.
        next_match = (
            Match.objects.filter(organization=organization, scheduled_date__gte=today)
            .exclude(status__in=[Match.Status.CANCELED, Match.Status.COMPLETED])
            .select_related("recurring_game")
            .order_by("scheduled_date", "scheduled_time")
            .first()
        )

        # A partida é serializada **uma vez** e o bloco de pendências é lido
        # desse mesmo payload. Recalcular aqui duplicaria regras que já vivem no
        # serializer (`automatic_draw_blocked_reason`, `capacity`,
        # `confirmed_count`) — e duas cópias divergem.
        next_match_data = (
            MatchSerializer(next_match, context={"request": request}).data if next_match else None
        )

        players = Player.objects.filter(organization=organization)

        return Response(
            {
                "next_match": next_match_data,
                # "Hoje" é a partida do dia, quando existe — a informação mais
                # importante da tela nesse dia. Pode ser a mesma que
                # `next_match`; a interface decide o que destacar sem precisar
                # comparar datas.
                "is_today": bool(next_match and next_match.scheduled_date == today),
                "players": {
                    "ativos": players.filter(status=Player.Status.ATIVO).count(),
                    "mensalistas": players.filter(player_type=Player.PlayerType.MENSALISTA).count(),
                    "convidados": players.filter(player_type=Player.PlayerType.CONVIDADO).count(),
                },
                "pending": self._pending(next_match_data),
                # O Visualizador e o Jogador **não enxergam o dinheiro** da
                # organização (regra §14.8). O bloco simplesmente não vem —
                # esconder só na interface não bastaria, o dado não pode sair
                # do servidor.
                "finance": self._finance(request, organization),
            }
        )

    @staticmethod
    def _pending(match: dict | None) -> list[dict]:
        """Pendências que exigem ação do organizador.

        São situações que só apareciam ao abrir a partida — e por isso passavam
        despercebidas. O caso mais grave: um sorteio automático que venceu sem
        gente suficiente ficava parado, e a tela inicial não dizia nada.
        """
        if match is None:
            return []

        pending: list[dict] = []

        blocked = match.get("automatic_draw_blocked_reason")
        if blocked:
            pending.append(
                {"kind": "draw_blocked", "message": blocked, "match": match["id"], "severity": "warning"}
            )

        waitlist_count = match.get("waitlist_count") or 0
        if waitlist_count:
            pending.append(
                {
                    "kind": "waitlist",
                    "message": f"{waitlist_count} jogador(es) na lista de espera da próxima partida.",
                    "match": match["id"],
                    "severity": "info",
                }
            )

        capacity = match.get("capacity") or {}
        confirmed = match.get("confirmed_count") or 0
        minimum = capacity.get("min_players") or 0
        if confirmed < minimum:
            pending.append(
                {
                    "kind": "below_minimum",
                    "message": (
                        f"Faltam {minimum - confirmed} confirmado(s) para o mínimo de "
                        f"{minimum} e liberar o sorteio."
                    ),
                    "match": match["id"],
                    "severity": "info",
                }
            )

        divergences = match.get("recurring_game_divergences") or []
        if divergences:
            pending.append(
                {
                    "kind": "divergence",
                    "message": (
                        f"{len(divergences)} campo(s) desta partida divergem da configuração "
                        "atual do jogo recorrente."
                    ),
                    "match": match["id"],
                    "severity": "warning",
                }
            )

        return pending

    @staticmethod
    def _finance(request, organization) -> dict | None:
        membership = getattr(request, "membership", None)
        if membership is None or not has_capability(membership, FINANCIAL_VIEW):
            return None

        # A competência corrente, não a história inteira: o dashboard responde
        # "como está o mês", que é a pergunta de quem abre a tela.
        reference = current_reference()
        summary = financial_summary(organization, reference=reference)
        return {
            "reference": reference,
            "total_received": summary["total_received"],
            "total_outstanding": summary["total_outstanding"],
            "balance": summary["balance"],
        }
