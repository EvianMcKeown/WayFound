import { Link } from "react-router-dom";

export function DemoBadge({ className = "" }) {
    return (
        <Link
            to="/about"
            title="WayFound is a demo, not an official transport service"
            className={`items-center rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-800 ring-1 ring-warning-200 hover:bg-warning-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 ${className}`}
        >
            Demo
        </Link>
    );
}

export function DemoNote({ className = "" }) {
    return (
        <p className={`text-center text-xs text-mist-600 ${className}`}>
            A demo, not an official service.{" "}
            <Link to="/about" className="font-medium text-mist-700 underline hover:no-underline">
                Check times with the operator
            </Link>
            .
        </p>
    );
}
