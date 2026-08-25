from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsOrganizationMember

from .serializers import PlayerStatisticsSerializer
from .services import get_player_statistics


class PlayerStatisticsView(APIView):
    permission_classes = [IsOrganizationMember]

    @extend_schema(responses=PlayerStatisticsSerializer(many=True))
    def get(self, request):
        stats = get_player_statistics(request.organization)
        return Response(stats)
