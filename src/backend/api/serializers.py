import json

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.fields import CharField
from rest_framework.serializers import FloatField, IntegerField
from . import service_area
from .models import (
    IssueReport,
    SavedRoute,
    UserProfile,
    Stop,
    Route,
    Trip,
    StopTime,
    Agency,
    Calendar,
    CalendarDate,
)


class SignupSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate_username(self, value):
        value = value.strip()
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is taken.")
        return value

    def validate_email(self, value):
        value = value.strip()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with that email already exists.")
        return value

    def validate(self, attrs):
        candidate = User(
            username=attrs["username"],
            email=attrs["email"],
            first_name=attrs.get("first_name", ""),
            last_name=attrs.get("last_name", ""),
        )
        try:
            validate_password(attrs["password"], candidate)
        except DjangoValidationError as e:
            raise serializers.ValidationError({"password": list(e.messages)})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class SavedRouteSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedRoute
        fields = [
            "id",
            "name",
            "start_location",
            "end_location",
            "origin_lat",
            "origin_lon",
            "dest_lat",
            "dest_lon",
            "route_signature",
            "created_at",
        ]


class PreferencesSerializer(serializers.ModelSerializer):
    minimize_walking = serializers.BooleanField(source="preference_min_walking", required=False)
    minimize_stops = serializers.BooleanField(source="preference_min_stops", required=False)
    excluded_modes = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=2), required=False, max_length=3
    )
    excluded_lines = serializers.ListField(child=serializers.CharField(max_length=120), required=False, max_length=50)
    excluded_lines_detail = serializers.SerializerMethodField()

    class Meta:
        model = UserProfile
        fields = ["minimize_walking", "minimize_stops", "excluded_modes", "excluded_lines", "excluded_lines_detail"]

    def validate_excluded_modes(self, value):
        return sorted(set(value))

    def validate_excluded_lines(self, value):
        return list(dict.fromkeys(value))

    def get_excluded_lines_detail(self, obj):
        from .raptor_engine import get_engine

        known = {l["key"]: l for l in get_engine().search_lines(keys=obj.excluded_lines)}
        return [known.get(k, {"key": k, "label": k, "mode": None, "operator": None, "directions": 0, "unavailable": True}) for k in obj.excluded_lines]


MAX_REPORT_CONTEXT_BYTES = 20_000


class IssueReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueReport
        fields = ["id", "category", "description", "contact_email", "context", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_description(self, value):
        value = value.strip()
        if len(value) < 10:
            raise serializers.ValidationError("Please describe the problem in a few more words.")
        return value

    def validate_context(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Context must be an object.")
        if len(json.dumps(value)) > MAX_REPORT_CONTEXT_BYTES:
            raise serializers.ValidationError("Context is too large.")
        return value


class AgencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Agency
        fields = "__all__"


class CalendarSerializer(serializers.ModelSerializer):
    class Meta:
        model = Calendar
        fields = "__all__"


class CalendarDateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CalendarDate
        fields = "__all__"


class StopSerializer(serializers.ModelSerializer):
    class Meta:
        model = Stop
        fields = "__all__"


class RouteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Route
        fields = "__all__"


class TripSerializer(serializers.ModelSerializer):
    class Meta:
        model = Trip
        fields = "__all__"


class StopTimeSerializer(serializers.ModelSerializer):
    class Meta:
        model = StopTime
        fields = "__all__"


WEEK_MINUTES = 7 * 24 * 60
MAX_ROUNDS = 8


class PlanRequestSerializer(serializers.Serializer):
    source_lat = FloatField(min_value=-90, max_value=90)
    source_lon = FloatField(min_value=-180, max_value=180)
    target_lat = FloatField(min_value=-90, max_value=90)
    target_lon = FloatField(min_value=-180, max_value=180)
    day = IntegerField(required=False, min_value=0, max_value=6)
    time = serializers.RegexField(r"^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$", required=False,
                                  error_messages={"invalid": "Enter a time as HH:MM (00:00 to 23:59)."})
    departure_minutes = IntegerField(required=False, min_value=0, max_value=WEEK_MINUTES - 1)
    max_rounds = IntegerField(required=False, default=5, min_value=1, max_value=MAX_ROUNDS)
    debug = serializers.BooleanField(required=False, default=False)
    minimize_walking = serializers.BooleanField(required=False, default=False)
    minimize_stops = serializers.BooleanField(required=False, default=False)
    alternatives = IntegerField(required=False, default=1, min_value=1, max_value=5)
    exclude_modes = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=2), required=False, default=list, max_length=3
    )
    exclude_lines = serializers.ListField(
        child=serializers.CharField(max_length=120), required=False, default=list, max_length=50
    )
    minimize_number_of_transfers = serializers.BooleanField(
        required=False, default=False
    )

    def validate(self, attrs):
        if "departure_minutes" in attrs:
            attrs["departure"] = attrs["departure_minutes"]
        elif "day" in attrs and "time" in attrs:
            hh, mm = (int(x) for x in attrs["time"].split(":")[:2])
            attrs["departure"] = attrs["day"] * 24 * 60 + hh * 60 + mm
        else:
            raise serializers.ValidationError("Provide either departure_minutes or both day and time (HH:MM).")
        errors = {}
        if not service_area.contains(attrs["source_lat"], attrs["source_lon"]):
            errors["source"] = [service_area.OUTSIDE_MESSAGE.replace("That place", "The starting point")]
        if not service_area.contains(attrs["target_lat"], attrs["target_lon"]):
            errors["target"] = [service_area.OUTSIDE_MESSAGE.replace("That place", "The destination")]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class LinesQuerySerializer(serializers.Serializer):
    q = serializers.CharField(required=False, default="", allow_blank=True, max_length=120)
    mode = IntegerField(required=False, min_value=0, max_value=2)
    limit = IntegerField(required=False, default=50, min_value=1, max_value=200)
    keys = serializers.CharField(required=False, allow_blank=True, max_length=50 * 121)

    def validate_keys(self, value):
        keys = [k for k in value.split(",") if k]
        if len(keys) > 50:
            raise serializers.ValidationError("Ask for at most 50 lines.")
        return keys
