from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from .geocode import GeocodeView
from .views import (
    signup,
    PreferencesView,
    IssueReportCreateView,
    CustomTokenObtainPairView,
    SavedRouteViewSet,
    UserDetailView,
    ChangePasswordView,
    StopViewSet,
    RouteViewSet,
    TripViewSet,
    StopTimeViewSet,
    AgencyViewSet,
    CalendarViewSet,
    CalendarDateViewSet,
    PlanJourneyView,
)

# Router for all API viewsets
router = DefaultRouter()
router.register(r"saved-routes", SavedRouteViewSet, basename="savedroute")
router.register(r"stops", StopViewSet)
router.register(r"routes", RouteViewSet)
router.register(r"trips", TripViewSet)
router.register(r"stop-times", StopTimeViewSet)
router.register(r"agencies", AgencyViewSet)
router.register(r"calendars", CalendarViewSet)
router.register(r"calendar-dates", CalendarDateViewSet)

urlpatterns = [
    # Auth
    path("signup/", signup, name="signup"),
    path("login/", CustomTokenObtainPairView.as_view(), name="login"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    # User account
    path("user/", UserDetailView.as_view(), name="user-detail"),
    path("user/change_password/", ChangePasswordView.as_view(), name="change-password"),
    # Routes & Preferences
    path("plan/", PlanJourneyView.as_view(), name="plan-journey"),
    path("geocode/", GeocodeView.as_view(), name="geocode"),
    path("preferences/", PreferencesView.as_view(), name="preferences"),
    path("reports/", IssueReportCreateView.as_view(), name="reports"),
    # All registered API endpoints
    path("", include(router.urls)),
]
