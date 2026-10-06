import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "data" / "gtfs" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import name_resolver as nr  # noqa: E402

PLACED = {"A": (-34.0, 18.50), "B": (-34.0, 18.60)}


def cand(name, lon, source="nominatim", kind="hospital"):
    return nr.Candidate(name, -34.0, lon, source, kind, nr.similarity("X HOSP", name))


def test_variants_expand_abbreviations_and_try_brand_first_and_spelling():
    assert nr.query_variants("TYGERBERG HOSP") == ["Tygerberg Hospital"]
    assert nr.query_variants("PANORAMA MEDI CLINIC") == ["Panorama Mediclinic", "Mediclinic Panorama"]
    assert "Blouberg Ridge" in nr.query_variants("BLAAUWBERG RIDGE")
    assert nr.query_variants("NYANGA TERM") == ["Nyanga"]


def test_similarity_rewards_fuller_official_names_and_distrusts_partial_ones():
    assert nr.similarity("SITE C", "Mxolisi Phetani (Site C)") >= 0.9
    assert nr.similarity("VILLAGE 3", "Khayelitsha Village 3") >= 0.9
    assert nr.similarity("TYGERBERG HOSP", "Tygerberg Hospital") >= 0.95
    assert nr.similarity("KILLARNEY GARDENS", "Killarney") < nr.MIN_SIMILARITY
    assert nr.similarity("BEACON VALLEY", "Beacon Hill Secondary School") < nr.MIN_SIMILARITY
    assert nr.similarity("BEACON VALLEY", "Beaconvale") < nr.MIN_SIMILARITY
    assert nr.similarity("KOEL BAY", "Koeel Bay") < nr.MIN_SIMILARITY


def test_a_namesake_far_away_fails_the_timetable_and_the_right_one_wins():
    legs = [("A", 6), ("B", 6)]
    near = cand("X Hospital", 18.55)
    far = cand("X Hospital", 18.90)
    res = nr.decide("X HOSP", [far, near], legs, PLACED)
    assert res.status == "auto" and res.best.lon == 18.55
    assert (res.best.neighbours_checked, res.best.neighbours_ok) == (2, 2)
    only_far = nr.decide("X HOSP", [far], legs, PLACED)
    assert only_far.status == "review" and "fails the timetable" in only_far.note


def test_unprovable_cases_go_to_review():
    near = cand("X Hospital", 18.55)
    assert nr.decide("X HOSP", [near], [], PLACED).status == "review"
    assert nr.decide("X HOSP", [near], [("Z", 5)], PLACED).status == "review"
    weak = nr.Candidate("Other Place", -34.0, 18.55, "nominatim", "suburb", 0.4)
    assert nr.decide("X HOSP", [weak], [("A", 6), ("B", 6)], PLACED).status == "review"
    assert nr.decide("X HOSP", [], [("A", 6)], PLACED).status == "none"


def test_single_neighbour_needs_a_strong_name_match():
    legs = [("A", 6)]
    good = nr.Candidate("X Hospital", -34.0, 18.55, "nominatim", "hospital", 0.95)
    fair = nr.Candidate("X Hospice", -34.0, 18.55, "nominatim", "hospital", 0.8)
    assert nr.decide("X HOSP", [good], legs, PLACED).status == "auto"
    assert nr.decide("X HOSP", [fair], legs, PLACED).status == "review"


def test_two_different_places_that_both_fit_are_ambiguous():
    legs = [("A", 6), ("B", 6)]
    one, two = cand("X Hospital", 18.540), cand("X Hospital", 18.545)
    assert nr.decide("X HOSP", [one, two], legs, PLACED).status == "auto"
    far = {"A": (-34.0, 18.50), "B": (-34.0, 18.60)}
    c1 = nr.Candidate("X Hospital", -33.97, 18.55, "nominatim", "hospital", 0.95)
    c2 = nr.Candidate("X Hospital", -34.03, 18.55, "nominatim", "hospital", 0.95)
    assert nr.decide("X HOSP", [c1, c2], legs, far).status == "ambiguous"


def test_resolved_names_become_neighbours_for_the_next_pass(tmp_path):
    cache = nr.GeocodeCache(tmp_path / "c.jsonl", network=False)
    cache.data["Y Hospital"] = [dict(name="Y Hospital", display="", lat=-34.0, lon=18.52, type="hospital", cls="amenity", ref="node/1")]
    cache.data["Z Hospital"] = [dict(name="Z Hospital", display="", lat=-34.0, lon=18.58, type="hospital", cls="amenity", ref="node/2")]
    legs = {"Y HOSP": [("A", 3), ("B", 9)], "Z HOSP": [("Y HOSP", 6)]}
    out = nr.resolve_all(["Z HOSP", "Y HOSP"], legs, PLACED, {}, cache)
    assert out["Y HOSP"].status == "auto" and out["Z HOSP"].status == "auto"


def test_cache_roundtrip_and_offline_mode_never_hits_the_network(tmp_path):
    path = tmp_path / "cache.jsonl"
    path.write_text(json.dumps({"q": "Foo", "results": [{"name": "Foo"}]}) + "\n")
    assert nr.GeocodeCache(path, network=False).search("Foo") == [{"name": "Foo"}]
    assert nr.GeocodeCache(path, network=False).search("Never Seen") == []


def many_placed(n=5):
    return {f"N{i}": (-34.0, 18.50 + 0.02 * i) for i in range(n)}


def test_synonyms_and_old_spellings_are_folded_when_comparing():
    assert nr.similarity("MELKBOS", "Melkbosstrand") >= 0.9
    assert nr.similarity("BLUE ROUTE CENTRE", "Blue Route Mall") >= 0.9
    assert nr.similarity("BLUE ROUTE CENTRE", "Blue Route Shopping Centre") >= 0.9
    assert "Blue Route Mall" in nr.query_variants("BLUE ROUTE CENTRE")
    assert nr.compare("TAFELSIG LOST CITY", "Tafelsig")[1] == "head"
    assert nr.compare("BEACON VALLEY", "Beaconvale")[1] == "spelling"


def test_head_of_name_needs_strong_timetable_support():
    placed = many_placed(5)
    head = nr.Candidate("Tafelsig", -34.0, 18.54, "local:osm-place", "suburb", 0.62, match="head")
    few = [(f"N{i}", 10) for i in range(3)]
    many = [(f"N{i}", 10) for i in range(5)]
    assert nr.decide("TAFELSIG LOST CITY", [head], few, placed).status == "review"
    res = nr.decide("TAFELSIG LOST CITY", [head], many, placed)
    assert res.status == "auto" and "head-of-name" in res.note and res.best.approximate


def test_spelling_only_resemblance_is_never_automatic():
    placed = many_placed(6)
    legs = [(f"N{i}", 10) for i in range(6)]
    wrong_suburb = nr.Candidate("Beaconvale", -34.0, 18.54, "nominatim", "suburb", 0.74, match="spelling")
    assert nr.decide("BEACON VALLEY", [wrong_suburb], legs, placed).status == "review"


def test_a_neighbour_that_fails_for_every_candidate_is_ignored():
    placed = many_placed(5)
    placed["BAD"] = (-34.0, 19.5)
    legs = [(f"N{i}", 10) for i in range(5)] + [("BAD", 5)]
    a = nr.Candidate("Epping Hospital", -34.0, 18.54, "nominatim", "hospital", 1.0)
    b = nr.Candidate("Epping Hospital", -34.0, 18.5405, "nominatim", "hospital", 1.0)
    res = nr.decide("EPPING HOSP", [a, b], legs, placed)
    assert res.status == "auto" and "ignored 1 neighbour" in res.note
    assert nr.decide("EPPING HOSP", [a], legs, placed).status == "review"


def test_clear_timetable_fit_beats_a_namesake_that_merely_passes():
    placed = {"A": (-34.0, 18.50), "B": (-34.0, 18.56)}
    legs = [("A", 10), ("B", 10)]
    good = nr.Candidate("Metro Industrial Township", -34.0, 18.53, "local:osm-place", "suburb", 0.9)
    namesake = nr.Candidate("Metro", -34.0, 18.64, "nominatim", "yes", 1.0)
    res = nr.decide("METRO", [namesake, good], legs, placed)
    assert res.status == "auto" and res.best.name == "Metro Industrial Township"


def test_bigger_cluster_wins_and_stop_beats_place_beats_road_within_it():
    placed = many_placed(5)
    legs = [(f"N{i}", 12) for i in range(5)]
    stop = nr.Candidate("Atlantis Station", -34.0, 18.540, "local:osm-transit", "stop", 0.9)
    town = nr.Candidate("Atlantis", -34.0, 18.543, "nominatim", "town", 1.0)
    mall = nr.Candidate("Atlantis City Mall", -34.0, 18.5405, "local:osm-place", "landmark", 0.9)
    lone = nr.Candidate("Atlantis Cemetery", -34.0, 18.58, "local:osm-transit", "stop", 0.9)
    res = nr.decide("ATLANTIS", [lone, town, mall, stop], legs, placed)
    assert res.status == "auto" and res.best.name == "Atlantis Station"
    only_equal = nr.decide("ATLANTIS", [stop, lone], legs, placed)
    assert only_equal.status == "ambiguous"


def test_equally_named_parts_far_apart_are_left_to_a_human():
    placed = many_placed(5)
    legs = [(f"N{i}", 12) for i in range(5)]
    one = nr.Candidate("Epping Industria 1", -34.0, 18.530, "local:osm-place", "suburb", 0.94)
    two = nr.Candidate("Epping Industria 2", -34.0, 18.550, "local:osm-place", "suburb", 0.94)
    res = nr.decide("EPPING IND", [one, two], legs, placed)
    assert res.status == "ambiguous" and "km apart" in res.note


def test_a_long_leg_proves_nothing_so_it_cannot_place_a_stop_alone():
    placed = {"A": (-34.0, 18.50)}
    c = nr.Candidate("X Hospital", -34.0, 18.55, "nominatim", "hospital", 1.0)
    assert nr.decide("X HOSP", [c], [("A", 6)], placed).status == "auto"
    long_leg = nr.decide("X HOSP", [c], [("A", 45)], placed)
    assert long_leg.status == "review" and "far-away namesake" in long_leg.note


def test_choosing_between_places_needs_two_neighbours():
    placed = {"A": (-34.0, 18.50)}
    one = nr.Candidate("X Hospital", -34.0, 18.52, "nominatim", "hospital", 1.0)
    two = nr.Candidate("X Hospital", -34.0, 18.60, "nominatim", "hospital", 1.0)
    big = [one, nr.Candidate("X Hospital", -34.0, 18.521, "nominatim", "hospital", 1.0),
           nr.Candidate("X Hospital", -34.0, 18.522, "nominatim", "hospital", 1.0)]
    res = nr.decide("X HOSP", big + [two], [("A", 10)], placed)
    assert res.status == "ambiguous" and "single neighbour" in res.note


def test_several_long_legs_from_different_directions_can_substitute_for_one_short_leg():
    placed = {"A": (-34.0, 18.50), "B": (-33.9, 18.60), "C": (-34.1, 18.60)}
    c = nr.Candidate("X Hospital", -34.0, 18.58, "nominatim", "hospital", 1.0)
    legs = [("A", 45), ("B", 45), ("C", 45)]
    assert nr.decide("X HOSP", [c], legs, placed).status == "auto"
    assert nr.decide("X HOSP", [c], legs[:2], placed).status == "review"


def test_timetable_only_position_guide_trilaterates_from_gaps():
    model = (nr.math.log(14.0), 0.5)
    ring = {"N": (-33.98, 18.55), "S": (-34.02, 18.55), "E": (-34.0, 18.58), "W": (-34.0, 18.52)}
    gaps = {k: 7 for k in ring}
    p = nr.expected_position(gaps, ring, model)
    assert abs(p.lat - -34.0) < 0.02 and abs(p.lon - 18.55) < 0.02
    assert nr.expected_position({}, ring, model) is None
    far = dict(ring, X=(-33.5, 19.0))
    p2 = nr.expected_position(dict(gaps, X=2), far, model)
    assert abs(p2.lat - -34.0) < 0.05 and abs(p2.lon - 18.55) < 0.05
