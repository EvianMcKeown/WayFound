import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { setSession } from "../lib/auth";
import { alertClass, buttonClass, fieldClass, labelClass, linkClass, panelClass } from "../lib/ui";

const FIELDS = [
    ["first_name", "First name", "text", "given-name", false, true],
    ["last_name", "Surname", "text", "family-name", false, true],
    ["email", "Email", "email", "email", true, false],
    ["username", "Username", "text", "username", true, false],
    ["password", "Password", "password", "new-password", true, false],
];

const EMPTY = Object.fromEntries(FIELDS.map(([name]) => [name, ""]));

export default function SignUp() {
    const navigate = useNavigate();
    const location = useLocation();
    const [formData, setFormData] = useState(EMPTY);
    const [fieldErrors, setFieldErrors] = useState({});
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        setFieldErrors((fe) => ({ ...fe, [e.target.name]: undefined }));
    };

    const handleSignUp = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setFieldErrors({});
        try {
            const data = await apiFetch("/api/signup/", { method: "POST", body: formData });
            setSession(data);
            const from = location.state?.from;
            navigate(from ? `${from.pathname}${from.search ?? ""}` : "/", { replace: true });
        } catch (err) {
            const data = err.data && typeof err.data === "object" ? err.data : {};
            const known = Object.fromEntries(
                FIELDS.filter(([name]) => data[name]).map(([name]) => [name, [data[name]].flat().join(" ")])
            );
            setFieldErrors(known);
            if (Object.keys(known).length === 0) setError(err.message || "Something went wrong. Try again.");
            setBusy(false);
        }
    };

    return (
        <Page width="sm" centered brand>
            <form onSubmit={handleSignUp} noValidate className={`flex flex-col gap-4 rounded-2xl p-6 ${panelClass}`}>
                <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
                <p className="-mt-2 text-sm text-mist-600">Save routes and keep your journey preferences.</p>

                {error && <p role="alert" className={alertClass(true)}>{error}</p>}

                <div className="grid grid-cols-2 gap-3">
                    {FIELDS.map(([name, label, type, autoComplete, required, half]) => (
                        <div key={name} className={half ? "" : "col-span-2"}>
                            <label htmlFor={name} className={labelClass}>
                                {label}
                                {!required && <span className="font-normal text-mist-400"> (optional)</span>}
                            </label>
                            <input
                                id={name}
                                name={name}
                                type={type}
                                autoComplete={autoComplete}
                                required={required}
                                value={formData[name]}
                                onChange={handleChange}
                                aria-invalid={Boolean(fieldErrors[name])}
                                aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
                                className={`${fieldClass} ${fieldErrors[name] ? "border-red-300" : ""}`}
                            />
                            {fieldErrors[name] && (
                                <p id={`${name}-error`} className="mt-1 text-xs text-red-700">{fieldErrors[name]}</p>
                            )}
                        </div>
                    ))}
                </div>

                <button type="submit" disabled={busy} className={buttonClass()}>
                    {busy ? "Creating account…" : "Create account"}
                </button>

                <p className="text-center text-sm text-mist-600">
                    Already have an account?{" "}
                    <Link to="/login" state={location.state} className={linkClass}>Sign in</Link>
                </p>
            </form>
        </Page>
    );
}
