from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_saved_route_signature'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='excluded_lines',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='userprofile',
            name='excluded_modes',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
