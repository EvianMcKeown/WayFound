from pathlib import Path
from unittest import skipUnless

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase as _APITestCase

needs_feed = skipUnless(Path(settings.GTFS_FOLDER, "stops.txt").exists(), "needs the GTFS feed in data/gtfs")


class APITestCase(_APITestCase):
    def _pre_setup(self):
        super()._pre_setup()
        cache.clear()

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

    def test_chosen_alternative_is_remembered_and_can_change(self):
        first = self.client.post("/api/saved-routes/", {**self.ROUTE, "route_signature": "a>b|c>d"}, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["route_signature"], "a>b|c>d")
        same = self.client.post("/api/saved-routes/", self.ROUTE, format="json")
        self.assertEqual(same.data["route_signature"], "a>b|c>d")
        changed = self.client.post("/api/saved-routes/", {**self.ROUTE, "route_signature": ""}, format="json")
        self.assertEqual(changed.data["route_signature"], "")
        self.assertEqual(SavedRoute.objects.count(), 1)

    def test_choice_can_be_cleared_with_a_patch(self):
        first = self.client.post("/api/saved-routes/", {**self.ROUTE, "route_signature": "a>b"}, format="json")
        resp = self.client.patch(f"/api/saved-routes/{first.data['id']}/", {"route_signature": ""}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["route_signature"], "")
        self.assertEqual(resp.data["start_location"], self.ROUTE["start_location"])

    def test_routes_without_a_choice_default_to_the_best(self):
        resp = self.client.post("/api/saved-routes/", self.ROUTE, format="json")
        self.assertEqual(resp.data["route_signature"], "")

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

    @needs_feed
    def test_defaults_then_update(self):
        resp = self.client.get("/api/preferences/")
        avoid_nothing = {"excluded_modes": [], "excluded_lines": [], "excluded_lines_detail": []}
        self.assertEqual(resp.data, {"minimize_walking": False, "minimize_stops": False, **avoid_nothing})
        resp = self.client.patch("/api/preferences/", {"minimize_walking": True}, format="json")
        self.assertEqual(resp.data, {"minimize_walking": True, "minimize_stops": False, **avoid_nothing})
        self.assertTrue(self.client.get("/api/preferences/").data["minimize_walking"])


class AvoidedTransportPreferenceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("a", "a@example.com", STRONG)
        auth(self.client, self.user)

    @needs_feed
    def test_defaults_to_avoiding_nothing(self):
        data = self.client.get("/api/preferences/").data
        self.assertEqual(data["excluded_modes"], [])
        self.assertEqual(data["excluded_lines"], [])

    @needs_feed
    def test_modes_and_lines_are_saved_with_labels(self):
        resp = self.client.patch(
            "/api/preferences/",
            {"excluded_modes": [2, 0, 2], "excluded_lines": ["mc:113", "mc:113", "gone:line"]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["excluded_modes"], [0, 2])
        self.assertEqual(resp.data["excluded_lines"], ["mc:113", "gone:line"])
        detail = {d["key"]: d for d in resp.data["excluded_lines_detail"]}
        self.assertEqual(detail["mc:113"]["label"], "113")
        self.assertTrue(detail["gone:line"]["unavailable"])
        self.assertEqual(self.client.get("/api/preferences/").data["excluded_modes"], [0, 2])

    @needs_feed
    def test_other_preferences_are_left_alone(self):
        self.client.patch("/api/preferences/", {"minimize_walking": True}, format="json")
        self.client.patch("/api/preferences/", {"excluded_modes": [1]}, format="json")
        data = self.client.get("/api/preferences/").data
        self.assertTrue(data["minimize_walking"])
        self.assertEqual(data["excluded_modes"], [1])

    def test_invalid_values_are_rejected(self):
        for body in ({"excluded_modes": [3]}, {"excluded_modes": ["x"]}, {"excluded_lines": ["a"] * 51}):
            self.assertEqual(self.client.patch("/api/preferences/", body, format="json").status_code, 400)


@needs_feed
class LinesEndpointTests(APITestCase):
    def test_search_by_words_and_operator(self):
        found = self.client.get("/api/lines/", {"q": "bellville cape"}).data
        self.assertTrue(found)
        self.assertTrue(all(l["operator"] == "Golden Arrow" for l in found))
        self.assertTrue(all("bellville" in l["label"].lower() for l in found))
        metro = self.client.get("/api/lines/", {"mode": 2}).data
        self.assertEqual({l["operator"] for l in metro}, {"Metrorail"})
        self.assertGreaterEqual(len(metro), 4)

    def test_both_directions_of_a_myciti_line_are_one_line(self):
        line = self.client.get("/api/lines/", {"q": "101", "mode": 0}).data
        self.assertEqual([(l["label"], l["directions"]) for l in line], [("101", 2)])

    def test_exact_keys_and_limit(self):
        found = self.client.get("/api/lines/", {"keys": "mc:101,nope"}).data
        self.assertEqual([l["key"] for l in found], ["mc:101"])
        self.assertEqual(len(self.client.get("/api/lines/", {"limit": 5}).data), 5)

    def test_needs_no_account(self):
        self.client.credentials()
        self.assertEqual(self.client.get("/api/lines/").status_code, 200)


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


@needs_feed
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
        data = self.plan(self.CT_STATION, self.CLAREMONT)
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

    GUGULETHU = (-33.9780, 18.5700)
    WATERFRONT = (-33.9025, 18.4207)

    def test_alternatives_are_off_by_default(self):
        data = self.plan(self.CT_STATION, self.CLAREMONT)
        self.assertNotIn("journeys", data)

    def test_alternatives_are_distinct_ranked_and_start_with_the_best(self):
        best = self.plan(self.GUGULETHU, self.WATERFRONT)
        data = self.plan(self.GUGULETHU, self.WATERFRONT, alternatives=5)
        journeys = data["journeys"]
        self.assertTrue(2 <= len(journeys) <= 5)
        self.assertEqual(data["path_objs"], best["path_objs"])
        self.assertEqual(journeys[0]["path_objs"], best["path_objs"])
        self.assertEqual([j["rank"] for j in journeys], list(range(len(journeys))))
        arrivals = [j["earliest_arrival"] for j in journeys]
        self.assertEqual(arrivals, sorted(arrivals))
        self.assertEqual(len({j["signature"] for j in journeys}), len(journeys))
        for j in journeys:
            self.assert_walks_only_at_the_ends(j["path_objs"])
            self.assertEqual(j["summary"]["duration"], j["earliest_arrival"] - (1 * 1440 + 8 * 60))

    def test_labels_name_the_option_that_is_best_at_something(self):
        journeys = self.plan(self.GUGULETHU, self.WATERFRONT, alternatives=5)["journeys"]
        self.assertIn("Fastest", journeys[0]["labels"])
        for label, key in (("Fewest transfers", "transfers"), ("Least walking", "walking")):
            labelled = [j for j in journeys if label in j["labels"]]
            self.assertLessEqual(len(labelled), 1)
            if labelled:
                self.assertEqual(labelled[0]["summary"][key], min(j["summary"][key] for j in journeys))

    def test_alternatives_range_is_validated(self):
        body = {"source_lat": 0, "source_lon": 0, "target_lat": 1, "target_lon": 1, "day": 1, "time": "08:00"}
        for n in (0, 6):
            resp = self.client.post("/api/plan/", {**body, "alternatives": n}, format="json")
            self.assertEqual(resp.status_code, 400)

    def test_walk_only_trip_has_no_alternatives(self):
        data = self.plan(self.CT_STATION, (-33.9250, 18.4230), alternatives=5)
        self.assertLessEqual(len(data.get("journeys", [])), 1)

    def test_pruning_never_changes_the_best_journey(self):
        import algorithm_prototype.raptor as raptor

        pairs = [(self.GUGULETHU, self.WATERFRONT), (self.CT_STATION, self.CLAREMONT), (self.WATERFRONT, self.GUGULETHU)]
        try:
            for a, b in pairs:
                raptor.PRUNE = False
                full = self.plan(a, b)
                raptor.PRUNE = True
                pruned = self.plan(a, b)
                self.assertEqual(full["earliest_arrival"], pruned["earliest_arrival"])
                self.assertEqual(full["path"], pruned["path"])
        finally:
            raptor.PRUNE = True

    def rides(self, data):
        return [s for s in data["path_objs"] if s["mode"] == "trip"]

    def test_rides_say_which_line_they_are(self):
        data = self.plan(self.GUGULETHU, self.WATERFRONT)
        lines = [r["line"]["key"] for r in self.rides(data)]
        self.assertIn("mr:southern", lines)
        self.assertEqual(data["exclusions"], {"modes": [], "lines": [], "unknown_lines": [], "routes_banned": 0})

    def test_rides_say_where_the_vehicle_is_going(self):
        data = self.plan(self.GUGULETHU, self.WATERFRONT, alternatives=5)
        rides = [r for j in data["journeys"] for r in self.rides(j)]
        self.assertTrue(rides)
        for r in rides:
            self.assertTrue(r["towards"], r["route_id"])

    def test_towards_is_the_trips_own_last_stop(self):
        from algorithm_prototype.gtfs_reader import INF
        from algorithm_prototype.raptor import Route, Stop, Trip

        from .raptor_engine import _towards

        route = Route("mc_x-0", [Stop(n, 0, 0.0, 0.0, name=n) for n in ("A", "B", "C")], name="x-0")
        self.assertEqual(_towards(route, Trip("full", [1, 2, 3])), "C")
        self.assertEqual(_towards(route, Trip("short", [1, 2, INF])), "B")
        self.assertEqual(_towards(route, None), "C")

    def test_avoiding_an_operator_removes_it_from_every_option(self):
        data = self.plan(self.GUGULETHU, self.WATERFRONT, exclude_modes=[2], alternatives=5)
        for journey in [data, *data["journeys"]]:
            self.assertNotIn(2, {r["line"]["mode"] for r in self.rides(journey)})
        self.assertTrue(data["earliest_arrival"])

    def test_avoiding_a_line_keeps_its_other_lines(self):
        data = self.plan(self.GUGULETHU, self.WATERFRONT, exclude_lines=["mr:southern"])
        self.assertNotIn("mr:southern", [r["line"]["key"] for r in self.rides(data)])
        self.assertEqual(data["exclusions"]["lines"], ["mr:southern"])
        self.assertGreater(data["exclusions"]["routes_banned"], 0)

    def test_unknown_lines_are_reported_and_ignored(self):
        data = self.plan(self.GUGULETHU, self.WATERFRONT, exclude_lines=["nope"])
        self.assertEqual(data["exclusions"]["unknown_lines"], ["nope"])
        self.assertEqual(data["exclusions"]["lines"], [])
        self.assertEqual(data["path_objs"], self.plan(self.GUGULETHU, self.WATERFRONT)["path_objs"])

    def test_nothing_found_because_of_what_was_avoided_says_so(self):
        data = self.plan(self.GUGULETHU, self.WATERFRONT, exclude_modes=[1])
        self.assertIsNone(data["earliest_arrival"])
        self.assertTrue(data["blocked_by_exclusions"])
        self.assertEqual(data["blocked_by"], [{"type": "mode", "mode": 1, "label": "Golden Arrow"}])

    def test_no_hint_when_nothing_is_avoided_or_the_trip_is_possible(self):
        self.assertNotIn("blocked_by_exclusions", self.plan(self.GUGULETHU, self.WATERFRONT))
        self.assertNotIn("blocked_by_exclusions", self.plan(self.GUGULETHU, self.WATERFRONT, exclude_modes=[2]))

    def test_exclusion_values_are_validated(self):
        body = {"source_lat": 0, "source_lon": 0, "target_lat": 1, "target_lon": 1, "day": 1, "time": "08:00"}
        for extra in ({"exclude_modes": [3]}, {"exclude_modes": [0, 1, 2, 1]}, {"exclude_lines": ["x"] * 51}):
            self.assertEqual(self.client.post("/api/plan/", {**body, **extra}, format="json").status_code, 400)


class InputValidationTests(APITestCase):
    BODY = {"source_lat": -33.9221, "source_lon": 18.4257, "target_lat": -33.9806, "target_lon": 18.4653,
            "day": 1, "time": "08:00"}

    def post_plan(self, **changes):
        return self.client.post("/api/plan/", {**self.BODY, **changes}, format="json")

    def test_plan_rejects_bad_times_and_limits(self):
        for field, value in (
            ("day", 7), ("day", -1), ("time", "25:00"), ("time", "08:60"), ("time", "99:00"), ("time", "abc"),
            ("departure_minutes", -1), ("departure_minutes", 7 * 24 * 60), ("max_rounds", 0), ("max_rounds", -3),
            ("max_rounds", 9), ("source_lat", 1000), ("source_lat", "NaN"),
        ):
            with self.subTest(field=field, value=value):
                resp = self.post_plan(**{field: value})
                self.assertEqual(resp.status_code, 400, resp.data)
                self.assertIn(field, resp.data)

    @needs_feed
    def test_plan_needs_a_departure(self):
        body = {k: v for k, v in self.BODY.items() if k not in ("day", "time")}
        self.assertEqual(self.client.post("/api/plan/", body, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/plan/", {**body, "departure_minutes": 1920}, format="json").status_code, 200)

    def test_plan_outside_cape_town_says_so(self):
        for name, place in (("London", (51.5, -0.12)), ("Johannesburg", (-26.2, 28.04)), ("Cape Point", (-34.357, 18.497))):
            with self.subTest(name):
                resp = self.post_plan(source_lat=place[0], source_lon=place[1])
                self.assertEqual(resp.status_code, 400)
                self.assertIn("outside the area", resp.data["source"][0])
                resp = self.post_plan(target_lat=place[0], target_lon=place[1])
                self.assertIn("target", resp.data)

    @needs_feed
    def test_lines_rejects_bad_query_params(self):
        for query in ("limit=abc", "limit=0", "limit=500", "mode=x", "mode=9", "keys=" + ",".join(["a"] * 51)):
            with self.subTest(query):
                self.assertEqual(self.client.get(f"/api/lines/?{query}").status_code, 400)
        self.assertEqual(self.client.get("/api/lines/?mode=&q=101").status_code, 200)

    def test_plan_is_throttled(self):
        from django.conf import settings

        allowed = int(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["plan"].split("/")[0])
        codes = [self.post_plan(source_lat="x").status_code for _ in range(allowed + 1)]
        self.assertEqual(codes[-1], 429)
        self.assertNotIn(429, codes[:-1])


class ServiceAreaTests(APITestCase):
    @needs_feed
    def test_every_stop_is_inside(self):
        from .raptor_engine import get_engine
        from . import service_area

        outside = [s.id for s in get_engine().stops.values() if not service_area.contains(s.lat, s.lon)]
        self.assertEqual(outside, [], "widen api/service_area.py")

    def test_address_search_keeps_to_the_area(self):
        from unittest import mock

        from . import geocode

        payload = {"features": [
            {"geometry": {"coordinates": [18.42, -33.92]}, "properties": {"name": "Cape Town"}},
            {"geometry": {"coordinates": [28.04, -26.2]}, "properties": {"name": "Johannesburg"}},
        ]}
        fake = mock.MagicMock()
        fake.__enter__.return_value = fake
        with mock.patch.object(geocode.urllib.request, "urlopen", return_value=fake) as urlopen, \
                mock.patch.object(geocode.json, "load", return_value=payload):
            found = self.client.get("/api/geocode/", {"q": "town"}).data
        self.assertEqual([r["label"] for r in found], ["Cape Town"])
        self.assertIn("bbox=18.27%2C-34.26%2C19.06%2C-33.42", urlopen.call_args[0][0].full_url)


class AccessControlTests(APITestCase):
    def test_timetable_tables_are_read_only(self):
        for path in ("/api/stops/", "/api/routes/", "/api/trips/", "/api/stop-times/", "/api/agencies/",
                     "/api/calendars/", "/api/calendar-dates/"):
            with self.subTest(path):
                self.assertEqual(self.client.post(path, {}, format="json").status_code, 405)
                resp = self.client.get(path)
                self.assertEqual(resp.status_code, 200)
                self.assertIn("results", resp.data)

    def test_login_is_throttled(self):
        from django.conf import settings

        allowed = int(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["login"].split("/")[0])
        codes = [
            self.client.post("/api/login/", {"username": "nobody", "password": "guess"}, format="json").status_code
            for _ in range(allowed + 1)
        ]
        self.assertEqual(codes[-1], 429)

    def test_username_change_is_case_insensitive(self):
        User.objects.create_user("Admin", "admin@example.com", STRONG)
        user = User.objects.create_user("thandi", "t@example.com", STRONG)
        auth(self.client, user)
        resp = self.client.patch("/api/user/", {"username": "admin"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("username", resp.data)

    def test_changing_the_password_signs_out_other_devices(self):
        user = User.objects.create_user("thandi", "t@example.com", STRONG)
        other = auth(self.client, user)
        here = auth(self.client, user)
        resp = self.client.put("/api/user/change_password/", {"old_password": STRONG, "new_password": "rail-Harbour-77"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {other['access']}")
        self.assertEqual(self.client.get("/api/user/").status_code, 401)
        self.client.credentials()
        for old in (other["refresh"], here["refresh"]):
            self.assertEqual(self.client.post("/api/token/refresh/", {"refresh": old}, format="json").status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
        self.assertEqual(self.client.get("/api/user/").status_code, 200)
        self.client.credentials()
        self.assertEqual(self.client.post("/api/token/refresh/", {"refresh": resp.data["refresh"]}, format="json").status_code, 200)
