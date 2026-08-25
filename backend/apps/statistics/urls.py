from django.urls import path

from .views import PlayerStatisticsView

urlpatterns = [
    path("players/", PlayerStatisticsView.as_view(), name="statistics-players"),
]
