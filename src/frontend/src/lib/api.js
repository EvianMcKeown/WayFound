export const API_BASE =
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

export const getToken = () => localStorage.getItem("access");

export async function apiFetch(path, { method = "GET", body, auth = false, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
    }

    const resp = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
    });

    const data = resp.status === 204 ? null : await resp.json().catch(() => null);
    if (!resp.ok) {
        throw new Error(data?.detail || data?.error || `Request failed (HTTP ${resp.status})`);
    }
    return data;
}
