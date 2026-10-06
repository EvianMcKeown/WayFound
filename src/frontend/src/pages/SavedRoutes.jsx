import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { savedRouteLink } from "../lib/plannerLink";
import { alertClass, buttonClass, fieldClass, linkClass, panelClass } from "../lib/ui";

const defaultName = (r) => `${r.start_location} → ${r.end_location}`;

function RouteRow({ route, onRename, onDelete }) {
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
        <li className={`flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center ${panelClass}`}>
            {editing ? (
                <form onSubmit={save} className="flex min-w-0 flex-1 items-center gap-2">
                    <label htmlFor={`name-${route.id}`} className="sr-only">Route name</label>
                    <input
                        id={`name-${route.id}`}
                        autoFocus
                        maxLength={100}
                        value={name}
                        placeholder={defaultName(route)}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && cancel()}
                        className={fieldClass}
                    />
                    <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>Save</button>
                    <button type="button" onClick={cancel} className={buttonClass("ghost", "sm")}>Cancel</button>
                </form>
            ) : (
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-mist-900">{route.name || defaultName(route)}</p>
                    {route.name && (
                        <p className="truncate text-xs text-mist-600">{defaultName(route)}</p>
                    )}
                    <p className="mt-1 text-xs text-mist-500">Saved {new Date(route.created_at).toLocaleDateString()}</p>
                </div>
            )}

            {!editing && (
                <div className="flex shrink-0 gap-2">
                    <Link to={savedRouteLink(route)} className={buttonClass("primary", "sm")}>Plan</Link>
                    <button type="button" onClick={() => setEditing(true)} className={buttonClass("secondary", "sm")}>
                        Rename
                    </button>
                    <button
                        type="button"
                        onClick={() => onDelete(route.id)}
                        aria-label={`Delete ${route.name || defaultName(route)}`}
                        className={buttonClass("danger", "sm")}
                    >
                        Delete
                    </button>
                </div>
            )}
        </li>
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

            {error && (
                <p role="alert" className={alertClass(true)}>
                    {error}
                </p>
            )}
            {routes === null && !error && <p className="text-sm text-mist-500">Loading…</p>}
            {routes?.length === 0 && (
                <p className={`rounded-2xl p-6 text-center text-sm text-mist-600 ${panelClass}`}>
                    No saved routes yet. <Link to="/" className={linkClass}>Plan a journey</Link> and choose “Save this route”.
                </p>
            )}

            <ul className="flex flex-col gap-3">
                {routes?.map((r) => (
                    <RouteRow key={r.id} route={r} onRename={rename} onDelete={remove} />
                ))}
            </ul>
        </Page>
    );
}
