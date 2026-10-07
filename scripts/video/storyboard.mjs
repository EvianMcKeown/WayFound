const PHONE_ZOOM = 1.16;

export default function storyboard(api) {
    const { ev, wait, caption, click, clickHere, pointer, type, waitRect, waitFor, waitMap, focus, home, union, rectsOf, dissolveTo, origin, q } = api;
    const hideCursor = () => ev("stage.showCursor(false)");
    const cursorIn = (x, y) => ev(`stage.cursorIn(${x}, ${y})`);
    const swipe = (x0, y0, x1, y1, ms = 700) => ev(`stage.swipe(${x0}, ${y0}, ${x1}, ${y1}, ${ms})`);
    const tap = (x, y) => ev(`stage.tap(${x}, ${y})`);
    const tapOn = async (sel, text) => {
        const r = await waitRect(sel, text);
        await tap(r.x + r.w / 2, r.y + r.h / 2);
    };

    async function tagLegs() {
        const items = await ev(`(() => [...stage.app().querySelectorAll("aside li")].map((li) => {
            const r = li.getBoundingClientRect(), t = li.innerText;
            // a leg reads "Walk ...", "Train ...", or "Bus ...": MyCiTi routes are numbered (113-1), Golden Arrow ones are named
            const kind = t.startsWith("Walk") ? ["On foot", "#516153"] : t.startsWith("Train") ? ["Metrorail", "#00b0df"] : /Bus +[0-9]+-[0-9]/.test(t) ? ["MyCiTi", "#0a5689"] : ["Golden Arrow", "#fa8c26"];
            const a = li.closest("aside").getBoundingClientRect();
            return { text: kind[0], color: kind[1], x: a.right + 14, y: r.top + 22 };
        }))()`);
        await ev(`stage.badges(${q(items)})`);
    }

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

            await caption("Go <b>anywhere</b> else");
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
            await wait(1600);

            await ev(`(() => { const a = stage.app().querySelector("aside"); a.scrollTo({ top: a.scrollHeight, behavior: "smooth" }); })()`);
            await wait(900);
            const legs = await rectsOf("aside li");
            const save = await waitRect("aside button", "Save this route");
            await caption("Every operator in <b>its own colour</b>");
            await focus(union([...legs, save]), { pad: 70, max: 1.6, ms: 1500 });
            await wait(300);
            await tagLegs();
            await wait(1700);

            await caption("Taking it again? <b>Save it</b> for next time");
            await cursorIn(save.x + save.w * 0.5, save.y + save.h / 2);
            await click("aside button", "Save this route");
            await waitFor(`[...stage.app().querySelectorAll("aside button")].some((b) => b.textContent.trim() === "Saved")`, "saved");
            await wait(1500);
            await ev("stage.clearBadges()");

            await caption("Not the best fit? <b>Compare routes</b>");
            await ev(`(() => { const a = stage.app().querySelector("aside"); a.scrollTo({ top: 0, behavior: "smooth" }); })()`);
            await wait(900);
            await focus(await waitRect("aside"), { pad: 40, max: 1.4, ms: 1300 });
            await click("aside button", "Compare routes");
            await waitRect("[role=radiogroup]");
            await wait(2200);
            const second = (await rectsOf("[role=radio]"))[1];
            await cursorIn(second.x + second.w * 0.5, second.y + second.h / 2);
            await click("[role=radio]:nth-of-type(2)");
            await waitMap();
            await wait(1600);

            await caption("A line you dislike? <b>Avoid it</b>");
            await ev(`stage.app().querySelector("aside button[aria-label^='Avoid MyCiTi']").scrollIntoView({ block: "center", behavior: "smooth" })`);
            for (let last = -1, now = await ev(`stage.app().querySelector("aside").scrollTop`); now !== last; ) {
                last = now;
                await wait(250);
                now = await ev(`stage.app().querySelector("aside").scrollTop`);
            }
            const avoidBtn = await waitRect("aside button[aria-label^='Avoid MyCiTi']");
            await cursorIn(avoidBtn.x + avoidBtn.w * 0.5, avoidBtn.y + avoidBtn.h / 2);
            await wait(300);
            await pointer("aside button[aria-label^='Avoid MyCiTi']");
            await ev("stage.press()");
            await wait(150);
            await ev(`stage.app().querySelector("aside button[aria-label^='Avoid MyCiTi']").click()`);
            await ev("stage.release()");
            await hideCursor();
            await waitFor(`(stage.app().querySelector("aside")?.innerText ?? "").includes("Avoiding")`, "the trip without that line");
            await waitMap();
            await ev(`(() => { const a = stage.app().querySelector("aside"); a.scrollTo({ top: 0, behavior: "smooth" }); })()`);
            await wait(2600);
            await caption(null);
            await home(1000);
        },

        async phone() {
            await ev("stage.card(false)");
            await switchDevice("phone", "/");
            await caption("Your whole city, <b>in your pocket</b>");
            await wait(1500);

            const where = await waitRect("button", "Where to?");
            await caption("Swipe up to <b>start planning</b>");
            await swipe(where.x + where.w * 0.5, where.y + where.h / 2, where.x + where.w * 0.5, where.y - 230, 800);
            await waitRect("#time-sheet");
            await wait(500);

            await caption("Search any place <b>by name</b>");
            await tapOn("input[role=combobox]");
            await type("Gugulethu", 40);
            await waitRect("[role=option]");
            await wait(250);
            await tapOn("[role=option]");
            await wait(250);
            const to = await ev(`(() => { const e = stage.app().querySelectorAll("input[role=combobox]")[1]; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
            await tap(to.x + to.w * 0.4, to.y + to.h / 2);
            await type("V&A Waterfront", 34);
            await waitRect("[role=option]");
            await wait(250);
            await tapOn("[role=option]");
            await wait(300);
            await tapOn("form button[type=submit]");
            await waitFor(`(stage.app().querySelector('section[aria-label="Journey planner"]')?.innerText ?? "").includes("→")`, "the trip");
            await waitMap();

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
