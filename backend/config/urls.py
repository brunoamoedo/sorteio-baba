from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def health_check(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health-check"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.players.urls")),
    path("api/", include("apps.matches.urls")),
    path("api/", include("apps.draws.urls")),
    path("api/", include("apps.audit.urls")),
    path("api/dashboard/", include("apps.matches.dashboard_urls")),
    path("api/statistics/", include("apps.statistics.urls")),
    path("api/finance/", include("apps.finance.urls")),
    path("api/admin/", include("apps.accounts.admin_urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
