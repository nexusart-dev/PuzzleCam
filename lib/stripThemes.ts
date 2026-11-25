import type { GalleryEntry, StripCustomization, StripTheme } from "./types";

const STRIP_BORDER = 48;
const STRIP_GAP = 24;
const STRIP_FOOTER_H = 96;
const FONT_FAMILY = "'IBM Plex Mono', monospace";
const CONFETTI_COLORS = ["#ff5c39", "#2ec4b6", "#ffbf00", "#7b61ff", "#ff5c9a"];

export const STRIP_THEMES: StripTheme[] = [
    {
        id: "classic",
        label: "Klasik",
        background: "#ffffff",
        photoBorder: "#111111",
        photoBorderWidth: 4,
        ornament: "none",
        ornamentColor: "#111111",
        textColor: "#111111",
        caption: "PUZZLECAM",
    },
    {
        id: "noir",
        label: "Film noir",
        background: "#141414",
        photoBorder: "#f5c518",
        photoBorderWidth: 4,
        ornament: "film",
        ornamentColor: "#eae5d6",
        textColor: "#f5c518",
        caption: "PUZZLECAM",
    },
    {
        id: "pinkpop",
        label: "Pink pop",
        background: ["#ffd6e7", "#ffb3d1"],
        photoBorder: "#ffffff",
        photoBorderWidth: 6,
        ornament: "hearts",
        ornamentColor: "#ff5c9a",
        textColor: "#c2185b",
        caption: "SWEET MOMENTS",
    },
    {
        id: "night",
        label: "Malam bintang",
        background: ["#1a1446", "#3b2a7a"],
        photoBorder: "#ffe27a",
        photoBorderWidth: 5,
        ornament: "stars",
        ornamentColor: "#ffe27a",
        textColor: "#ffe27a",
        caption: "STARRY NIGHT",
    },
    {
        id: "mint",
        label: "Mint",
        background: "#d8f5e6",
        photoBorder: "#2f8f5b",
        photoBorderWidth: 4,
        ornament: "dots",
        ornamentColor: "#ffffff",
        textColor: "#1f6b43",
        caption: "FRESH & FUN",
    },
    {
        id: "party",
        label: "Pesta",
        background: ["#fff4c2", "#ffd0a6"],
        photoBorder: "#ff5c39",
        photoBorderWidth: 5,
        ornament: "confetti",
        ornamentColor: "#ff5c39",
        textColor: "#c2410c",
        caption: "PARTY TIME!",
    },
];

export const DEFAULT_THEME_ID = "classic";

export const DEFAULT_STRIP_STYLE: StripCustomization = {
    themeId: DEFAULT_THEME_ID,
    borderColor: null,
    backgroundColor: null,
    caption: null,
};

export function getTheme(id: string): StripTheme {
    return STRIP_THEMES.find((t) => t.id === id) ?? STRIP_THEMES[0];
}

/** Warna awal background (untuk <input type="color">). */
export function themeBackgroundHex(theme: StripTheme): string {
    return Array.isArray(theme.background) ? theme.background[0] : theme.background;
}

/** Nilai CSS `background` untuk swatch tema di UI. */
export function themeBackgroundCss(theme: StripTheme): string {
    return Array.isArray(theme.background)
        ? `linear-gradient(180deg, ${theme.background[0]}, ${theme.background[1]})`
        : theme.background;
}

function isLightColor(hex: string): boolean {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return true;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

export function resolveTheme(custom: StripCustomization): StripTheme {
    const theme: StripTheme = { ...getTheme(custom.themeId) };

    if (custom.backgroundColor) {
        theme.background = custom.backgroundColor;
        theme.textColor = isLightColor(custom.backgroundColor) ? "#111111" : "#ffffff";
        if (theme.ornament === "film") theme.ornamentColor = theme.textColor;
    }
    if (custom.borderColor) theme.photoBorder = custom.borderColor;
    if (custom.caption !== null) theme.caption = custom.caption;

    return theme;
}

function hashString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** PRNG deterministik: ornamen selalu sama antara pratinjau dan file unduhan. */
function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = x + Math.cos(a) * rad;
        const py = y + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.9);
    ctx.bezierCurveTo(x - r * 1.6, y - r * 0.1, x - r * 0.9, y - r * 1.2, x, y - r * 0.4);
    ctx.bezierCurveTo(x + r * 0.9, y - r * 1.2, x + r * 1.6, y - r * 0.1, x, y + r * 0.9);
    ctx.closePath();
    ctx.fill();
}

interface SkipBand {
    top: number;
    bottom: number;
}

/**
 * Gambar ornamen. `skip` = rentang Y yang dikosongkan (area teks footer)
 * supaya caption dan tanggal tetap terbaca.
 */
function drawOrnaments(
    ctx: CanvasRenderingContext2D,
    theme: StripTheme,
    w: number,
    h: number,
    skip: SkipBand
): void {
    const type = theme.ornament;
    if (type === "none") return;

    ctx.save();
    ctx.fillStyle = theme.ornamentColor;

    if (type === "film") {
        const holeW = 18;
        const holeH = 26;
        const step = 48;
        const leftX = (STRIP_BORDER - holeW) / 2;
        const rightX = w - STRIP_BORDER + (STRIP_BORDER - holeW) / 2;
        for (let y = step / 2 - holeH / 2; y < h; y += step) {
            ctx.fillRect(leftX, y, holeW, holeH);
            ctx.fillRect(rightX, y, holeW, holeH);
        }
        ctx.restore();
        return;
    }

    const rand = mulberry32(hashString(theme.id));
    const cell = 64;
    ctx.globalAlpha = 0.85;

    for (let gy = 0; gy * cell < h; gy++) {
        for (let gx = 0; gx * cell < w; gx++) {
            const jx = rand();
            const jy = rand();
            const jr = rand();
            const jc = rand();

            let x: number;
            let y: number;
            if (type === "dots") {
                x = gx * cell + (gy % 2 === 0 ? cell * 0.25 : cell * 0.75);
                y = gy * cell + cell / 2;
            } else {
                x = gx * cell + cell * (0.2 + jx * 0.6);
                y = gy * cell + cell * (0.2 + jy * 0.6);
            }

            if (y > skip.top && y < skip.bottom) continue;

            const r = 7 + jr * 7;

            if (type === "dots") {
                ctx.beginPath();
                ctx.arc(x, y, 7, 0, Math.PI * 2);
                ctx.fill();
            } else if (type === "stars") {
                drawStar(ctx, x, y, r);
            } else if (type === "hearts") {
                drawHeart(ctx, x, y, r);
            } else if (type === "confetti") {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(jr * Math.PI);
                ctx.fillStyle = CONFETTI_COLORS[Math.floor(jc * CONFETTI_COLORS.length)];
                ctx.fillRect(-r, -r / 3, r * 2, (r * 2) / 3);
                ctx.restore();
            }
        }
    }
    ctx.restore();
}

function fitFont(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxSize: number,
    weight: string
): void {
    ctx.font = `${weight} ${maxSize}px ${FONT_FAMILY}`;
    const measured = ctx.measureText(text).width;
    if (measured > maxWidth) {
        const size = Math.max(8, Math.floor((maxSize * maxWidth) / measured));
        ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
    }
}

/** Placeholder untuk pratinjau tema sebelum ada foto yang disimpan. */
export function makePlaceholderEntries(count = 3): GalleryEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#8a8a84";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `bold 28px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`FOTO ${i + 1}`, c.width / 2, c.height / 2);
    return { canvas: c, time: 0 };
  });
}

// ---------------------------------------------------------------------
// Renderer strip foto
// ---------------------------------------------------------------------

export interface RenderStripOptions {
  /** Lebar maksimum hasil (untuk pratinjau). Kosongkan untuk resolusi penuh. */
  maxWidth?: number;
}

export function renderPhotoStrip(
    entries: GalleryEntry[],
    custom: StripCustomization,
    opts: RenderStripOptions = {}
    ): HTMLCanvasElement | null {
    if (entries.length === 0) return null;

    const theme = resolveTheme(custom);

    const targetW = entries[0].canvas.width;
    const heights = entries.map((e) => Math.round(e.canvas.height * (targetW / e.canvas.width)));
    const photosH = heights.reduce((sum, h) => sum + h, 0);

    const logicalW = targetW + STRIP_BORDER * 2;
    const logicalH = STRIP_BORDER * 2 + photosH + STRIP_GAP * (entries.length - 1) + STRIP_FOOTER_H;

    const shrink = opts.maxWidth && logicalW > opts.maxWidth ? opts.maxWidth / logicalW : 1;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(logicalW * shrink));
    out.height = Math.max(1, Math.round(logicalH * shrink));
    const sx = out.width / logicalW;
    const sy = out.height / logicalH;

    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(sx, sy);

    if (Array.isArray(theme.background)) {
        const g = ctx.createLinearGradient(0, 0, 0, logicalH);
        g.addColorStop(0, theme.background[0]);
        g.addColorStop(1, theme.background[1]);
        ctx.fillStyle = g;
    } else {
        ctx.fillStyle = theme.background;
    }
    ctx.fillRect(0, 0, logicalW, logicalH);

    const lastPhotoBottom = logicalH - STRIP_BORDER - STRIP_FOOTER_H;
    const footerCenter = lastPhotoBottom + (STRIP_FOOTER_H + STRIP_BORDER) / 2;

    drawOrnaments(ctx, theme, logicalW, logicalH, {
        top: lastPhotoBottom + 24,
        bottom: lastPhotoBottom + STRIP_FOOTER_H + STRIP_BORDER - 24,
    });

    const bw = theme.photoBorderWidth;
    let cursorY = STRIP_BORDER;

    entries.forEach((entry, i) => {
        const h = heights[i];

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 10 * sx;
        ctx.shadowOffsetY = 3 * sy;
        ctx.fillStyle = theme.photoBorder;
        ctx.fillRect(STRIP_BORDER - bw, cursorY - bw, targetW + bw * 2, h + bw * 2);
        ctx.restore();

        ctx.drawImage(entry.canvas, STRIP_BORDER, cursorY, targetW, h);
        cursorY += h + STRIP_GAP;
    });

    const maxTextW = logicalW - 32;
    const dateText = new Date().toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "long",
        year: "numeric",
    });
    const caption = theme.caption.trim();

    ctx.save();
    ctx.fillStyle = theme.textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (caption) {
        fitFont(ctx, caption, maxTextW, 30, "bold");
        ctx.fillText(caption, logicalW / 2, footerCenter - 12);
    }

    ctx.globalAlpha = 0.8;
    fitFont(ctx, dateText, maxTextW, 16, "normal");
    ctx.fillText(dateText, logicalW / 2, caption ? footerCenter + 18 : footerCenter);
    ctx.restore();

    return out;
}