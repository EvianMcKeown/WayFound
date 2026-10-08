import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "./AppShell";
import Brand from "./Brand";

const footerLink = "font-medium text-mist-700 hover:text-brand-700";

const WIDTH = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-3xl" };

const BACKDROP = ["/backdrop/roads.svg", "/backdrop/route.svg"];
let backdropLoaded = false;
let backdropLoading = null;
const loadBackdrop = () =>
    (backdropLoading ??= Promise.all(
        BACKDROP.map((src) => {
            const img = new Image();
            img.src = src;
            return img.decode().catch(() => {});
        })
    ).then(() => (backdropLoaded = true)));

export default function Page({ width = "md", centered = false, children }) {
    const [backdrop, setBackdrop] = useState(backdropLoaded);
    useEffect(() => {
        if (backdrop) return;
        let live = true;
        loadBackdrop().then(() => live && setBackdrop(true));
        return () => {
            live = false;
        };
    }, [backdrop]);
    return (
        <AppShell>
            <div className="relative flex min-h-0 flex-1 flex-col bg-mist-50">
                <div aria-hidden="true" data-ready={backdrop} className="backdrop-roads" />
                <div aria-hidden="true" data-ready={backdrop} className="backdrop-route" />
                <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
                    <div data-reveal className={`relative mx-auto flex w-full flex-1 flex-col gap-4 p-4 sm:p-6 ${WIDTH[width]} ${centered ? "justify-center" : ""}`}>
                        {children}
                    </div>

                    <footer className="relative flex flex-col items-center gap-3 border-t border-white/60 bg-white/50 px-4 py-4 text-xs text-mist-700 backdrop-blur-md sm:flex-row sm:justify-between sm:px-6">
                        <Brand size="sm" />
                        <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                            <Link to="/about" className={footerLink}>About</Link>
                            <Link to="/faq" className={footerLink}>Help</Link>
                            <Link to="/report" className={footerLink}>Report an issue</Link>
                        </nav>
                        <div className="flex flex-col items-center gap-0.5 text-center sm:items-end sm:text-right">
                            <p>&copy; 2025 WayFound · PathPilot@gmail.com · +27 74 761 8921</p>
                            <p className="text-mist-600">Background roads &copy; OpenStreetMap contributors</p>
                        </div>
                    </footer>
                </div>
            </div>
        </AppShell>
    );
}
