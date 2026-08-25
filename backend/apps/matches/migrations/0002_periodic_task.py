from django.db import migrations


def create_periodic_task(apps, schema_editor):
    IntervalSchedule = apps.get_model("django_celery_beat", "IntervalSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    schedule, _ = IntervalSchedule.objects.get_or_create(every=1, period="hours")
    PeriodicTask.objects.get_or_create(
        name="Gerar próximas partidas dos jogos recorrentes",
        defaults={
            "interval": schedule,
            "task": "apps.matches.tasks.generate_upcoming_matches_task",
        },
    )


def remove_periodic_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(
        name="Gerar próximas partidas dos jogos recorrentes"
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("matches", "0001_initial"),
        ("django_celery_beat", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_periodic_task, remove_periodic_task),
    ]
