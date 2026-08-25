from django.db import migrations

TASK_NAME = "Gerar mensalidades recorrentes"


def create_periodic_task(apps, schema_editor):
    """Uma vez por dia, não por mês: a task é idempotente, então rodar todo dia
    garante que uma organização criada no meio do mês também receba a cobrança,
    sem depender de acertar um dia específico."""
    CrontabSchedule = apps.get_model("django_celery_beat", "CrontabSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    schedule, _ = CrontabSchedule.objects.get_or_create(
        minute="30", hour="3", day_of_week="*", day_of_month="*", month_of_year="*"
    )
    PeriodicTask.objects.get_or_create(
        name=TASK_NAME,
        defaults={
            "crontab": schedule,
            "task": "apps.finance.tasks.generate_recurring_charges_task",
        },
    )


def remove_periodic_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name=TASK_NAME).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0001_initial"),
        ("django_celery_beat", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_periodic_task, remove_periodic_task),
    ]
