import { spawn } from "node:child_process";
import { once } from "node:events";

const toLinear = new Uint16Array(256);
const toSrgb = new Uint8Array(65536);
for (let i = 0; i < 256; i++) {
    const c = i / 255;
    toLinear[i] = Math.round(65535 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}
for (let i = 0; i < 65536; i++) {
    const l = i / 65535;
    toSrgb[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
}

export function frameSink({ out, fps, width, height }) {
    const size = width * height * 3;
    const decoder = spawn("ffmpeg", ["-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-i", "pipe:0",
        "-vf", `scale=${width}:${height}:flags=lanczos`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        { stdio: ["pipe", "pipe", "inherit"] });
    const encoder = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`,
        "-framerate", String(fps), "-i", "pipe:0", "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-an", out],
        { stdio: ["pipe", "inherit", "inherit"] });
    const decoded = once(decoder, "close");
    const encoded = once(encoder, "close");
    decoder.stdin.on("error", () => {});
    encoder.stdin.on("error", () => {});

    const counts = [];
    const image = Buffer.alloc(size);
    let filled = 0;
    const sum = new Uint32Array(size);
    let summed = 0;

    let last = null;
    function emit(frame) {
        last = frame;
        if (!encoder.stdin.write(frame)) {
            decoder.stdout.pause();
            encoder.stdin.once("drain", () => decoder.stdout.resume());
        }
    }
    function take(shot) {
        const n = counts[0];
        if (n === 1) {
            emit(Buffer.from(shot));
            counts.shift();
            return;
        }
        for (let i = 0; i < size; i++) sum[i] += toLinear[shot[i]];
        if (++summed < n) return;
        const frame = Buffer.allocUnsafe(size);
        for (let i = 0; i < size; i++) frame[i] = toSrgb[Math.round(sum[i] / n)];
        sum.fill(0);
        summed = 0;
        counts.shift();
        emit(frame);
    }
    decoder.stdout.on("data", (chunk) => {
        for (let at = 0; at < chunk.length; ) {
            const n = Math.min(size - filled, chunk.length - at);
            chunk.copy(image, filled, at, at + n);
            filled += n;
            at += n;
            if (filled === size) { take(image); filled = 0; }
        }
    });

    return {
        frame(n) { counts.push(n); },
        last() { return last; },
        async shot(jpeg) {
            if (!decoder.stdin.write(jpeg)) await once(decoder.stdin, "drain");
        },
        async close() {
            decoder.stdin.end();
            const [d] = await decoded;
            encoder.stdin.end();
            const [e] = await encoded;
            return d || e;
        },
    };
}
