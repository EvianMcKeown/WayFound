# WayFound

**Cape Town Journey Planner** · [wayfound.ejmlabs.co.za](https://wayfound.ejmlabs.co.za)

A public transport journey planner for Cape Town. It plans trips across MyCiTi, Golden Arrow and Metrorail with the [RAPTOR algorithm](https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf), counting walking, transfers and travel time. The backend is Django REST and the frontend is React.

![WayFound planner on a desktop: a Metrorail journey from Cape Town Station to Claremont drawn on the map, with the trip's legs listed in the left panel](docs/screenshots/planner.png)

RAPTOR works in rounds, one per vehicle boarded, which makes it faster than a shortest-path search such as Dijkstra's on a transit network. It reads the timetables as GTFS.

WayFound is a portfolio demo, not an official transport service, and it is not affiliated with the operators. Timetables can change faster than the feed is updated, so check with the operator before an important trip.

## Setup

Requires Python 3.11+, Node.js 20.19+ (or 22+) with npm, and [Git LFS](https://git-lfs.com/) for the help video.

```bash
git clone https://github.com/EvianMcKeown/WayFound.git
cd WayFound

python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cd src/frontend && npm install && cd ../..

cd src/backend
python manage.py migrate           # creates your own SQLite database
python manage.py createsuperuser   # optional, for /admin
```

The SQLite database is not in the repository, because it holds accounts and password hashes. The planner reads the GTFS files straight from `data/gtfs/`, so the database only holds users, saved routes, preferences and issue reports.

### Timetable data

The GTFS feed is not included: the timetables belong to MyCiTi (City of Cape Town), Golden Arrow and PRASA, and are not republished without their permission. The scripts in `data/gtfs/scripts/` fetch the operators' published timetables and build the feed into `data/gtfs/` (`myciti_fetch.py`, `prasa_fetch.py`, `gabs_fetch.py`, then the matching `*_build.py`). They need `pip install -r data/gtfs/scripts/requirements.txt`, and Golden Arrow needs poppler's `pdftotext`. Without the feed the planner cannot plan journeys, and the tests that need it are skipped.

## Run

```bash
cd src/backend && python manage.py runserver     # API on http://127.0.0.1:8000
cd src/frontend && npm run dev                   # app on http://localhost:5173
```

The planner works without signing in. Saving routes and changing preferences needs an account.

For a production build, run `npm run build` in `src/frontend` (output in `dist/`). Serve `dist/` with unknown paths sent to `index.html`, and forward `/api` to Django. Set `VITE_API_BASE_URL` when building to point at another backend.

Without environment variables Django runs as a development server (debug on, any host, a development-only key). For a real server:

```bash
export DJANGO_DEBUG=0
export DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(50))')"
export DJANGO_ALLOWED_HOSTS=wayfound.example
export DJANGO_HTTPS=1
python manage.py check --deploy
```

Django refuses to start with `DJANGO_DEBUG=0` and no secret key or allowed hosts.

## Tests

```bash
pytest algorithm_prototype/tests                  # RAPTOR and the GTFS pipeline, from the repo root
cd src/backend && python manage.py test api       # the API
cd src/frontend && npm run lint                   # ESLint
```

## Project structure

- `algorithm_prototype/`: RAPTOR, the GTFS reader and their tests
- `src/backend/`: the Django REST API
- `src/frontend/`: the React, Vite and Tailwind web app
- `data/gtfs/scripts/`: scripts that fetch, rebuild and repair the timetable feed

## Data and credits

- **Timetables:** published MyCiTi (City of Cape Town), Golden Arrow and PRASA Metrorail timetables, converted to GTFS. The operators own them, so the data is not published here. Stop positions come from Western Cape Government transport data and OpenStreetMap contributors.
- **Map:** [OpenFreeMap](https://openfreemap.org/), © OpenMapTiles, © OpenStreetMap contributors. **Address search:** [Photon](https://photon.komoot.io/) by Komoot, using OpenStreetMap data.
- **Page backdrop:** roads © OpenStreetMap contributors; terrain from NASA SRTM.

## Security

- Every API input is validated, so bad input gets a 400 and not a server error. Requests are rate limited per client, counted in Django's cache (use a shared cache such as Redis if you run several processes).
- Local databases (`*.sqlite3`) are git-ignored. Never commit one.
