import { Link } from "react-router-dom";
import { linkClass } from "../../lib/ui";

export default function TextLink({ to, href, className = "", ...props }) {
    const cls = `${linkClass} ${className}`.trim();
    return to ? <Link to={to} className={cls} {...props} /> : <a href={href} className={cls} {...props} />;
}
