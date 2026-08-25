from django.apps import AppConfig


class MatchesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.matches"
    label = "matches"
    verbose_name = "Jogos e Partidas"

    def ready(self):
        from . import signals  # noqa: F401  (registra o sincronismo de partidas futuras)
