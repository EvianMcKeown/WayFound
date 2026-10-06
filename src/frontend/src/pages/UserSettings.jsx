import { useEffect, useState } from "react";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { alertClass, buttonClass, fieldClass, labelClass, panelClass } from "../lib/ui";

const PROFILE_FIELDS = [
    ["username", "Username", "text"],
    ["email", "Email", "email"],
    ["first_name", "First name", "text"],
    ["last_name", "Last name", "text"],
];

const PREFERENCES = [
    ["minimize_walking", "Minimise walking", "Prefer routes with short walks between stops."],
    ["minimize_stops", "Fewer transfers", "Prefer routes that change vehicle less often."],
];

function Field({ id, label, ...props }) {
    return (
        <div>
            <label htmlFor={id} className={labelClass}>{label}</label>
            <input id={id} className={fieldClass} {...props} />
        </div>
    );
}

function PreferencesCard() {
    const [prefs, setPrefs] = useState(null);
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        apiFetch("/api/preferences/", { auth: true })
            .then(setPrefs)
            .catch(() => setMsg({ text: "Could not load your preferences.", error: true }));
    }, []);

    const toggle = async (key, value) => {
        const previous = prefs;
        setPrefs({ ...prefs, [key]: value });
        try {
            setPrefs(await apiFetch("/api/preferences/", { method: "PATCH", auth: true, body: { [key]: value } }));
            setMsg({ text: "Preferences saved.", error: false });
        } catch (err) {
            setPrefs(previous);
            setMsg({ text: err.message || "Could not save your preferences.", error: true });
        }
    };

    return (
        <section aria-labelledby="prefs-heading" className={`flex flex-col gap-3 rounded-2xl p-5 ${panelClass}`}>
            <div>
                <h2 id="prefs-heading" className="text-sm font-semibold text-mist-700">Journey preferences</h2>
                <p className="text-xs text-mist-500">The planner starts with these set. You can still change them for a single search.</p>
            </div>
            {msg && <p role="status" className={alertClass(msg.error)}>{msg.text}</p>}
            {prefs === null && !msg && <p className="text-sm text-mist-500">Loading…</p>}
            {prefs && (
                <div className="flex flex-col gap-3">
                    {PREFERENCES.map(([key, label, hint]) => (
                        <label key={key} className="flex items-start gap-3 text-sm text-mist-800">
                            <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 accent-brand-700"
                                checked={prefs[key]}
                                onChange={(e) => toggle(key, e.target.checked)}
                            />
                            <span>
                                <span className="font-medium">{label}</span>
                                <span className="block text-xs text-mist-500">{hint}</span>
                            </span>
                        </label>
                    ))}
                </div>
            )}
        </section>
    );
}

export default function UserSettings() {
    const [user, setUser] = useState({ username: "", email: "", first_name: "", last_name: "" });
    const [passwords, setPasswords] = useState({ old_password: "", new_password: "" });
    const [profileMsg, setProfileMsg] = useState(null);
    const [passwordMsg, setPasswordMsg] = useState(null);
    const [busy, setBusy] = useState(null);

    useEffect(() => {
        apiFetch("/api/user/", { auth: true })
            .then((data) =>
                setUser({
                    username: data.username || "",
                    email: data.email || "",
                    first_name: data.first_name || "",
                    last_name: data.last_name || "",
                })
            )
            .catch(() => setProfileMsg({ text: "Could not load your details.", error: true }));
    }, []);

    const handleProfileUpdate = async (e) => {
        e.preventDefault();
        setBusy("profile");
        try {
            await apiFetch("/api/user/", { method: "PATCH", auth: true, body: user });
            setProfileMsg({ text: "Profile updated.", error: false });
        } catch (err) {
            setProfileMsg({ text: err.message || "Failed to update profile.", error: true });
        } finally {
            setBusy(null);
        }
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        setBusy("password");
        try {
            await apiFetch("/api/user/change_password/", { method: "PUT", auth: true, body: passwords });
            setPasswordMsg({ text: "Password changed.", error: false });
            setPasswords({ old_password: "", new_password: "" });
        } catch (err) {
            setPasswordMsg({ text: err.message || "Failed to change password.", error: true });
        } finally {
            setBusy(null);
        }
    };

    return (
        <Page width="md">
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

            <PreferencesCard />

            <form onSubmit={handleProfileUpdate} className={`flex flex-col gap-3 rounded-2xl p-5 ${panelClass}`}>
                <h2 className="text-sm font-semibold text-mist-700">Profile</h2>
                {profileMsg && <p role="status" className={alertClass(profileMsg.error)}>{profileMsg.text}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                    {PROFILE_FIELDS.map(([key, label, type]) => (
                        <Field
                            key={key}
                            id={key}
                            label={label}
                            type={type}
                            value={user[key]}
                            onChange={(e) => setUser({ ...user, [key]: e.target.value })}
                        />
                    ))}
                </div>
                <button type="submit" disabled={busy === "profile"} className={`self-start ${buttonClass()}`}>
                    {busy === "profile" ? "Saving…" : "Save changes"}
                </button>
            </form>

            <form onSubmit={handlePasswordChange} className={`flex flex-col gap-3 rounded-2xl p-5 ${panelClass}`}>
                <h2 className="text-sm font-semibold text-mist-700">Change password</h2>
                {passwordMsg && <p role="status" className={alertClass(passwordMsg.error)}>{passwordMsg.text}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                        id="old_password"
                        label="Current password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={passwords.old_password}
                        onChange={(e) => setPasswords({ ...passwords, old_password: e.target.value })}
                    />
                    <Field
                        id="new_password"
                        label="New password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={passwords.new_password}
                        onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })}
                    />
                </div>
                <button type="submit" disabled={busy === "password"} className={`self-start ${buttonClass()}`}>
                    {busy === "password" ? "Changing…" : "Change password"}
                </button>
            </form>
        </Page>
    );
}
