import { useState } from "react";
import { useLocation } from "react-router-dom";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { useSession } from "../lib/auth";
import { Alert, Button, Field, Panel, TextLink } from "../components/ui";

const CATEGORIES = [
    ["wrong_time", "Wrong time or timetable"],
    ["stop_location", "Stop in the wrong place"],
    ["missing", "Missing route or stop"],
    ["app", "Problem with the app"],
    ["other", "Something else"],
];

const MAX_DESCRIPTION = 2000;

export default function Report() {
    const location = useLocation();
    const session = useSession();
    const context = location.state?.context ?? null;
    const request = context?.request;

    const [form, setForm] = useState({
        category: location.state?.category ?? (context ? "wrong_time" : ""),
        description: "",
        contact_email: "",
    });
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);

    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await apiFetch("/api/reports/", {
                method: "POST",
                auth: Boolean(session),
                body: {
                    ...form,
                    contact_email: session ? "" : form.contact_email,
                    context: { ...(context ?? { source: "general" }), page: location.pathname },
                },
            });
            setSent(true);
        } catch (err) {
            setError(err.status === 429 ? "You've sent several reports recently. Please try again later." : err.message);
        } finally {
            setBusy(false);
        }
    };

    if (sent) {
        return (
            <Page width="sm" centered>
                <Panel className="flex flex-col gap-3 p-6 text-center">
                    <h1 className="text-xl font-semibold tracking-tight">Thanks for letting us know</h1>
                    <p className="text-sm text-mist-700">We'll look into it and correct the data where we can.</p>
                    <Button to="/" className="self-center">Back to the planner</Button>
                </Panel>
            </Page>
        );
    }

    return (
        <Page width="sm" centered>
            <Panel as="form" onSubmit={submit} className="flex flex-col gap-4 p-6">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Report an issue</h1>
                    <p className="mt-1 text-sm text-mist-700">
                        Spotted a wrong time, a stop in the wrong place or something not working? Tell us.
                    </p>
                </div>

                {request && (
                    <p className="rounded-lg border border-mist-200 bg-white/70 px-3 py-2 text-xs text-mist-700">
                        Your journey from <strong className="font-medium text-mist-800">{request.origin?.label}</strong> to{" "}
                        <strong className="font-medium text-mist-800">{request.destination?.label}</strong> ({request.time}) is
                        attached to this report.
                    </p>
                )}

                {error && <Alert>{error}</Alert>}

                <Field id="category" label="What kind of problem?" as="select" required value={form.category} onChange={set("category")}>
                    <option value="" disabled>Choose one</option>
                    {CATEGORIES.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </Field>

                <div>
                    <Field
                        id="description"
                        label="What happened?"
                        as="textarea"
                        required
                        minLength={10}
                        maxLength={MAX_DESCRIPTION}
                        rows={5}
                        value={form.description}
                        onChange={set("description")}
                        placeholder="e.g. The 07:40 bus from Wynberg didn't stop at Claremont."
                        controlClassName="resize-y"
                    />
                    <p className="mt-1 text-right text-xs text-mist-600">
                        {form.description.length}/{MAX_DESCRIPTION}
                    </p>
                </div>

                {!session && (
                    <Field
                        id="contact_email"
                        label="Email"
                        note="(optional, if you'd like a reply)"
                        type="email"
                        autoComplete="email"
                        value={form.contact_email}
                        onChange={set("contact_email")}
                    />
                )}

                <Button type="submit" disabled={busy}>
                    {busy ? "Sending…" : "Send report"}
                </Button>

                <p className="text-center text-sm text-mist-700">
                    Questions rather than a problem? See <TextLink to="/faq">Help</TextLink>.
                </p>
            </Panel>
        </Page>
    );
}
