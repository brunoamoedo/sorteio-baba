from django.db import migrations


def create_periodic_task(apps, schema_editor):
    IntervalSchedule = apps.get_model("django_celery_beat", "IntervalSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    schedule, _ = IntervalSchedule.objects.get_or_create(every=1, period="minutes")
    PeriodicTask.objects.get_or_create(
        name="Verificar sorteios automáticos pendentes",
        defaults={
            "interval": schedule,
            "task": "apps.draws.tasks.auto_draw_tick",
        },
    )


def remove_periodic_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name="Verificar sorteios automáticos pendentes").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("draws", "0001_initial"),
        ("django_celery_beat", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_periodic_task, remove_periodic_task),
    ]
