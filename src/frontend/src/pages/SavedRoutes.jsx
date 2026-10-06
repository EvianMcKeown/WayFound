import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";

export default function SavedRoutes() {
    const navigate = useNavigate();
    const [routes, setRoutes] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        apiFetch("/api/saved-routes/", { auth: true })
            .then((data) => setRoutes(Array.isArray(data) ? data : data.results ?? []))
            .catch((err) => setError(err.message));
    }, []);

    const plan = (r) =>
        navigate(`/home?from=${encodeURIComponent(r.start_location)}&to=${encodeURIComponent(r.end_location)}`);

    const remove = async (id) => {
        try {
            await apiFetch(`/api/saved-routes/${id}/`, { method: "DELETE", auth: true });
            setRoutes((rs) => rs.filter((r) => r.id !== id));
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <AppShell>
            <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-4 sm:p-6">
                <h1 className="mb-4 text-xl font-semibold tracking-tight">Saved routes</h1>

                {error && (
                    <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        {error}
                    </p>
                )}
                {routes === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
                {routes?.length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                        No saved routes yet. Plan a journey and choose “Save this route”.
                    </p>
                )}

                <ul className="flex flex-col gap-3">
                    {routes?.map((r) => (
                        <li key={r.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-slate-900">{r.start_location}</p>
                                <p className="truncate text-sm text-slate-600">→ {r.end_location}</p>
                                <p className="mt-1 text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString()}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => plan(r)}
                                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Plan
                            </button>
                            <button
                                type="button"
                                onClick={() => remove(r.id)}
                                aria-label={`Delete route from ${r.start_location} to ${r.end_location}`}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                Delete
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </AppShell>
    );
}
