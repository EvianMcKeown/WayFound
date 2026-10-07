import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { API_BASE } from "../lib/api";
import { clearSession, useSession } from "../lib/auth";
import { surfaceClass } from "../lib/ui";
import { Button, Panel } from "./ui";
import Brand from "./Brand";
import { ChevronIcon, MenuIcon } from "./icons";

const NAV = [
    { to: "/", label: "Plan", end: true },
    { to: "/savedroutes", label: "Saved routes", account: true },
    { to: "/faq", label: "Help" },
    { to: "/about", label: "About" },
];

const navLinkClass = ({ isActive }, tall = false) =>
    `rounded-lg px-3 ${tall ? "py-2" : "py-1.5"} text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 ${
        isActive ? "bg-brand-50 text-brand-800 ring-1 ring-brand-100" : "text-mist-700 hover:bg-mist-100 hover:text-mist-900"
    }`;

const menuItemClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-mist-700 hover:bg-mist-100 hover:text-mist-900 focus:outline-none focus-visible:bg-mist-100";

function useDismiss(open, setOpen, ref) {
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
        const onKey = (e) => e.key === "Escape" && setOpen(false);
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, setOpen, ref]);
}

function AccountMenu({ user, onSignOut }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useDismiss(open, setOpen, ref);

    return (
        <div ref={ref} className="relative">
            <Button
                variant="secondary"
                size="avatar"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-700 text-xs font-semibold uppercase text-white">
                    {user.username.charAt(0)}
                </span>
                <span className="hidden max-w-32 truncate sm:block">{user.username}</span>
                <ChevronIcon open={open} className="h-4 w-4 text-mist-500" />
            </Button>

            {open && (
                <Panel tone="glass" role="menu" radius="xl" className="absolute right-0 top-full z-50 mt-2 w-56 p-1.5">
                    <p className="truncate px-3 pb-2 pt-1.5 text-xs text-mist-600">
                        Signed in as <span className="font-medium text-mist-800">{user.username}</span>
                    </p>
                    <div className="my-1 border-t border-mist-200/70" />
                    <Link role="menuitem" to="/savedroutes" className={menuItemClass}>Saved routes</Link>
                    <Link role="menuitem" to="/settings" className={menuItemClass}>Settings</Link>
                    {user.isSuperUser && (
                        <a role="menuitem" href={`${API_BASE}/admin/`} target="_blank" rel="noopener noreferrer" className={menuItemClass}>
                            Admin site
                            <span aria-hidden="true" className="ml-auto text-mist-500">↗</span>
                        </a>
                    )}
                    <Link role="menuitem" to="/report" className={menuItemClass}>Report an issue</Link>
                    <div className="my-1 border-t border-mist-200/70" />
                    <button role="menuitem" type="button" onClick={onSignOut} className={menuItemClass}>
                        Sign out
                    </button>
                </Panel>
            )}
        </div>
    );
}

export const HEADER_HEIGHT_PX = 64;

export default function AppShell({ overlayHeader = false, children }) {
    const navigate = useNavigate();
    const user = useSession();
    const [mobileOpen, setMobileOpen] = useState(false);
    const mobileRef = useRef(null);
    useDismiss(mobileOpen, setMobileOpen, mobileRef);

    const signOut = () => {
        clearSession();
        navigate("/");
    };

    const nav = NAV.filter((item) => user || !item.account);

    return (
        <div className="relative flex h-dvh w-full flex-col bg-mist-50 text-mist-900 antialiased">
            <header
                ref={mobileRef}
                className={`relative z-30 shrink-0 border-b border-white/60 ${surfaceClass} ${
                    overlayHeader ? "lg:absolute lg:inset-x-0 lg:top-0" : ""
                }`}
            >
                <div className="flex h-16 items-center gap-3 px-3 sm:px-6 lg:gap-6">
                    <Brand size="md" className="shrink-0" />

                    <div aria-hidden="true" className="hidden h-8 w-px bg-mist-200 lg:block" />

                    <nav aria-label="Primary" className="hidden flex-1 items-center gap-1 lg:flex">
                        {nav.map((item) => (
                            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>

                    <div className="ml-auto flex items-center gap-2">
                        {user ? (
                            <AccountMenu user={user} onSignOut={signOut} />
                        ) : (
                            <>
                                <Button to="/login" variant="ghost" size="sm">Sign in</Button>
                                <span className="hidden sm:block">
                                    <Button to="/signup" size="sm">Create account</Button>
                                </span>
                            </>
                        )}

                        <span className="lg:hidden">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setMobileOpen((o) => !o)}
                                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                                aria-expanded={mobileOpen}
                                aria-controls="mobile-nav"
                            >
                                <MenuIcon open={mobileOpen} />
                            </Button>
                        </span>
                    </div>
                </div>

                {mobileOpen && (
                    <nav id="mobile-nav" aria-label="Primary" className="flex flex-col gap-1 border-t border-mist-200/70 px-3 py-2 lg:hidden">
                        {nav.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.end}
                                onClick={() => setMobileOpen(false)}
                                className={(state) => navLinkClass(state, true)}
                            >
                                {item.label}
                            </NavLink>
                        ))}
                        {!user && (
                            <Button to="/signup" className="mt-1 w-full">
                                Create account
                            </Button>
                        )}
                    </nav>
                )}
            </header>
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        </div>
    );
}
