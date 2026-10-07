import { panelClass, panelSolidClass } from "../../lib/ui";

const RADIUS = { xl: "rounded-xl", "2xl": "rounded-2xl", "3xl": "rounded-3xl" };
const TONE = { solid: panelSolidClass, glass: panelClass };

export default function Panel({ as = "div", radius = "2xl", tone = "solid", className = "", ...props }) {
    const Tag = as;
    return <Tag className={`${RADIUS[radius]} ${TONE[tone]} ${className}`.trim()} {...props} />;
}
