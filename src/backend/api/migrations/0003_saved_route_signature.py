from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_saved_route_coords_and_issue_reports'),
    ]

    operations = [
        migrations.AddField(
            model_name='savedroute',
            name='route_signature',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
    ]
