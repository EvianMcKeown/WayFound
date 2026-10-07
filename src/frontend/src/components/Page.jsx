import { Link } from "react-router-dom";
import AppShell from "./AppShell";
import Brand from "./Brand";

const footerLink = "font-medium text-mist-700 hover:text-brand-700";

const WIDTH = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-3xl" };

export default function Page({ width = "md", centered = false, brand = false, children }) {
    return (
        <AppShell>
            <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-mist-100">
                <div aria-hidden="true" className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" />
                <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-80 w-80 rounded-full bg-brand-500/15 blur-3xl" />
                <div aria-hidden="true" className="pointer-events-none absolute -right-20 bottom-24 h-80 w-80 rounded-full bg-brand-300/30 blur-3xl" />

                <div className={`relative mx-auto flex w-full flex-1 flex-col gap-4 p-4 sm:p-6 ${WIDTH[width]} ${centered ? "justify-center" : ""}`}>
                    {brand && <Brand size="md" stacked className="mb-1 self-center" />}
                    {children}
                </div>

                <footer className="relative flex flex-col items-center gap-3 border-t border-white/60 bg-white/50 px-4 py-4 text-xs text-mist-700 backdrop-blur-md sm:flex-row sm:justify-between sm:px-6">
                    <Brand size="sm" />
                    <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                        <Link to="/about" className={footerLink}>About</Link>
                        <Link to="/faq" className={footerLink}>Help</Link>
                        <Link to="/report" className={footerLink}>Report an issue</Link>
                    </nav>
                    <p className="text-center">&copy; 2025 WayFound · PathPilot@gmail.com · +27 74 761 8921</p>
                </footer>
            </div>
        </AppShell>
    );
}
