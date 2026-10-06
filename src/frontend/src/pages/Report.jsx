import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { useSession } from "../lib/auth";
import { alertClass, buttonClass, fieldClass, labelClass, linkClass, panelClass } from "../lib/ui";

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
            <Page width="sm" centered brand>
                <div className={`flex flex-col gap-3 rounded-2xl p-6 text-center ${panelClass}`}>
                    <h1 className="text-xl font-semibold tracking-tight">Thanks for letting us know</h1>
                    <p className="text-sm text-mist-600">We'll look into it and correct the data where we can.</p>
                    <Link to="/" className={`${buttonClass()} self-center`}>Back to the planner</Link>
                </div>
            </Page>
        );
    }

    return (
        <Page width="sm" centered brand>
            <form onSubmit={submit} className={`flex flex-col gap-4 rounded-2xl p-6 ${panelClass}`}>
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Report an issue</h1>
                    <p className="mt-1 text-sm text-mist-600">
                        Spotted a wrong time, a stop in the wrong place or something not working? Tell us.
                    </p>
                </div>

                {request && (
                    <p className="rounded-lg border border-mist-200 bg-white/70 px-3 py-2 text-xs text-mist-600">
                        Your journey from <strong className="font-medium text-mist-800">{request.origin?.label}</strong> to{" "}
                        <strong className="font-medium text-mist-800">{request.destination?.label}</strong> ({request.time}) is
                        attached to this report.
                    </p>
                )}

                {error && <p role="alert" className={alertClass(true)}>{error}</p>}

                <div>
                    <label htmlFor="category" className={labelClass}>What kind of problem?</label>
                    <select id="category" required value={form.category} onChange={set("category")} className={fieldClass}>
                        <option value="" disabled>Choose one</option>
                        {CATEGORIES.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label htmlFor="description" className={labelClass}>What happened?</label>
                    <textarea
                        id="description"
                        required
                        minLength={10}
                        maxLength={MAX_DESCRIPTION}
                        rows={5}
                        value={form.description}
                        onChange={set("description")}
                        placeholder="e.g. The 07:40 bus from Wynberg didn't stop at Claremont."
                        className={`${fieldClass} resize-y`}
                    />
                    <p className="mt-1 text-right text-xs text-mist-500">
                        {form.description.length}/{MAX_DESCRIPTION}
                    </p>
                </div>

                {!session && (
                    <div>
                        <label htmlFor="contact_email" className={labelClass}>
                            Email <span className="font-normal text-mist-400">(optional, if you'd like a reply)</span>
                        </label>
                        <input
                            id="contact_email"
                            type="email"
                            autoComplete="email"
                            value={form.contact_email}
                            onChange={set("contact_email")}
                            className={fieldClass}
                        />
                    </div>
                )}

                <button type="submit" disabled={busy} className={buttonClass()}>
                    {busy ? "Sending…" : "Send report"}
                </button>

                <p className="text-center text-sm text-mist-600">
                    Questions rather than a problem? See <Link to="/faq" className={linkClass}>Help</Link>.
                </p>
            </form>
        </Page>
    );
}
