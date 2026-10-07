import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { setSession } from "../lib/auth";
import { Alert, Button, Field, Panel, TextLink } from "../components/ui";

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
            <Panel as="form" onSubmit={handleSignUp} noValidate className="flex flex-col gap-4 p-6">
                <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
                <p className="-mt-2 text-sm text-mist-700">Save routes and keep your journey preferences.</p>

                {error && <Alert>{error}</Alert>}

                <div className="grid grid-cols-2 gap-3">
                    {FIELDS.map(([name, label, type, autoComplete, required, half]) => (
                        <Field
                            key={name}
                            id={name}
                            name={name}
                            label={label}
                            note={required ? null : "(optional)"}
                            type={type}
                            autoComplete={autoComplete}
                            required={required}
                            value={formData[name]}
                            onChange={handleChange}
                            error={fieldErrors[name]}
                            className={half ? "" : "col-span-2"}
                        />
                    ))}
                </div>

                <Button type="submit" disabled={busy}>
                    {busy ? "Creating account…" : "Create account"}
                </Button>

                <p className="text-center text-sm text-mist-700">
                    Already have an account?{" "}
                    <TextLink to="/login" state={location.state}>Sign in</TextLink>
                </p>
            </Panel>
        </Page>
    );
}
