import { useMemo, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { getToken } from "../lib/api";

const NAV = [
    { to: "/", label: "Plan", end: true },
    { to: "/savedroutes", label: "Saved", account: true },
    { to: "/faq", label: "FAQ" },
    { to: "/settings", label: "Settings", account: true },
];

const linkClass = ({ isActive }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

export default function AppShell({ children }) {
    const navigate = useNavigate();

    const [token, setToken] = useState(getToken);

    const isSuperUser = useMemo(() => {
        if (!token) return false;
        try {
            return Boolean(jwtDecode(token).is_superuser);
        } catch {
            return false;
        }
    }, [token]);

    const signOut = () => {
        localStorage.removeItem("access");
        setToken(null);
        navigate("/");
    };

    return (
        <div className="flex h-dvh w-full flex-col bg-slate-50 text-slate-900 antialiased">
            <header className="flex shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
                <div className="flex items-center gap-2.5">
                    <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" />
                    <span className="text-base font-semibold tracking-tight">PathPilot</span>
                </div>
                <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                    {NAV.filter((item) => token || !item.account).map((item) => (
                        <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                            {item.label}
                        </NavLink>
                    ))}
                </nav>
                <div className="flex items-center gap-2">
                    {isSuperUser && (
                        <a
                            href={`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000"}/admin/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:block"
                        >
                            Admin
                        </a>
                    )}
                    {token ? (
                        <button
                            type="button"
                            onClick={signOut}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                        >
                            Sign out
                        </button>
                    ) : (
                        <>
                            <Link
                                to="/login"
                                className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                            >
                                Sign in
                            </Link>
                            <Link
                                to="/signup"
                                className="hidden rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 sm:block"
                            >
                                Sign up
                            </Link>
                        </>
                    )}
                </div>
            </header>
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </div>
    );
}
