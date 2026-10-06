import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { setSession } from "../lib/auth";
import { alertClass, buttonClass, fieldClass, labelClass, linkClass, panelClass } from "../lib/ui";

export default function Login() {
    const navigate = useNavigate();
    const location = useLocation();
    const [formData, setFormData] = useState({ username: "", password: "" });
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    const handleLogin = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const data = await apiFetch("/api/login/", { method: "POST", body: formData });
            if (!data?.access) throw new Error("Sign-in failed");
            setSession(data);

            const from = location.state?.from;
            navigate(from ? `${from.pathname}${from.search ?? ""}` : "/", { replace: true });
        } catch (err) {
            setError(err.message || "Something went wrong. Try again.");
            setBusy(false);
        }
    };

    return (
        <Page width="sm" centered brand>
            <form onSubmit={handleLogin} className={`flex flex-col gap-4 rounded-2xl p-6 ${panelClass}`}>
                <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>

                {error && <p role="alert" className={alertClass(true)}>{error}</p>}

                {[
                    ["username", "Username", "username"],
                    ["password", "Password", "current-password"],
                ].map(([name, label, autoComplete]) => (
                    <div key={name}>
                        <label htmlFor={name} className={labelClass}>{label}</label>
                        <input
                            id={name}
                            name={name}
                            type={name === "password" ? "password" : "text"}
                            autoComplete={autoComplete}
                            required
                            value={formData[name]}
                            onChange={handleChange}
                            className={fieldClass}
                        />
                    </div>
                ))}

                <button type="submit" disabled={busy} className={buttonClass()}>
                    {busy ? "Signing in…" : "Sign in"}
                </button>

                <p className="text-center text-sm text-mist-600">
                    Don’t have an account? <Link to="/signup" state={location.state} className={linkClass}>Create one</Link>
                </p>
            </form>
        </Page>
    );
}
