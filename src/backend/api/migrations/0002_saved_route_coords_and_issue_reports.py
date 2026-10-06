import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='savedroute',
            name='dest_lat',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='savedroute',
            name='dest_lon',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='savedroute',
            name='name',
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name='savedroute',
            name='origin_lat',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='savedroute',
            name='origin_lon',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='IssueReport',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('category', models.CharField(choices=[('wrong_time', 'Wrong time or timetable'), ('stop_location', 'Stop in the wrong place'), ('missing', 'Missing route or stop'), ('app', 'Problem with the app'), ('other', 'Something else')], max_length=20)),
                ('description', models.TextField(max_length=2000)),
                ('contact_email', models.EmailField(blank=True, max_length=254)),
                ('context', models.JSONField(blank=True, default=dict)),
                ('status', models.CharField(choices=[('open', 'Open'), ('resolved', 'Resolved')], default='open', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='issue_reports', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
