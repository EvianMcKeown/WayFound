import { useMemo } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { getToken } from "../lib/api";

const NAV = [
    { to: "/home", label: "Plan" },
    { to: "/savedroutes", label: "Saved" },
    { to: "/faq", label: "FAQ" },
    { to: "/settings", label: "Settings" },
];

const linkClass = ({ isActive }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

export default function AppShell({ children }) {
    const navigate = useNavigate();

    const isSuperUser = useMemo(() => {
        const token = getToken();
        if (!token) return false;
        try {
            return Boolean(jwtDecode(token).is_superuser);
        } catch {
            return false;
        }
    }, []);

    const signOut = () => {
        localStorage.removeItem("access");
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
                    {NAV.map((item) => (
                        <NavLink key={item.to} to={item.to} className={linkClass}>
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
                    <button
                        type="button"
                        onClick={signOut}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                        Sign out
                    </button>
                </div>
            </header>
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </div>
    );
}
