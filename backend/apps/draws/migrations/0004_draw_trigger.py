from django.db import migrations, models


def backfill_trigger(apps, schema_editor):
    """Sorteios antigos sem `executed_by` só podiam ter vindo da task automática
    — a view de sorteio manual sempre grava o usuário da requisição."""
    Draw = apps.get_model("draws", "Draw")
    Draw.objects.filter(executed_by__isnull=True).update(trigger="automatic")


class Migration(migrations.Migration):
    dependencies = [
        ("draws", "0003_teamresult"),
    ]

    operations = [
        migrations.AddField(
            model_name="draw",
            name="trigger",
            field=models.CharField(
                choices=[("manual", "Manual"), ("automatic", "Automático")],
                default="manual",
                max_length=20,
            ),
        ),
        migrations.RunPython(backfill_trigger, migrations.RunPython.noop),
    ]
