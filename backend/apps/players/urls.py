from rest_framework.routers import DefaultRouter

from .views import PlayerViewSet, PositionViewSet

router = DefaultRouter()
router.register("positions", PositionViewSet, basename="position")
router.register("players", PlayerViewSet, basename="player")

urlpatterns = router.urls
