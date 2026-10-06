export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const pad = (n) => String(n).padStart(2, "0");

export function minsToClock(total) {
    const inDay = ((total % 1440) + 1440) % 1440;
    return `${pad(Math.floor(inDay / 60))}:${pad(inDay % 60)}`;
}

export function minsToDayClock(total) {
    const day = Math.floor(total / 1440) % 7;
    return `${DAYS[day].slice(0, 3)} ${minsToClock(total)}`;
}

export function formatDuration(mins) {
    const m = Math.max(0, Math.round(mins));
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

export function nowAsPlannerInput() {
    const now = new Date();
    return {
        day: (now.getDay() + 6) % 7,
        time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    };
}
