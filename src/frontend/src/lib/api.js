import { clearSession, getAccessToken, getRefreshToken, isExpired, setSession } from "./auth";

export const API_BASE =
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

export class SessionExpiredError extends Error {
    constructor() {
        super("Your session has expired. Please sign in again.");
        this.name = "SessionExpiredError";
    }
}

function errorMessage(data, status) {
    if (data?.detail || data?.error) return data.detail || data.error;
    if (data && typeof data === "object") {
        const first = Object.values(data).flat()[0];
        if (typeof first === "string") return first;
    }
    return `Request failed (HTTP ${status})`;
}

let refreshing = null;

function refreshAccessToken() {
    refreshing ??= (async () => {
        const refresh = getRefreshToken();
        if (!refresh || isExpired(refresh, 0)) throw new SessionExpiredError();
        const resp = await fetch(`${API_BASE}/api/token/refresh/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh }),
        });
        if (resp.status === 401) throw new SessionExpiredError();
        if (!resp.ok) throw new Error(`Could not renew your session (HTTP ${resp.status})`);
        const { access } = await resp.json();
        setSession({ access });
        return access;
    })().finally(() => {
        refreshing = null;
    });
    return refreshing;
}

async function request(path, { method = "GET", body, auth = false, signal }, retried) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
        let token = getAccessToken();
        if (!retried && isExpired(token)) token = await refreshAccessToken();
        headers.Authorization = `Bearer ${token}`;
    }

    const resp = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
    });

    if (resp.status === 401 && auth && !retried) {
        await refreshAccessToken();
        return request(path, { method, body, auth, signal }, true);
    }

    const data = resp.status === 204 ? null : await resp.json().catch(() => null);
    if (!resp.ok) {
        const err = new Error(errorMessage(data, resp.status));
        err.status = resp.status;
        err.data = data;
        throw err;
    }
    return data;
}

export async function apiFetch(path, options = {}) {
    try {
        return await request(path, options, false);
    } catch (err) {
        if (err instanceof SessionExpiredError) clearSession();
        throw err;
    }
}
