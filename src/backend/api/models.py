from django.contrib.auth.models import User
from django.db import models


# ----------------------------
# User-related models
# ----------------------------

class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    preference_min_walking = models.BooleanField(default=False)
    preference_min_stops = models.BooleanField(default=False)

    def __str__(self):
        return self.user.username


class SavedRoute(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="saved_routes"
    )
    name = models.CharField(max_length=100, blank=True)
    start_location = models.CharField(max_length=255)
    end_location = models.CharField(max_length=255)
    origin_lat = models.FloatField(null=True, blank=True)
    origin_lon = models.FloatField(null=True, blank=True)
    dest_lat = models.FloatField(null=True, blank=True)
    dest_lon = models.FloatField(null=True, blank=True)
    route_signature = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username}: {self.start_location} → {self.end_location}"


class IssueReport(models.Model):
    class Category(models.TextChoices):
        WRONG_TIME = "wrong_time", "Wrong time or timetable"
        STOP_LOCATION = "stop_location", "Stop in the wrong place"
        MISSING = "missing", "Missing route or stop"
        APP = "app", "Problem with the app"
        OTHER = "other", "Something else"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RESOLVED = "resolved", "Resolved"

    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="issue_reports"
    )
    category = models.CharField(max_length=20, choices=Category.choices)
    description = models.TextField(max_length=2000)
    contact_email = models.EmailField(blank=True)
    context = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_category_display()} ({self.created_at:%Y-%m-%d})"


# ----------------------------
# GTFS models
# ----------------------------

class Agency(models.Model):
    agency_id = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    url = models.URLField()
    timezone = models.CharField(max_length=50)
    lang = models.CharField(max_length=10, blank=True, null=True)
    phone = models.CharField(max_length=50, blank=True, null=True)

    def __str__(self):
        return self.name


class Calendar(models.Model):
    service_id = models.CharField(max_length=50, unique=True)
    monday = models.BooleanField(default=False)
    tuesday = models.BooleanField(default=False)
    wednesday = models.BooleanField(default=False)
    thursday = models.BooleanField(default=False)
    friday = models.BooleanField(default=False)
    saturday = models.BooleanField(default=False)
    sunday = models.BooleanField(default=False)
    start_date = models.DateField()
    end_date = models.DateField()

    def __str__(self):
        return f"Service {self.service_id}"


class CalendarDate(models.Model):
    service = models.ForeignKey(Calendar, on_delete=models.CASCADE, related_name="dates")
    date = models.DateField()
    exception_type = models.IntegerField(
        choices=[(1, "Added service"), (2, "Removed service")]
    )

    class Meta:
        unique_together = ("service", "date")

    def __str__(self):
        return f"{self.service.service_id} on {self.date} ({self.get_exception_type_display()})"


class Stop(models.Model):
    stop_id = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    lat = models.FloatField()
    lon = models.FloatField()

    def __str__(self):
        return f"{self.name} ({self.stop_id})"


class Route(models.Model):
    route_id = models.CharField(max_length=50, unique=True)
    agency = models.ForeignKey(
        Agency, on_delete=models.SET_NULL, null=True, blank=True, related_name="routes"
    )
    short_name = models.CharField(max_length=50, blank=True)
    long_name = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return self.long_name or self.short_name or self.route_id


class Trip(models.Model):
    trip_id = models.CharField(max_length=50, unique=True)
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="trips")
    service = models.ForeignKey(
        Calendar, on_delete=models.SET_NULL, null=True, blank=True, related_name="trips"
    )
    headsign = models.CharField(max_length=200, blank=True)
    direction_id = models.IntegerField(blank=True, null=True)

    def __str__(self):
        return self.trip_id


class StopTime(models.Model):
    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name="stop_times")
    stop = models.ForeignKey(Stop, on_delete=models.CASCADE)
    stop_sequence = models.PositiveIntegerField()
    arrival_time = models.CharField(max_length=20, blank=True)
    departure_time = models.CharField(max_length=20, blank=True)

    class Meta:
        ordering = ["trip", "stop_sequence"]
        unique_together = ("trip", "stop_sequence")

    def __str__(self):
        return f"{self.trip.trip_id} @ {self.stop.name} (seq {self.stop_sequence})"
