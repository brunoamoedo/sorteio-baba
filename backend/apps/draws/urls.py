from rest_framework.routers import DefaultRouter

from .views import DrawViewSet

router = DefaultRouter()
router.register("draws", DrawViewSet, basename="draw")

urlpatterns = router.urls
