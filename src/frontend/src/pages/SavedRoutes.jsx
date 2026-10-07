import { useEffect, useState } from "react";
import Page from "../components/Page";
import { Alert, Button, Field, Panel } from "../components/ui";
import { apiFetch } from "../lib/api";
import { savedRouteLink } from "../lib/plannerLink";
import { CheckIcon } from "../components/icons";

const defaultName = (r) => `${r.start_location} → ${r.end_location}`;

const rideCount = (signature) => (signature === "walk" ? 0 : signature.split("|").length);

function RouteRow({ route, onRename, onDelete, onUseFastest }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(route.name);
    const [busy, setBusy] = useState(false);

    const save = async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await onRename(route.id, name.trim());
        setBusy(false);
        if (ok) setEditing(false);
    };

    const cancel = () => {
        setName(route.name);
        setEditing(false);
    };

    return (
        <Panel as="li" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            {editing ? (
                <form onSubmit={save} className="flex min-w-0 flex-1 items-center gap-2">
                    <Field
                        id={`name-${route.id}`}
                        label="Route name"
                        labelHidden
                        autoFocus
                        maxLength={100}
                        value={name}
                        placeholder={defaultName(route)}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && cancel()}
                        className="min-w-0 flex-1"
                    />
                    <Button type="submit" size="sm" disabled={busy}>Save</Button>
                    <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
                </form>
            ) : (
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-mist-900">{route.name || defaultName(route)}</p>
                    {route.name && (
                        <p className="truncate text-xs text-mist-700">{defaultName(route)}</p>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mist-600">
                        <span>Saved {new Date(route.created_at).toLocaleDateString()}</span>
                        {route.route_signature && (
                            <span
                                className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800"
                                title="Plan opens on the alternative route you chose, not the fastest one"
                            >
                                <CheckIcon className="h-3 w-3" />
                                Chosen route · {rideCount(route.route_signature)} {rideCount(route.route_signature) === 1 ? "ride" : "rides"}
                            </span>
                        )}
                    </p>
                </div>
            )}

            {!editing && (
                <div className="flex shrink-0 flex-wrap gap-2">
                    <Button to={savedRouteLink(route)} size="sm">Plan</Button>
                    {route.route_signature && (
                        <Button variant="secondary" size="sm" onClick={() => onUseFastest(route.id)} className="whitespace-nowrap">
                            Use fastest
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                        Rename
                    </Button>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={() => onDelete(route.id)}
                        aria-label={`Delete ${route.name || defaultName(route)}`}
                    >
                        Delete
                    </Button>
                </div>
            )}
        </Panel>
    );
}

export default function SavedRoutes() {
    const [routes, setRoutes] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        apiFetch("/api/saved-routes/", { auth: true })
            .then((data) => setRoutes(Array.isArray(data) ? data : data.results ?? []))
            .catch((err) => setError(err.message));
    }, []);

    const rename = async (id, name) => {
        try {
            const updated = await apiFetch(`/api/saved-routes/${id}/`, { method: "PATCH", auth: true, body: { name } });
            setRoutes((rs) => rs.map((r) => (r.id === id ? updated : r)));
            setError(null);
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        }
    };

    const useFastest = async (id) => {
        try {
            const updated = await apiFetch(`/api/saved-routes/${id}/`, { method: "PATCH", auth: true, body: { route_signature: "" } });
            setRoutes((rs) => rs.map((r) => (r.id === id ? updated : r)));
            setError(null);
        } catch (err) {
            setError(err.message);
        }
    };

    const remove = async (id) => {
        try {
            await apiFetch(`/api/saved-routes/${id}/`, { method: "DELETE", auth: true });
            setRoutes((rs) => rs.filter((r) => r.id !== id));
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Page width="md">
            <h1 className="text-xl font-semibold tracking-tight">Saved routes</h1>

            {error && <Alert>{error}</Alert>}
            {routes === null && !error && <p className="text-sm text-mist-600">Loading…</p>}
            {routes?.length === 0 && (
                <Panel className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                    <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                            <path d="M7 4h10v16l-5-4-5 4z" />
                        </svg>
                    </span>
                    <h2 className="text-lg font-semibold tracking-tight text-mist-900">No saved routes yet</h2>
                    <p className="text-sm text-mist-700">Plan a journey and choose “Save this route” to keep it here.</p>
                    <Button to="/">Plan a journey</Button>
                </Panel>
            )}

            <ul className="flex flex-col gap-3">
                {routes?.map((r) => (
                    <RouteRow key={r.id} route={r} onRename={rename} onDelete={remove} onUseFastest={useFastest} />
                ))}
            </ul>
        </Page>
    );
}
