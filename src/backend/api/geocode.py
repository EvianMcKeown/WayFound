import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.cache import cache
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import service_area

CACHE_TTL_SECONDS = 60 * 60
MIN_QUERY_LENGTH = 3
MAX_QUERY_LENGTH = 120
RESULT_LIMIT = 6
UPSTREAM_TIMEOUT_SECONDS = 12

BIAS_LAT, BIAS_LON = -33.9249, 18.4241


def _label(props: dict) -> str:
    street = " ".join(p for p in (props.get("housenumber"), props.get("street")) if p)
    parts = [
        props.get("name"),
        street or None,
        props.get("district") or props.get("suburb"),
        props.get("city"),
    ]
    seen, out = set(), []
    for part in parts:
        if part and part not in seen:
            seen.add(part)
            out.append(part)
    return ", ".join(out) or props.get("country", "Unknown place")


def _query_photon(q: str) -> list:
    base = getattr(settings, "GEOCODER_URL", "https://photon.komoot.io/api/")
    params = urllib.parse.urlencode(
        {
            "q": q,
            "limit": RESULT_LIMIT,
            "lang": "en",
            "lat": BIAS_LAT,
            "lon": BIAS_LON,
            "bbox": service_area.photon_bbox(),
        }
    )
    req = urllib.request.Request(
        f"{base}?{params}",
        headers={"User-Agent": getattr(settings, "GEOCODER_USER_AGENT", "WayFound/1.0")},
    )
    with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT_SECONDS) as resp:
        payload = json.load(resp)

    results = []
    for feature in payload.get("features", []):
        lon, lat = feature["geometry"]["coordinates"]
        if not service_area.contains(lat, lon):
            continue
        results.append(
            {
                "label": _label(feature.get("properties", {})),
                "lat": lat,
                "lon": lon,
            }
        )
    return results


class GeocodeView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "geocode"

    def get(self, request):
        q = " ".join(request.query_params.get("q", "").split())
        if len(q) < MIN_QUERY_LENGTH:
            return Response([])
        if len(q) > MAX_QUERY_LENGTH:
            return Response(
                {"detail": "Query too long."}, status=status.HTTP_400_BAD_REQUEST
            )

        key = "geocode:" + hashlib.sha1(q.lower().encode()).hexdigest()
        results = cache.get(key)
        if results is None:
            try:
                results = _query_photon(q)
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
                return Response(
                    {"detail": "Address search is temporarily unavailable."},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            cache.set(key, results, CACHE_TTL_SECONDS)
        return Response(results)
