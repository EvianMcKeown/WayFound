import sys
from datetime import date
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "data" / "gtfs" / "scripts"
sys.path.insert(0, str(SCRIPTS))
import gabs_parse as gp  # noqa: E402

SEP = "-" * 60

PAGE1 = f"""NYANGA - AIRPORT IND - BELLVILLE
MONDAYS TO FRIDAYS            EFFECTIVE DATE: 2026/10/19         TIMETABLE NUMBER: 0044 01
{SEP}
| NYANGA TERM         |05:30a|05:30b|23:50 | -- |
| ROBERT SOBUKWE RD   |via   |via   |via   | -- |
| BELLVILLE           |06:30a|06:20b|00:30 |07:00 |
{SEP}
SATURDAYS
{SEP}
| NYANGA TERM         |06:00 | -- |
| BELLVILLE           |06:30 | -- |
{SEP}
PAGE:   1
"""

PAGE2 = f"""NYANGA   - AIRPORT IND - BELLVILLE
{SEP}
|{SEP}
| NYANGA TERM         |07:00 |
| BELLVILLE           |07:40 |
SUNDAYS - NO SERVICE
ABBREVIATIONS
a   - Mondays,Tuesdays,Wednesdays,Thursdays
b   - Fridays

Every effort will be made to operate in accordance with this timetable
"""


def parse():
    return gp.parse_page(PAGE1 + "\n" + PAGE2, "x.pdf")


def test_header_and_sections():
    tt = parse()
    assert tt.number == "0044 01" and tt.effective == date(2026, 10, 19)
    assert tt.no_service == {6}


def test_letters_select_days_via_has_no_time_and_midnight_rolls():
    tt = parse()
    by_first = {(t.stops[0][1], t.letter): t for t in tt.trips}
    a = by_first[(5 * 60 + 30, "a")]
    b = by_first[(5 * 60 + 30, "b")]
    assert a.days == frozenset({0, 1, 2, 3}) and b.days == frozenset({4})
    assert a.stops[1] == ("ROBERT SOBUKWE RD", None)
    late = by_first[(23 * 60 + 50, "")]
    assert late.days == frozenset(range(5))
    assert late.stops[-1][1] == 24 * 60 + 30


def test_saturday_blocks_and_continuation_page_blocks():
    tt = parse()
    sat = [t for t in tt.trips if t.days == frozenset({5})]
    assert [t.stops[0][1] for t in sat] == [6 * 60, 7 * 60]
    late_block = [t for t in tt.trips if t.stops[0][1] == 7 * 60 and t.stops[-1][1] == 7 * 60 + 40]
    assert late_block and late_block[0].days == frozenset({5})


def test_single_time_column_is_skipped_and_reported():
    tt = parse()
    assert all(len([s for s in t.stops if s[1] is not None]) >= 2 for t in tt.trips)
    assert any("single time" in p for p in tt.problems)


def test_selection_by_effective_date():
    old = gp.Timetable("0044 01", "t", date(2026, 8, 1), "a")
    new = gp.Timetable("0044 01", "t", date(2026, 10, 5), "b")
    future = gp.Timetable("0044 01", "t", date(2026, 10, 19), "c")
    chosen, skipped = gp.select([old, new, future], date(2026, 10, 6))
    assert chosen["0044 01"].file == "b"
    assert {t.file for t, _ in skipped} == {"a", "c"}
