import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { setSession } from "../lib/auth";
import { Alert, Button, Field, Panel, TextLink } from "../components/ui";

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
            <Panel as="form" onSubmit={handleLogin} className="flex flex-col gap-4 p-6">
                <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>

                {error && <Alert>{error}</Alert>}

                {[
                    ["username", "Username", "username"],
                    ["password", "Password", "current-password"],
                ].map(([name, label, autoComplete]) => (
                    <Field
                        key={name}
                        id={name}
                        name={name}
                        label={label}
                        type={name === "password" ? "password" : "text"}
                        autoComplete={autoComplete}
                        required
                        value={formData[name]}
                        onChange={handleChange}
                    />
                ))}

                <Button type="submit" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                </Button>

                <p className="text-center text-sm text-mist-700">
                    Don’t have an account? <TextLink to="/signup" state={location.state}>Create one</TextLink>
                </p>
            </Panel>
        </Page>
    );
}
