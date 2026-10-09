import { Link } from "react-router-dom";
import Page from "../components/Page";
import { Wordmark } from "../components/Brand";
import { MODE_STYLE } from "../lib/journey";
import { Button, Panel, TextLink } from "../components/ui";
import { PORTFOLIO_URL } from "../lib/site";

const OPERATORS = [
    ["MyCiTi", "City of Cape Town bus rapid transit", MODE_STYLE.myciti.color],
    ["Golden Arrow", "Golden Arrow Bus Services", MODE_STYLE["golden-arrow"].color],
    ["Metrorail", "PRASA commuter rail", MODE_STYLE.metrorail.color],
];

const SOURCES = [
    ["Timetables", "Published MyCiTi (City of Cape Town, myciti.org.za), Golden Arrow and PRASA Metrorail timetables, converted to GTFS. The timetables belong to their operators."],
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
                <img src="/logo.svg" alt="" className="h-20 w-20 rounded-3xl bg-white shadow-md ring-1 ring-brand-100" />
                <div className="flex flex-col items-center gap-1">
                    <h1 className="text-3xl sm:text-4xl">
                        <Wordmark alt="WayFound" />
                    </h1>
                    <p className="text-sm font-medium text-mist-600 sm:text-base">Cape Town Journey Planner</p>
                </div>
                <p className="max-w-xl text-sm text-mist-700 sm:text-base">
                    Plan a trip across Cape Town’s buses and trains in one place. Choose where you’re starting and where
                    you’re going, and WayFound combines the walking, the bus and the train into one journey.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                    <Button to="/">Plan a journey</Button>
                    <Button to="/faq" variant="secondary">How it works</Button>
                </div>
            </Panel>

            <Card title="This is a demo">
                <div className="flex flex-col gap-2 text-sm text-mist-700">
                    <p>
                        WayFound is a portfolio project, hosted on a small scale to show how it works. It is not an
                        official transport service and is not affiliated with the City of Cape Town, MyCiTi, Golden
                        Arrow or PRASA Metrorail.
                    </p>
                    <p>
                        Its timetables are copies of the ones the operators publish, taken on a particular date, so
                        services may have changed since. Don’t rely on it for a trip that matters: check the operator’s
                        own timetable first. Accounts and saved routes may be removed at any time.
                    </p>
                </div>
            </Card>

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
                    the earliest arrival in rounds, one per vehicle you board. Preferences such as less walking or fewer
                    transfers change the search.
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
                <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-800">
                    Timetables can change faster than we can update them, and some stops are only known to the nearest
                    area. Check with the operator before an important trip, and{" "}
                    <Link to="/report" className="font-medium underline hover:no-underline">tell us</Link> if something
                    is wrong.
                </p>
            </Card>

            <Card title="Who built it">
                <p className="text-sm text-mist-700">
                    WayFound is designed and built by EJMLabs (Evian McKeown). See more of the work on{" "}
                    <TextLink href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">the portfolio site</TextLink>.
                    Questions, ideas or something wrong? <TextLink to="/report">Get in touch</TextLink>.
                </p>
            </Card>
        </Page>
    );
}
