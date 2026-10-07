import { Link } from "react-router-dom";
import Brand from "../components/Brand";
import Page from "../components/Page";
import { MODE_STYLE } from "../lib/journey";
import { Button, Panel, TextLink } from "../components/ui";

const OPERATORS = [
    ["MyCiTi", "City of Cape Town bus rapid transit", MODE_STYLE.myciti.color],
    ["Golden Arrow", "Golden Arrow Bus Services", MODE_STYLE["golden-arrow"].color],
    ["Metrorail", "PRASA commuter rail", MODE_STYLE.metrorail.color],
];

const SOURCES = [
    ["Timetables", "Published MyCiTi, Golden Arrow and PRASA Metrorail timetables, converted to GTFS."],
    ["Stop positions", "Western Cape Government transport data and OpenStreetMap contributors."],
    ["Map", "OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors."],
    ["Address search", "Photon by Komoot, using OpenStreetMap data."],
];

function Card({ title, children }) {
    return (
        <Panel as="section" className="p-5">
            <h2 className="mb-2 text-sm font-semibold text-mist-800">{title}</h2>
            {children}
        </Panel>
    );
}

export default function About() {
    return (
        <Page width="lg">
            <Panel as="section" radius="3xl" className="flex flex-col items-center gap-5 px-6 py-10 text-center">
                <Brand size="xl" stacked to={null} />
                <p className="max-w-xl text-sm text-mist-700 sm:text-base">
                    Plan a trip across Cape Town’s buses and trains in one place. Choose where you’re starting and where
                    you’re going, and WayFound combines the walking, the bus and the train into one journey.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                    <Button to="/">Plan a journey</Button>
                    <Button to="/faq" variant="secondary">How it works</Button>
                </div>
            </Panel>

            <Card title="Services covered">
                <ul className="grid gap-3 sm:grid-cols-3">
                    {OPERATORS.map(([name, desc, color]) => (
                        <li key={name} className="flex items-start gap-3 rounded-xl border border-mist-200/80 bg-white/60 p-3">
                            <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
                            <span>
                                <span className="block text-sm font-medium text-mist-900">{name}</span>
                                <span className="block text-xs text-mist-700">{desc}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </Card>

            <Card title="How routes are found">
                <p className="text-sm text-mist-700">
                    WayFound finds the stops nearest to where you start and finish, then searches the timetables with{" "}
                    <strong className="font-medium">RAPTOR</strong>, a public-transport routing algorithm that works out
                    the earliest arrival in rounds, one per vehicle you board. You can switch to{" "}
                    <strong className="font-medium">Dijkstra</strong>’s shortest-path algorithm under Options to compare
                    the two. Preferences such as less walking or fewer transfers change the search.
                </p>
            </Card>

            <Card title="Where the data comes from">
                <dl className="grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
                    {SOURCES.map(([term, desc]) => (
                        <div key={term} className="contents">
                            <dt className="font-medium text-mist-800">{term}</dt>
                            <dd className="text-mist-700">{desc}</dd>
                        </div>
                    ))}
                </dl>
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Timetables can change faster than we can update them, and some stops are only known to the nearest
                    area. Check with the operator before an important trip, and{" "}
                    <Link to="/report" className="font-medium underline hover:no-underline">tell us</Link> if something
                    is wrong.
                </p>
            </Card>

            <Card title="Who built it">
                <p className="text-sm text-mist-700">
                    WayFound was built as a CSC3003S capstone project by Evian McKeown, Shaylen Naidoo and Benji Joss.
                    Questions or ideas? Email <TextLink href="mailto:PathPilot@gmail.com">PathPilot@gmail.com</TextLink>.
                </p>
            </Card>
        </Page>
    );
}
