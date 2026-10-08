const PHONE_ZOOM = 1.16;

export default function storyboard(api) {
    const { ev, wait, caption, click, clickHere, pointer, type, waitRect, waitFor, waitMap, focus, home, union, rectsOf, dissolveTo, poster, origin, q } = api;
    const hideCursor = () => ev("stage.showCursor(false)");
    const cursorIn = (x, y) => ev(`stage.cursorIn(${x}, ${y})`);
    const swipe = (x0, y0, x1, y1, ms = 700) => ev(`stage.swipe(${x0}, ${y0}, ${x1}, ${y1}, ${ms})`);
    const tap = (x, y) => ev(`stage.tap(${x}, ${y})`);
    const tapOn = async (sel, text) => {
        const r = await waitRect(sel, text);
        await tap(r.x + r.w / 2, r.y + r.h / 2);
    };

    async function tagLegs() {
        const items = await ev(`(() => {
            const NAMES = { "rgb(81, 97, 83)": "On foot", "rgb(10, 86, 137)": "MyCiTi", "rgb(250, 140, 38)": "Golden Arrow", "rgb(0, 176, 223)": "Metrorail" };
            return [...stage.app().querySelectorAll("aside li")].map((li) => {
                const r = li.getBoundingClientRect(), a = li.closest("aside").getBoundingClientRect();
                const color = getComputedStyle(li.querySelector("span[aria-hidden]:not(.absolute)")).backgroundColor;
                if (!NAMES[color]) throw new Error("a leg badge has a colour the video does not know: " + color + " (update NAMES in tagLegs)");
                return { text: NAMES[color], color, x: a.right + 14, y: r.top + 22 };
            });
        })()`);
        await ev(`stage.badges(${q(items)})`);
    }

    async function clickIn(sel, text) {
        const r = await waitRect(sel, text);
        await cursorIn(r.x + r.w * 0.5, r.y + r.h / 2);
        await click(sel, text);
    }

    async function scrollTo(sel, where = "center") {
        const box = `(() => { const el = stage.app().querySelector(${q(sel)}); let b = el.parentElement;
            while (b && !(b.scrollHeight > b.clientHeight && /auto|scroll/.test(getComputedStyle(b).overflowY))) b = b.parentElement;
            return [el, b]; })()`;
        await ev(`(() => { const [el, b] = ${box}; if (!b) return;
            const top = ${q(where)} === "top" ? 0 : ${q(where)} === "bottom" ? b.scrollHeight
                : b.scrollTop + el.getBoundingClientRect().top - b.getBoundingClientRect().top - (b.clientHeight - el.offsetHeight) / 2;
            b.scrollTo({ top, behavior: "smooth" }); })()`);
        const pos = `(() => { const [, b] = ${box}; return b ? b.scrollTop : 0; })()`;
        for (let last = -1, now = await ev(pos); now !== last; ) {
            last = now;
            await wait(200);
            now = await ev(pos);
        }
    }
    const scrollAside = (where) => (where === "top" || where === "bottom" ? scrollTo("aside li", where) : scrollTo(`aside ${where}`));

    async function switchDevice(device, path, { ms = 900, hold = 200, mode = "fade" } = {}) {
        await ev(`stage.prepare(${q(device)})`);
        await ev(`stage.load(${q(origin + path)})`);
        await waitFor(`!!stage.app().querySelector("header")`, "app header");
        if (device === "phone") {
            await ev(`(() => { const d = stage.app(); const st = d.createElement("style"); st.textContent = "*{user-select:none!important;-webkit-user-select:none!important} header{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background-color:rgba(255,255,255,0.96)!important}"; d.head.appendChild(st); })()`);
            await ev("stage.captionSide(true)");
        } else {
            await ev("stage.captionSide(false)");
        }
        await waitMap();
        await wait(hold);
        await dissolveTo(device === "phone" ? PHONE_ZOOM : 1, ms, mode);
    }

    const scenes = {
        async intro() {
            await ev(`stage.load(${q(origin + "/")})`);
            await ev("stage.card(true, 'Every bus and train. One map.')");
            await waitFor(`!!stage.app().querySelector("header")`, "app header");
            await waitMap();
            await wait(200);
            await ev("stage.reveal()");
        },

        async desktop() {
            await ev("stage.card(false)");
            await ev("stage.deviceIn(300)");
            await caption("Start <b>anywhere</b> in Cape Town");
            const panel = await waitRect("aside > div");
            await focus(panel, { pad: 70, max: 1.6, ms: 1300 });

            const from = await waitRect("input[role=combobox]");
            await cursorIn(from.x + from.w * 0.5, from.y + from.h / 2);
            await click("input[role=combobox]");
            await type("Gugulethu", 45);
            await waitRect("[role=option]");
            await wait(200);
            await click("[role=option]");
            await wait(100);

            await caption("…and end <b>anywhere</b>");
            const to = await ev(`(() => { const e = stage.app().querySelectorAll("input[role=combobox]")[1]; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
            await ev(`stage.moveTo(${to.x + to.w * 0.5}, ${to.y + to.h / 2}, 600)`);
            await clickHere();
            await wait(80);
            await type("V&A Waterfront", 38);
            await waitRect("[role=option]");
            await wait(200);
            await click("[role=option]");
            await wait(150);

            await click("form button[type=submit]");
            await hideCursor();
            await waitFor(`(stage.app().querySelector("aside")?.innerText ?? "").includes("→")`, "journey result");
            await waitMap();
            await home(1400);
            await caption("Three operators, <b>one journey</b>");
            poster();
            await wait(1600);

            await scrollAside("bottom");
            await caption("Every operator in <b>its own colour</b>");
            await focus(union(await rectsOf("aside li")), { pad: 70, max: 1.6, ms: 1500 });
            await wait(300);
            await tagLegs();
            await wait(1900);
            await ev("stage.clearBadges()");

            await caption("Not the best fit? <b>Compare routes</b>");
            await scrollAside("top");
            await focus(await waitRect("aside"), { pad: 40, max: 1.4, ms: 1300 });
            await click("aside button", "Compare routes");
            await waitRect("[role=radiogroup]");
            await wait(2200);
            const second = (await rectsOf("[role=radio]"))[1];
            await cursorIn(second.x + second.w * 0.5, second.y + second.h / 2);
            await click("[role=radio]:nth-of-type(2)");
            await waitMap();
            await wait(1600);

            await caption("Rather skip a line? <b>Avoid it</b>");
            await scrollAside("button[aria-label^='Avoid MyCiTi']");
            await clickIn("aside button[aria-label^='Avoid MyCiTi']");
            await hideCursor();
            await waitFor(`(stage.app().querySelector("aside")?.innerText ?? "").includes("Avoiding")`, "the trip without that line");
            await waitMap();
            await scrollAside("top");
            await caption("Re-planned without it. <b>Undo</b> anytime");
            await wait(2200);

            await caption("Taking it again? <b>Save it</b>");
            await scrollAside("bottom");
            await focus(await waitRect("aside button", "Save this route"), { pad: 160, max: 1.6, ms: 1200 });
            await clickIn("aside button", "Save this route");
            await hideCursor();
            await waitFor(`[...stage.app().querySelectorAll("aside button")].some((b) => b.textContent.trim() === "Saved")`, "saved");
            await wait(1600);
            await caption(null);
            await home(1000);
        },

        async phone() {
            await ev("stage.card(false)");
            await switchDevice("phone", "/");
            await caption("Your whole city, <b>in your pocket</b>");
            await wait(1500);

            await caption("Saved trips <b>follow you</b>");
            await tapOn('button[aria-label="Open menu"]');
            await waitRect("#mobile-nav");
            await wait(400);
            await tapOn("#mobile-nav a", "Saved routes");
            await waitRect("main li");
            await wait(1100);
            await tapOn("main li a", "Plan");
            await waitFor(`(stage.app().querySelector('section[aria-label="Journey planner"]')?.innerText ?? "").includes("→")`, "the trip");
            await waitMap();
            await wait(600);

            let s = await waitRect('section[aria-label="Journey planner"]');
            await caption("Swipe up for <b>step-by-step</b> directions");
            await wait(1500);
            await swipe(60, s.y + 90, 60, s.y - 200, 800);
            await wait(1900);
            s = await waitRect('section[aria-label="Journey planner"]');
            await caption("Swipe down for <b>the full map</b>");
            await swipe(60, s.y + 70, 60, s.y + 380, 750);
            await wait(900);

            await caption("Less walking? <b>Re-plan instantly</b>");
            await tapOn('button[aria-label="Change journey"]');
            await waitRect("#time-sheet");
            await wait(500);
            await tapOn("summary", "Options");
            await wait(500);
            await tapOn("label", "Minimise walking");
            await wait(500);
            await scrollTo("form button[type=submit]");
            await tapOn("form button[type=submit]");
            await waitFor(`(stage.app().querySelector('section[aria-label="Journey planner"]')?.innerText ?? "").includes("→")`, "the new trip");
            await waitMap();
            await wait(1800);
            await caption(null);
        },

        async outro() {
            await ev("stage.card(true, 'Your next trip, planned in seconds.')");
            await wait(2900);
        },
    };
    return scenes;
}
