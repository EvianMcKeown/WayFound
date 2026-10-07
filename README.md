# RAPTOR Journey Planner (WayFound)

**CSC3003S Capstone Project — Stage 4: Implementation and Testing**

A Django and React public transport journey planner for Cape Town, built on the [RAPTOR algorithm](https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf) for fast and efficient transit routing. The web app is called **WayFound**.

![WayFound planner on a desktop: a Metrorail journey from Cape Town Station to Claremont drawn on the map, with the trip's legs listed in the left panel](docs/screenshots/planner.png)

On a phone the map fills the screen and the planner is a bottom sheet over it. Once a trip is found the search folds to a one-line summary, and scrolling into the trip grows the sheet to show every step.

| Search | Trip found | Scrolled into the trip |
|---|---|---|
| ![Mobile planner with the search form open in a bottom sheet](docs/screenshots/planner-mobile-search.png) | ![Mobile planner with the route on the map and the trip summary in the sheet](docs/screenshots/planner-mobile-result.png) | ![Mobile planner with the sheet expanded to the trip's steps](docs/screenshots/planner-mobile-steps.png) |

---

## Description

WayFound lets users plan trips across Cape Town's buses and trains in one place. It uses **GTFS data** for MyCiTi, Golden Arrow and PRASA Metrorail and the **RAPTOR (Round-Based Public Transit Routing) algorithm** to compute routes between places, considering walking, transfers and travel times.

Unlike traditional shortest-path algorithms (e.g., Dijkstra's), RAPTOR works in **rounds**, making it both **faster and more scalable** for journey planning across large transport networks. Dijkstra is also included so the two can be compared on the same journey.

### Features
- Journey planning from any address or place to any other, with the RAPTOR algorithm (or Dijkstra, under Options for comparison).  
- Walking to and from stops, transfers, and route preferences (minimise walking, fewer transfers).  
- Avoid transport: switch an operator (MyCiTi, Golden Arrow, Metrorail) off, or search for a single line (a MyCiTi number, a Metrorail line, a Golden Arrow pair of places) and the planner leaves it out. "Avoid" on a ride in the result does the same in one tap, with Undo. If nothing is found because of what is avoided, the result says which one is in the way and offers to allow it. Signed-in riders can keep their choices as defaults.  
- Compare routes: the best route is the default, and "Compare routes" shows up to four more, ranked by arrival time and labelled "Fastest", "Fewest transfers" and "Least walking". Choose any of them as the route in use; a saved route remembers the choice.  
- Legs are shown per operator, each in its own colour (MyCiTi, Golden Arrow, Metrorail) with a walk, bus or train badge.  
- Responsive layout: floating panels over the map on desktop, a map-first bottom sheet on mobile.  
- Small, calm animations: icons that turn, pulse and morph, a route that fades in on the map, and legs that rise in one by one. They are switched off for anyone who prefers reduced motion.  
- Accounts (JWT sign-in with token refresh), saved routes that can be renamed and re-planned, and saved journey preferences.  
- Issue reports, attached to the journey or "no route" result they came from.  
- Django REST API for planning, geocoding, accounts, saved routes, preferences and reports.  
- GTFS repair, cleaning and rebuild scripts for the operator timetables.  

**Comparing routes.** Open "Compare routes" under the trip headline (on a phone it is in the sheet, and opening it expands the sheet) to see the other options as cards. The other routes are drawn faintly on the map, and hovering or focusing a card previews it. Choosing a card makes it the route on the map, in the itinerary, in Save and in a problem report.

| Desktop | Phone |
|---|---|
| ![Desktop planner with the route options open: the fastest route in use and a slower one with fewer minutes of walking](docs/screenshots/planner-compare.png) | ![Phone planner with the sheet expanded to the route options](docs/screenshots/planner-mobile-compare.png) |

**Avoiding transport.** Under Options, "Transport" has a switch per operator and a search for single lines. Choices are for that search; "Make these my defaults" (signed in) keeps them in your profile, and Settings has the same controls under "Transport I avoid". Walking is never avoided, so a trip can always fall back to it.

![The planner's Options panel on a desktop with Metrorail switched off, and a result that does not use trains](docs/screenshots/planner-avoid.png)

---

## Project Status

- ✅ **Stage 1** – Project Startup  
- ✅ **Stage 2** – Planning and Modelling  
- ✅ **Stage 3** – Prototype  
- 🔄 **Stage 4** – Implementation and Testing (current)  

---

## Badges

[![Python](https://img.shields.io/badge/Python-3.11-blue.svg)](https://www.python.org/)
[![Django](https://img.shields.io/badge/Django-5.2-green.svg)](https://www.djangoproject.com/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vite.dev/)

---

## Installation

### Requirements
- Python 3.11+  
- Node.js 20.19+ (or 22+) and npm  
- The GTFS dataset in `data/gtfs/` (included in the repository)  
- [Git LFS](https://git-lfs.com/) for the video and zip assets (`*.mp4`, `*.zip`)  

### Setup
```bash
# Clone the repo
git clone https://github.com/EvianMcKeown/PublicTransportJourneyPlanner.git
cd PublicTransportJourneyPlanner

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# Install the backend dependencies
pip install -r requirements.txt

# Install the frontend dependencies
cd src/frontend
npm install
cd ../..
```

### Create the database
The SQLite database is **not stored in the repository** (it holds accounts and password hashes), so create your own:
```bash
cd src/backend
python manage.py migrate
python manage.py createsuperuser      # optional: an admin account for /admin
```
The planner reads the GTFS files straight from `data/gtfs/` (`settings.GTFS_FOLDER`), so the database only needs to hold users, saved routes, preferences and issue reports.

---

# Usage

### Start the Django development server
```bash
cd src/backend
python manage.py runserver          # API on http://127.0.0.1:8000
```

### Start the frontend server
```bash
cd src/frontend
npm run dev                         # note the port number it prints (usually 5173)
```

### Access the web app
```
http://localhost:5173
```
The planner works without signing in. Saving routes and changing preferences needs an account (create one from **Create account**).

### Production build
```bash
cd src/frontend
npm run build                       # output in dist/
npm run preview                     # http://localhost:4173, forwards /api and /admin to Django on :8000
```
A real host must send unknown paths to `index.html` (the client-side routes `/login`, `/signup`, `/faq`, ...) and forward `/api` to Django. To point a build at another backend, set `VITE_API_BASE_URL` when building.

### Tests and checks
```bash
pytest algorithm_prototype/tests                  # from the repo root: RAPTOR, Dijkstra, GTFS pipeline
cd src/backend && python manage.py test api       # API: sign-up, token refresh, saved routes, preferences, reports
cd src/frontend && npm run lint                   # ESLint
```

### Screenshots of every page
`scripts/screenshot.mjs` drives headless Chrome (or Edge) over the DevTools protocol, with no dependencies, and captures every page and state at 1440 and 390 pixels wide, including the mobile sheet states. It needs Node 22+ and both dev servers running.
```bash
node scripts/screenshot.mjs --out shots                                  # public pages
node scripts/screenshot.mjs --out shots --user NAME --password PASS      # plus the signed-in pages
node scripts/screenshot.mjs --out shots --only planner-result,login      # a few shots
node scripts/screenshot.mjs --out shots --chrome "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"   # Windows
```
Use a throwaway account created through the sign-up page for the signed-in shots. The `planner-wheel-up-down` shot also checks that the mobile sheet grows when scrolled and shrinks again, and fails if it does not.

### Help video
[![WayFound help video: plan a trip on desktop and phone](src/frontend/public/help-video-poster.jpg)](src/frontend/public/help-video.mp4)

*A 65 second silent walkthrough with captions: plan a trip across three operators, save it, then do it again on a phone. Click the picture to play it.*

The video on the Help page (`src/frontend/public/help-video.mp4`, with a poster and English captions) is rendered by script, so it can be re-shot after a design change. `scripts/video/record.mjs` builds the app, plays a storyboard in a browser with a smoothed pointer, camera zooms, captions and finger gestures, and renders it frame by frame at 60 fps (the browser's clock is paused between frames, so it is smooth however slow the machine is). It needs ffmpeg, a Chrome or Edge, Node 22+ and Django running on :8000.
```bash
node scripts/video/record.mjs --chrome "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --out src/frontend/public
node scripts/video/record.mjs --chrome <browser> --out video-test --fps 30 --only phone    # a quick preview of one scene
```
It renders on the graphics card (`--gpu nvidia` by default) and stops if the browser ends up on a different one, such as an integrated GPU; use `--gpu software` for the CPU renderer. A fixed clock (Tuesday 08:00) and fixed address suggestions keep every take identical.

---

## Project structure

| Path | What is in it |
|---|---|
| `algorithm_prototype/` | RAPTOR and Dijkstra, the GTFS reader, and their tests |
| `src/backend/` | Django REST API (planning, geocoding, accounts, saved routes, preferences, reports) |
| `src/frontend/` | React 19, Vite and Tailwind 4 web app |
| `src/journey_planner/` | The earlier Django prototype, kept for reference |
| `data/gtfs/` | The cleaned GTFS feed, plus the repair and rebuild scripts in `data/gtfs/scripts/` |
| `scripts/` | Developer tools (`screenshot.mjs`, and `video/` for the help video) |
| `docs/plans/` | Planning documents (palette, accounts, timetable rebuilds, crowdsourced routes, design system) |
| `docs/screenshots/` | Images used in this README |

---

## Design system

The design tokens (a primitive palette, semantic colours with one colour per transport operator, radii, spacing and a type scale) live in `src/frontend/src/index.css`, and the shared components in `src/frontend/src/components/`.

Operator colours: MyCiTi `#0a5689`, Golden Arrow `#fa8c26`, Metrorail `#00b0df`. The brand green is kept for actions and the logo only.

---

## Data and credits

- **Timetables:** published MyCiTi, Golden Arrow and PRASA Metrorail timetables, converted to GTFS. Stop positions come from Western Cape Government transport data and OpenStreetMap contributors, and were repaired with the scripts in `data/gtfs/scripts/`. See `docs/plans/` for how each operator feed was rebuilt. Raw operator files are not redistributed (`data/raw/` is git-ignored).
- **Map:** [OpenFreeMap](https://openfreemap.org/), © OpenMapTiles, © OpenStreetMap contributors. **Address search:** [Photon](https://photon.komoot.io/) by Komoot, using OpenStreetMap data.
- Timetables can change faster than the feed is updated, and some stops are only known to the nearest area (shown as "area" in a journey). Check with the operator before an important trip.

---

## Security notes

- The development settings are for local use only: `DEBUG = True`, `ALLOWED_HOSTS = ["*"]` and a development `SECRET_KEY` in `src/backend/backend/settings.py`. Set a new secret key, turn debug off and restrict the allowed hosts before any real deployment.
- Local databases (`*.sqlite3`) are git-ignored. Never commit one: it holds accounts, password hashes and sessions.
- Personal access tokens belong in your own tool configuration, never in the repository.
