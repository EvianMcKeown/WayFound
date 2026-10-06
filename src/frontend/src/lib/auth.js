import { useEffect, useState } from "react";
import { jwtDecode } from "jwt-decode";

const ACCESS = "access";
const REFRESH = "refresh";
const EVENT = "auth-change";

function read(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function claims(token) {
    try {
        return jwtDecode(token);
    } catch {
        return null;
    }
}

export const isExpired = (token, skewMs = 30_000) => {
    const exp = token && claims(token)?.exp;
    return !exp || exp * 1000 - skewMs <= Date.now();
};

export const getAccessToken = () => read(ACCESS);
export const getRefreshToken = () => read(REFRESH);

const announce = () => window.dispatchEvent(new Event(EVENT));

export function setSession({ access, refresh }) {
    localStorage.setItem(ACCESS, access);
    if (refresh) localStorage.setItem(REFRESH, refresh);
    announce();
}

export function clearSession() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    announce();
}

export function getSession() {
    const access = read(ACCESS);
    const refresh = read(REFRESH);
    const usable = [access, refresh].find((t) => t && !isExpired(t, 0));
    if (!usable) return null;
    const c = claims(usable);
    return { username: c?.username || "Account", isSuperUser: Boolean(c?.is_superuser) };
}

export function useSession() {
    const [session, setSessionState] = useState(getSession);
    useEffect(() => {
        const update = () => setSessionState(getSession());
        window.addEventListener(EVENT, update);
        window.addEventListener("storage", update);
        return () => {
            window.removeEventListener(EVENT, update);
            window.removeEventListener("storage", update);
        };
    }, []);
    return session;
}
