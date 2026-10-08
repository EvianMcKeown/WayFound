import { useEffect, useState } from "react";
import Page from "../components/Page";
import { apiFetch } from "../lib/api";
import { setSession } from "../lib/auth";
import AvoidTransport from "../components/AvoidTransport";
import { Alert, Button, Checkbox, Field, Panel } from "../components/ui";
import { avoidFromPrefs, avoidToPrefs } from "../lib/transport";
import useFlash from "../lib/useFlash";

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

function PreferencesCard() {
    const [prefs, setPrefs] = useState(null);
    const [msg, setMsg, msgFlash] = useFlash();

    useEffect(() => {
        apiFetch("/api/preferences/", { auth: true })
            .then(setPrefs)
            .catch(() => setMsg({ text: "Could not load your preferences.", error: true }));
    }, [setMsg]);

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

    const setAvoid = async (next) => {
        const previous = prefs;
        setPrefs({ ...prefs, excluded_modes: next.modes, excluded_lines: next.lines.map((l) => l.key), excluded_lines_detail: next.lines });
        try {
            setPrefs(await apiFetch("/api/preferences/", { method: "PATCH", auth: true, body: avoidToPrefs(next) }));
            setMsg({ text: "Preferences saved.", error: false });
        } catch (err) {
            setPrefs(previous);
            setMsg({ text: err.message || "Could not save your preferences.", error: true });
        }
    };

    return (
        <Panel as="section" aria-labelledby="prefs-heading" className="flex flex-col gap-3 p-5">
            <div>
                <h2 id="prefs-heading" className="text-sm font-semibold text-mist-700">Journey preferences</h2>
                <p className="text-xs text-mist-600">The planner starts with these set. You can still change them for a single search.</p>
            </div>
            {msg && <Alert tone={msg.error ? "error" : "success"} role="status" {...msgFlash}>{msg.text}</Alert>}
            {prefs === null && !msg && <p className="text-sm text-mist-600">Loading…</p>}
            {prefs && (
                <div className="flex flex-col gap-3">
                    {PREFERENCES.map(([key, label, hint]) => (
                        <Checkbox
                            key={key}
                            label={label}
                            hint={hint}
                            checked={prefs[key]}
                            onChange={(e) => toggle(key, e.target.checked)}
                        />
                    ))}
                    <div className="flex flex-col gap-2 border-t border-mist-200 pt-3">
                        <h3 className="text-sm font-semibold text-mist-700">Transport I avoid</h3>
                        <p className="text-xs text-mist-600">
                            The planner leaves these out unless you allow them for a search. Switch an operator off, or search for a single line.
                        </p>
                        <AvoidTransport avoid={avoidFromPrefs(prefs)} onChange={setAvoid} />
                    </div>
                </div>
            )}
        </Panel>
    );
}

export default function UserSettings() {
    const [user, setUser] = useState({ username: "", email: "", first_name: "", last_name: "" });
    const [passwords, setPasswords] = useState({ old_password: "", new_password: "" });
    const [profileMsg, setProfileMsg, profileFlash] = useFlash();
    const [passwordMsg, setPasswordMsg, passwordFlash] = useFlash();
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
    }, [setProfileMsg]);

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
            const data = await apiFetch("/api/user/change_password/", { method: "PUT", auth: true, body: passwords });
            if (data?.access) setSession(data);
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

            <Panel as="form" onSubmit={handleProfileUpdate} className="flex flex-col gap-3 p-5">
                <h2 className="text-sm font-semibold text-mist-700">Profile</h2>
                {profileMsg && <Alert tone={profileMsg.error ? "error" : "success"} role="status" {...profileFlash}>{profileMsg.text}</Alert>}
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
                <Button type="submit" disabled={busy === "profile"} className="self-start">
                    {busy === "profile" ? "Saving…" : "Save changes"}
                </Button>
            </Panel>

            <Panel as="form" onSubmit={handlePasswordChange} className="flex flex-col gap-3 p-5">
                <h2 className="text-sm font-semibold text-mist-700">Change password</h2>
                {passwordMsg && <Alert tone={passwordMsg.error ? "error" : "success"} role="status" {...passwordFlash}>{passwordMsg.text}</Alert>}
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
                <Button type="submit" disabled={busy === "password"} className="self-start">
                    {busy === "password" ? "Changing…" : "Change password"}
                </Button>
            </Panel>
        </Page>
    );
}
