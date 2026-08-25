from rest_framework.routers import DefaultRouter

from .views import MatchViewSet, RecurringGameViewSet

router = DefaultRouter()
router.register("recurring-games", RecurringGameViewSet, basename="recurring-game")
router.register("matches", MatchViewSet, basename="match")

urlpatterns = router.urls
