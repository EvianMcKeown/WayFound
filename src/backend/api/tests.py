from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from .models import IssueReport, SavedRoute

STRONG = "tram-Ledger-42"


def auth(client, user):
    resp = client.post("/api/login/", {"username": user.username, "password": STRONG}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
    return resp.data


class SignupTests(APITestCase):
    def test_signup_creates_user_and_signs_in(self):
        resp = self.client.post(
            "/api/signup/",
            {"username": "thandi", "email": "t@example.com", "password": STRONG, "first_name": "Thandi"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertIn("access", resp.data)
        self.assertIn("refresh", resp.data)
        user = User.objects.get(username="thandi")
        self.assertEqual(user.email, "t@example.com")
        self.assertEqual(user.first_name, "Thandi")

    def test_missing_username_is_400_not_500(self):
        resp = self.client.post("/api/signup/", {"email": "a@example.com", "password": STRONG}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("username", resp.data)

    def test_weak_password_rejected(self):
        resp = self.client.post(
            "/api/signup/", {"username": "sipho", "email": "s@example.com", "password": "123"}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("password", resp.data)

    def test_duplicate_username_and_email_case_insensitive(self):
        User.objects.create_user("Sipho", "s@example.com", STRONG)
        resp = self.client.post(
            "/api/signup/", {"username": "sipho", "email": "S@Example.com", "password": STRONG}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("username", resp.data)
        self.assertIn("email", resp.data)


class TokenRefreshTests(APITestCase):
    def test_refresh_returns_new_access_token(self):
        user = User.objects.create_user("a", "a@example.com", STRONG)
        tokens = auth(self.client, user)
        self.client.credentials()
        resp = self.client.post("/api/token/refresh/", {"refresh": tokens["refresh"]}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("access", resp.data)


class SavedRouteTests(APITestCase):
    ROUTE = {
        "start_location": "Cape Town Station",
        "end_location": "Sea Point",
        "origin_lat": -33.922087,
        "origin_lon": 18.425691,
        "dest_lat": -33.915,
        "dest_lon": 18.387,
    }

    def setUp(self):
        self.user = User.objects.create_user("a", "a@example.com", STRONG)
        auth(self.client, self.user)

    def test_requires_login(self):
        self.client.credentials()
        self.assertEqual(self.client.get("/api/saved-routes/").status_code, 401)

    def test_same_places_saved_once(self):
        first = self.client.post("/api/saved-routes/", self.ROUTE, format="json")
        again = self.client.post(
            "/api/saved-routes/", {**self.ROUTE, "origin_lat": self.ROUTE["origin_lat"] + 1e-7}, format="json"
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.data["id"], first.data["id"])
        self.assertEqual(SavedRoute.objects.count(), 1)

    def test_label_only_routes_still_accepted(self):
        resp = self.client.post("/api/saved-routes/", {"start_location": "A", "end_location": "B"}, format="json")
        self.assertEqual(resp.status_code, 201)

    def test_rename(self):
        rid = self.client.post("/api/saved-routes/", self.ROUTE, format="json").data["id"]
        resp = self.client.patch(f"/api/saved-routes/{rid}/", {"name": "To the beach"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["name"], "To the beach")

    def test_other_users_routes_hidden(self):
        rid = self.client.post("/api/saved-routes/", self.ROUTE, format="json").data["id"]
        other = User.objects.create_user("b", "b@example.com", STRONG)
        auth(self.client, other)
        self.assertEqual(self.client.get("/api/saved-routes/").data, [])
        self.assertEqual(self.client.delete(f"/api/saved-routes/{rid}/").status_code, 404)


class PreferencesTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("a", "a@example.com", STRONG)
        auth(self.client, self.user)

    def test_defaults_then_update(self):
        resp = self.client.get("/api/preferences/")
        self.assertEqual(resp.data, {"minimize_walking": False, "minimize_stops": False})
        resp = self.client.patch("/api/preferences/", {"minimize_walking": True}, format="json")
        self.assertEqual(resp.data, {"minimize_walking": True, "minimize_stops": False})
        self.assertTrue(self.client.get("/api/preferences/").data["minimize_walking"])


class IssueReportTests(APITestCase):
    BODY = {"category": "wrong_time", "description": "The 08:15 bus left at 08:40.", "context": {"day": 0}}

    def setUp(self):
        cache.clear()

    def test_anonymous_report(self):
        resp = self.client.post("/api/reports/", self.BODY, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(IssueReport.objects.get().user)

    def test_signed_in_report_linked_to_user(self):
        user = User.objects.create_user("a", "a@example.com", STRONG)
        auth(self.client, user)
        self.client.post("/api/reports/", self.BODY, format="json")
        self.assertEqual(IssueReport.objects.get().user, user)

    def test_short_description_rejected(self):
        resp = self.client.post("/api/reports/", {**self.BODY, "description": "bad"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_throttled_after_five(self):
        codes = [self.client.post("/api/reports/", self.BODY, format="json").status_code for _ in range(6)]
        self.assertEqual(codes, [201] * 5 + [429])


class PlanEndpointTests(APITestCase):
    CT_STATION = (-33.9221, 18.4257)
    CLAREMONT = (-33.9806, 18.4653)

    def plan(self, a, b, **extra):
        body = {
            "source_lat": a[0], "source_lon": a[1], "target_lat": b[0], "target_lon": b[1],
            "day": 1, "time": "08:00", **extra,
        }
        resp = self.client.post("/api/plan/", body, format="json")
        self.assertEqual(resp.status_code, 200)
        return resp.data

    def assert_walks_only_at_the_ends(self, steps):
        moves = [s for s in steps if s["mode"] in ("transfer", "trip")]
        self.assertEqual(moves[0]["from_stop_id"], "virtual_start")
        self.assertEqual(moves[-1]["stop_id"], "virtual_end")
        for a, b in zip(moves, moves[1:]):
            self.assertFalse(a["mode"] == b["mode"] == "transfer", f"two walks in a row: {a} {b}")

    def test_train_journey_walks_straight_to_the_station(self):
        for use_dijkstra in (False, True):
            data = self.plan(self.CT_STATION, self.CLAREMONT, use_dijkstra=use_dijkstra)
            steps = data["path_objs"]
            self.assert_walks_only_at_the_ends(steps)
            rides = [s for s in steps if s["mode"] == "trip"]
            self.assertEqual(len(rides), 1)
            self.assertTrue(rides[0]["route_id"].startswith("mr_"))

    def test_access_walk_counts_towards_arrival(self):
        data = self.plan(self.CT_STATION, self.CLAREMONT)
        first_walk = next(s for s in data["path_objs"] if s["mode"] == "transfer")
        self.assertEqual(first_walk["arrival_time"], 1 * 1440 + 8 * 60 + first_walk["transfer_time"])

    def test_nearby_destination_is_a_single_walk(self):
        data = self.plan(self.CT_STATION, (-33.9250, 18.4230))
        moves = [s for s in data["path_objs"] if s["mode"] in ("transfer", "trip")]
        self.assertEqual([(m["mode"], m["from_stop_id"], m["stop_id"]) for m in moves],
                         [("transfer", "virtual_start", "virtual_end")])
        self.assertIsNone(data["source_stop"])
