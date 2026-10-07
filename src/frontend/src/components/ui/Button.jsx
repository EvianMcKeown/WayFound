import { Link } from "react-router-dom";
import { buttonClass } from "../../lib/ui";

export default function Button({ variant = "primary", size = "md", to, href, type = "button", className = "", ...props }) {
    const cls = `${buttonClass(variant, size)} ${className}`.trim();
    if (to) return <Link to={to} className={cls} {...props} />;
    if (href) return <a href={href} className={cls} {...props} />;
    return <button type={type} className={cls} {...props} />;
}
