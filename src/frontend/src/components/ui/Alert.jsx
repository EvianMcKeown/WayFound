import { alertClass } from "../../lib/ui";

export default function Alert({ tone = "error", role, className = "", ...props }) {
    const error = tone === "error";
    return <p role={role ?? (error ? "alert" : "status")} className={`${alertClass(error)} ${className}`.trim()} {...props} />;
}
