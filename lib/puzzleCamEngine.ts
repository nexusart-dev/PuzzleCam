import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type {
  AppState,
  BoardBox,
  EngineCallbacks,
  GalleryEntry,
  NormalizedLandmark,
  PuzzlePiece,
  StripCustomization,
} from "./types";
import { DEFAULT_STRIP_STYLE, makePlaceholderEntries, renderPhotoStrip } from "./stripThemes";

const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
  MIDDLE_MCP: 9,
  RING_MCP: 13,
  PINKY_MCP: 17,
} as const;

const PINCH_THRESHOLD = 0.055;
const FRAME_PADDING = 28;
const FREEZE_HOLD_MS = 250;
const COUNTDOWN_SECONDS = 3;
const FIST_HOLD_FRAMES = 12;
const SNAP_DISTANCE_RATIO = 0.45;
const GRID = 3;
const LOAD_TIMEOUT_MS = 20000;

// Efek hitam putih hanya dipakai untuk tampilan live & hitung mundur.
// Hasil capture (puzzle, shatter, strip) tetap berwarna asli.
const PHOTOBOOTH_CONTRAST_ALPHA = 1.3;
const PHOTOBOOTH_BRIGHTNESS_BETA = 10;
const PHOTOBOOTH_NOISE_STD = 15;

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const FRAME_GRACE_MS = 450;
const SHATTER_COLS = 6;
const SHATTER_ROWS = 6;
const SHATTER_DURATION_MS = 850;
const DISPLACE_ANIM_MS = 220;
const STRIP_MAX_PHOTOS = 3;
const STRIP_PREVIEW_WIDTH = 360;

interface ShatterFragment {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  gravity: number;
}

function dist2D(a: NormalizedLandmark | Point, b: NormalizedLandmark | Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

interface Point {
  x: number;
  y: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function gaussianNoise(std: number): number {
  const u1 = Math.random() || 1e-6;
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * std;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Imperative engine that owns the webcam + canvas render loop. Instantiate
 * once per mounted <PuzzleCam />, call boot(), and destroy() on unmount.
 * UI (status text, gallery, loading, progress) is reported out through
 * `callbacks` rather than touched directly, so React stays the source of
 * truth for anything that isn't raw pixels.
 */
export class PuzzleCamEngine {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stage: HTMLElement;
  private callbacks: EngineCallbacks;

  private handLandmarker: HandLandmarker | null = null;
  private rafId: number | null = null;
  private destroyed = false;
  private stream: MediaStream | null = null;

  private appState: AppState = "tracking";

  private puzzle: {
    boardBox: BoardBox | null;
    pieces: PuzzlePiece[];
    solved: boolean;
    tileW: number;
    tileH: number;
    fullPhotoboothCanvas: HTMLCanvasElement | null;
  } = { boardBox: null, pieces: [], solved: false, tileW: 0, tileH: 0, fullPhotoboothCanvas: null };

  private shatter: {
    active: boolean;
    startedAt: number;
    fragments: ShatterFragment[];
    pendingCanvas: HTMLCanvasElement | null;
  } = { active: false, startedAt: 0, fragments: [], pendingCanvas: null };

  private galleryEntries: GalleryEntry[] = [];

  // Tema strip foto (dikendalikan dari React lewat setStripStyle)
  private stripStyle: StripCustomization = { ...DEFAULT_STRIP_STYLE };
  private placeholderEntries: GalleryEntry[] | null = null;
  private previewQueued = false;

  private freezeGate = { holding: false, since: 0 };
  private lastSeenFrame: { box: BoardBox | null; at: number } = { box: null, at: 0 };
  private countdown = { active: false, startedAt: 0 };
  private drag: {
    activeHand: string | null;
    piece: PuzzlePiece | null;
    offsetX: number;
    offsetY: number;
  } = { activeHand: null, piece: null, offsetX: 0, offsetY: 0 };
  private fistHoldCounter = 0;

  private onResize = () => this.fitCanvasToWindow();

  constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    stage: HTMLElement,
    callbacks: EngineCallbacks
  ) {
    this.video = video;
    this.canvas = canvas;
    this.stage = stage;
    this.callbacks = callbacks;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context tidak tersedia.");
    this.ctx = ctx;
    window.addEventListener("resize", this.onResize);
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  async boot(): Promise<void> {
    this.callbacks.onLoading(true);
    this.callbacks.onLoaderText("Memuat model HandLandmarker…", false);
    this.callbacks.onError(null);

    let settled = false;
    const watchdogMs = LOAD_TIMEOUT_MS * 2 + 5000;
    const watchdog = setTimeout(() => {
      if (!settled) {
        this.callbacks.onLoaderText(
          "Pemuatan terlalu lama. Klik coba lagi atau periksa koneksi Anda.",
          true
        );
      }
    }, watchdogMs);

    try {
      if (!this.video.srcObject) {
        await this.initWebcam();
      }
      this.handLandmarker = await this.initHandLandmarker();

      settled = true;
      clearTimeout(watchdog);
      this.callbacks.onLoading(false);
      this.callbacks.onStatusText("siap");
      this.rafId = requestAnimationFrame(this.renderLoop);
    } catch (err) {
      settled = true;
      clearTimeout(watchdog);
      const e = err as { name?: string; message?: string };
      if (e?.name === "NotAllowedError") {
        this.callbacks.onLoaderText(
          "Izin kamera ditolak. Aktifkan di pengaturan browser lalu klik coba lagi.",
          true
        );
      } else if (e?.name === "NotFoundError") {
        this.callbacks.onLoaderText("Tidak ditemukan webcam yang tersedia.", true);
      } else {
        this.callbacks.onLoaderText(e?.message || "Terjadi kesalahan saat memulai aplikasi.", true);
      }
    }
  }

  retry(): void {
    void this.boot();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.handLandmarker?.close();
  }

  // ---------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------

  private async initWebcam(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Browser ini tidak mendukung getUserMedia.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    this.stream = stream;
    this.video.srcObject = stream;

    await new Promise<void>((resolve) => {
      this.video.onloadedmetadata = () => {
        void this.video.play();
        resolve();
      };
    });

    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    this.fitCanvasToWindow();
  }

  private fitCanvasToWindow(): void {
    const vw = this.stage.clientWidth;
    const vh = this.stage.clientHeight;
    const videoAspect = this.canvas.width / this.canvas.height;
    const containerAspect = vw / vh;

    let cssWidth: number, cssHeight: number;
    if (containerAspect > videoAspect) {
      cssWidth = vw;
      cssHeight = vw / videoAspect;
    } else {
      cssHeight = vh;
      cssWidth = vh * videoAspect;
    }
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
  }

  private async initHandLandmarker(): Promise<HandLandmarker> {
    const vision = await withTimeout(
      FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      ),
      LOAD_TIMEOUT_MS,
      "Waktu tunggu habis saat memuat runtime MediaPipe (WASM). Periksa koneksi internet Anda atau apakah cdn.jsdelivr.net diblokir."
    );

    try {
      return await withTimeout(
        HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        }),
        LOAD_TIMEOUT_MS,
        "Waktu tunggu habis saat mengunduh model HandLandmarker (~10MB) dengan GPU."
      );
    } catch (gpuErr) {
      console.warn("[PuzzleCam] Gagal dengan delegate GPU, mencoba lagi dengan CPU…", gpuErr);
    }

    return withTimeout(
      HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      }),
      LOAD_TIMEOUT_MS,
      "Waktu tunggu habis saat mengunduh model HandLandmarker (~10MB) bahkan dengan CPU. Periksa koneksi Anda atau apakah storage.googleapis.com diblokir di jaringan Anda."
    );
  }

  // ---------------------------------------------------------------------
  // Geometry / gesture helpers
  // ---------------------------------------------------------------------

  private isPinching(landmarks: NormalizedLandmark[]): boolean {
    return dist2D(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) < PINCH_THRESHOLD;
  }

  private isFist(landmarks: NormalizedLandmark[]): boolean {
    const wrist = landmarks[LM.WRIST];
    const pairs: [number, number][] = [
      [LM.INDEX_TIP, LM.INDEX_MCP],
      [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
      [LM.RING_TIP, LM.RING_MCP],
      [LM.PINKY_TIP, LM.PINKY_MCP],
    ];
    let curled = 0;
    for (const [tipIdx, mcpIdx] of pairs) {
      if (dist2D(landmarks[tipIdx], wrist) < dist2D(landmarks[mcpIdx], wrist)) curled++;
    }
    return curled >= 4;
  }

  private toPixel(landmarkNorm: Point): Point {
    return { x: landmarkNorm.x * this.canvas.width, y: landmarkNorm.y * this.canvas.height };
  }

  private mirrorLandmarkX(landmark: Point): Point {
    return { x: 1 - landmark.x, y: landmark.y };
  }

  private computeHandFrame(indexTipA: Point, indexTipB: Point): BoardBox {
    const a = this.toPixel(indexTipA);
    const b = this.toPixel(indexTipB);

    const minX = Math.min(a.x, b.x) - FRAME_PADDING;
    const maxX = Math.max(a.x, b.x) + FRAME_PADDING;
    const minY = Math.min(a.y, b.y) - FRAME_PADDING;
    const maxY = Math.max(a.y, b.y) + FRAME_PADDING;

    const x = Math.max(0, minX);
    const y = Math.max(0, minY);
    const width = Math.min(this.canvas.width, maxX) - x;
    const height = Math.min(this.canvas.height, maxY) - y;

    return { x, y, width, height };
  }

  // ---------------------------------------------------------------------
  // Photo effect (hanya untuk tampilan live & hitung mundur)
  // ---------------------------------------------------------------------

  private applyPhotoboothEffect(imageData: ImageData): ImageData {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let v = gray * PHOTOBOOTH_CONTRAST_ALPHA + PHOTOBOOTH_BRIGHTNESS_BETA;
      v += gaussianNoise(PHOTOBOOTH_NOISE_STD);
      v = Math.max(0, Math.min(255, v));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    return imageData;
  }

  private applyBWInsideBox(box: BoardBox): void {
    const x = Math.max(0, Math.round(box.x));
    const y = Math.max(0, Math.round(box.y));
    const w = Math.min(this.canvas.width - x, Math.round(box.width));
    const h = Math.min(this.canvas.height - y, Math.round(box.height));
    if (w <= 0 || h <= 0) return;
    const region = this.ctx.getImageData(x, y, w, h);
    this.applyPhotoboothEffect(region);
    this.ctx.putImageData(region, x, y);
  }

  // ---------------------------------------------------------------------
  // Countdown & capture
  // ---------------------------------------------------------------------

  private startCountdown(frameBox: BoardBox): void {
    this.puzzle.boardBox = { ...frameBox };
    this.appState = "countdown";
    this.countdown.active = true;
    this.countdown.startedAt = performance.now();
  }

  private drawCountdownOverlay(box: BoardBox): void {
    const elapsed = (performance.now() - this.countdown.startedAt) / 1000;
    const remaining = COUNTDOWN_SECONDS - elapsed;

    if (remaining <= 0) {
      this.finishCountdownAndCapture(box);
      return;
    }

    this.applyBWInsideBox(box);

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "#f5c518";
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    const n = Math.ceil(remaining);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    ctx.fillStyle = "rgba(10,10,8,0.45)";
    ctx.fillRect(box.x, box.y, box.width, box.height);

    ctx.font = `${Math.max(48, Math.min(box.width, box.height) * 0.4)}px 'IBM Plex Mono', monospace`;
    ctx.fillStyle = "#f5c518";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), cx, cy);
    ctx.restore();

    this.callbacks.onStatusText(`Mengambil foto dalam ${n}…`);
  }

  private finishCountdownAndCapture(box: BoardBox): void {
    this.countdown.active = false;

    const mirroredFrame = document.createElement("canvas");
    mirroredFrame.width = this.canvas.width;
    mirroredFrame.height = this.canvas.height;
    const mirroredCtx = mirroredFrame.getContext("2d")!;
    mirroredCtx.save();
    mirroredCtx.translate(mirroredFrame.width, 0);
    mirroredCtx.scale(-1, 1);
    mirroredCtx.drawImage(this.video, 0, 0, mirroredFrame.width, mirroredFrame.height);
    mirroredCtx.restore();

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.round(box.width));
    cropCanvas.height = Math.max(1, Math.round(box.height));
    const cropCtx = cropCanvas.getContext("2d")!;
    cropCtx.drawImage(
      mirroredFrame,
      box.x, box.y, box.width, box.height,
      0, 0, cropCanvas.width, cropCanvas.height
    );

    // Hasil crop disimpan berwarna asli (tanpa efek hitam putih).
    this.puzzle.fullPhotoboothCanvas = cropCanvas;

    const tileW = Math.floor(cropCanvas.width / GRID);
    const tileH = Math.floor(cropCanvas.height / GRID);
    const pieces: PuzzlePiece[] = [];

    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const sx = col * tileW;
        const sy = row * tileH;
        const w = col === GRID - 1 ? cropCanvas.width - sx : tileW;
        const h = row === GRID - 1 ? cropCanvas.height - sy : tileH;

        const pieceCanvas = document.createElement("canvas");
        pieceCanvas.width = w;
        pieceCanvas.height = h;
        pieceCanvas.getContext("2d")!.drawImage(cropCanvas, sx, sy, w, h, 0, 0, w, h);

        pieces.push({ row, col, canvas: pieceCanvas, w, h, x: 0, y: 0, placed: false, dragging: false });
      }
    }

    const slots: Point[] = [];
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        slots.push({ x: box.x + col * tileW, y: box.y + row * tileH });
      }
    }
    shuffle(slots);

    pieces.forEach((piece, i) => {
      piece.x = slots[i].x;
      piece.y = slots[i].y;
      if (this.isNearOwnCell(piece, box, tileW, tileH)) {
        this.snapPieceToCell(piece, box, tileW, tileH);
      }
    });

    this.puzzle.boardBox = box;
    this.puzzle.pieces = pieces;
    this.puzzle.tileW = tileW;
    this.puzzle.tileH = tileH;
    this.puzzle.solved = pieces.every((p) => p.placed);
    this.appState = "puzzle";
    this.fistHoldCounter = 0;
    this.updateProgressBadge();
  }

  // ---------------------------------------------------------------------
  // Puzzle mechanics
  // ---------------------------------------------------------------------

  private isNearOwnCell(piece: PuzzlePiece, box: BoardBox, tileW: number, tileH: number): boolean {
    const correctX = box.x + piece.col * tileW;
    const correctY = box.y + piece.row * tileH;
    const dx = piece.x - correctX;
    const dy = piece.y - correctY;
    const tolerance = Math.min(tileW, tileH) * SNAP_DISTANCE_RATIO;
    return Math.sqrt(dx * dx + dy * dy) < tolerance;
  }

  private reconcilePlacedState(box: BoardBox | null, tileW: number, tileH: number): boolean {
    if (!box || !this.puzzle.pieces.length) return false;
    for (const piece of this.puzzle.pieces) {
      if (piece.displacing || piece.dragging) continue;
      piece.placed = this.isNearOwnCell(piece, box, tileW, tileH);
    }
    return this.puzzle.pieces.every((p) => p.placed);
  }

  private snapPieceToCell(piece: PuzzlePiece, box: BoardBox, tileW: number, tileH: number): void {
    this.displaceCellOccupant(piece, piece.row, piece.col, box, tileW, tileH);
    piece.x = box.x + piece.col * tileW;
    piece.y = box.y + piece.row * tileH;
    piece.placed = true;
  }

  private displaceCellOccupant(
    piece: PuzzlePiece,
    targetRow: number,
    targetCol: number,
    box: BoardBox,
    tileW: number,
    tileH: number
  ): void {
    const cellX = box.x + targetCol * tileW;
    const cellY = box.y + targetRow * tileH;

    const occupant = this.puzzle.pieces.find((p) => {
      if (p === piece || p.displacing) return false;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      return cx >= cellX && cx < cellX + tileW && cy >= cellY && cy < cellY + tileH;
    });
    if (!occupant) return;

    if (occupant.row === targetRow && occupant.col === targetCol && occupant.placed) return;

    occupant.placed = false;

    const freeCells: { row: number; col: number }[] = [];
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        if (row === targetRow && col === targetCol) continue;
        const cx0 = box.x + col * tileW;
        const cy0 = box.y + row * tileH;
        const taken = this.puzzle.pieces.some((p) => {
          if (p === occupant || p === piece || p.displacing) return false;
          const cx = p.x + p.w / 2;
          const cy = p.y + p.h / 2;
          return cx >= cx0 && cx < cx0 + tileW && cy >= cy0 && cy < cy0 + tileH;
        });
        if (!taken) freeCells.push({ row, col });
      }
    }

    const targetSlot =
      freeCells.length > 0
        ? freeCells[Math.floor(Math.random() * freeCells.length)]
        : { row: occupant.row, col: occupant.col };

    const jitterX = (Math.random() - 0.5) * tileW * 0.5;
    const jitterY = (Math.random() - 0.5) * tileH * 0.5;
    const targetX = box.x + targetSlot.col * tileW + jitterX;
    const targetY = box.y + targetSlot.row * tileH + jitterY;

    this.animateDisplacement(occupant, targetX, targetY);
  }

  private animateDisplacement(piece: PuzzlePiece, targetX: number, targetY: number): void {
    const startX = piece.x;
    const startY = piece.y;
    const startedAt = performance.now();
    piece.displacing = true;

    const step = () => {
      if (this.destroyed) return;
      const t = Math.min(1, (performance.now() - startedAt) / DISPLACE_ANIM_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      piece.x = startX + (targetX - startX) * eased;
      piece.y = startY + (targetY - startY) * eased;

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        piece.x = targetX;
        piece.y = targetY;
        piece.displacing = false;
        this.clampPieceToBoard(piece);
      }
    };
    requestAnimationFrame(step);
  }

  private findNearestPiece(px: number, py: number): PuzzlePiece | null {
    let best: PuzzlePiece | null = null;
    let bestDist = Infinity;
    for (const piece of this.puzzle.pieces) {
      if (piece.displacing) continue;
      const cx = piece.x + piece.w / 2;
      const cy = piece.y + piece.h / 2;
      const d = Math.hypot(px - cx, py - cy);
      if (d < Math.max(piece.w, piece.h) * 0.75 && d < bestDist) {
        best = piece;
        bestDist = d;
      }
    }
    return best;
  }

  private handleDragForHand(handLabel: string, pinching: boolean, indexPx: Point): void {
    if (pinching) {
      if (this.drag.activeHand === null) {
        const candidate = this.findNearestPiece(indexPx.x, indexPx.y);
        if (candidate) {
          this.drag.activeHand = handLabel;
          this.drag.piece = candidate;
          this.drag.offsetX = indexPx.x - candidate.x;
          this.drag.offsetY = indexPx.y - candidate.y;
          candidate.dragging = true;
          candidate.placed = false;
        }
      } else if (this.drag.activeHand === handLabel && this.drag.piece) {
        this.drag.piece.x = indexPx.x - this.drag.offsetX;
        this.drag.piece.y = indexPx.y - this.drag.offsetY;
      }
    } else if (this.drag.activeHand === handLabel && this.drag.piece) {
      const piece = this.drag.piece;
      const box = this.puzzle.boardBox!;
      piece.dragging = false;
      if (this.isNearOwnCell(piece, box, this.puzzle.tileW, this.puzzle.tileH)) {
        this.snapPieceToCell(piece, box, this.puzzle.tileW, this.puzzle.tileH);
      } else {
        this.clampPieceToBoard(piece);
        const cx = piece.x + piece.w / 2;
        const cy = piece.y + piece.h / 2;
        const dropCol = Math.min(GRID - 1, Math.max(0, Math.floor((cx - box.x) / this.puzzle.tileW)));
        const dropRow = Math.min(GRID - 1, Math.max(0, Math.floor((cy - box.y) / this.puzzle.tileH)));
        this.displaceCellOccupant(piece, dropRow, dropCol, box, this.puzzle.tileW, this.puzzle.tileH);
      }
      this.drag.activeHand = null;
      this.drag.piece = null;
      this.puzzle.solved = this.reconcilePlacedState(box, this.puzzle.tileW, this.puzzle.tileH);
      this.updateProgressBadge();
    }
  }

  private clampPieceToBoard(piece: PuzzlePiece): void {
    const box = this.puzzle.boardBox!;
    piece.x = Math.min(Math.max(piece.x, box.x), box.x + box.width - piece.w);
    piece.y = Math.min(Math.max(piece.y, box.y), box.y + box.height - piece.h);
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------

  private drawBoardAndPieces(): void {
    const ctx = this.ctx;
    const box = this.puzzle.boardBox!;

    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(245,197,24,0.18)";
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      ctx.beginPath();
      ctx.moveTo(box.x + i * this.puzzle.tileW, box.y);
      ctx.lineTo(box.x + i * this.puzzle.tileW, box.y + box.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + i * this.puzzle.tileH);
      ctx.lineTo(box.x + box.width, box.y + i * this.puzzle.tileH);
      ctx.stroke();
    }
    ctx.restore();

    const sorted = [...this.puzzle.pieces].sort((a, b) => (a.dragging ? 1 : 0) - (b.dragging ? 1 : 0));

    for (const piece of sorted) {
      ctx.save();
      if (piece.dragging) {
        ctx.shadowColor = "rgba(245,197,24,0.9)";
        ctx.shadowBlur = 14;
      }
      ctx.drawImage(piece.canvas, piece.x, piece.y, piece.w, piece.h);
      ctx.strokeStyle = piece.placed ? "#5fae6e" : "rgba(234,229,214,0.5)";
      ctx.lineWidth = piece.dragging ? 3 : 1.5;
      ctx.strokeRect(piece.x, piece.y, piece.w, piece.h);
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = this.puzzle.solved ? "#5fae6e" : "#f5c518";
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.restore();

    if (this.puzzle.solved) {
      ctx.save();
      ctx.fillStyle = "rgba(95,174,110,0.15)";
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.font = `${Math.max(20, box.width * 0.07)}px 'IBM Plex Mono', monospace`;
      ctx.fillStyle = "#5fae6e";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "SELESAI! — kepalkan tangan untuk menyimpan",
        box.x + box.width / 2,
        box.y + box.height / 2
      );
      ctx.restore();
    }
  }

  private updateProgressBadge(): void {
    if (this.appState !== "puzzle") {
      this.callbacks.onProgress(false, "", false);
      return;
    }
    const placedCount = this.puzzle.pieces.filter((p) => p.placed).length;
    this.callbacks.onProgress(
      true,
      `${placedCount} / ${this.puzzle.pieces.length} Keping Terpasang!`,
      this.puzzle.solved
    );
  }

  private drawVideoFrame(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  private drawLiveFrameOverlay(box: BoardBox): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "#f5c518";
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    const cornerLen = 18;
    ctx.lineWidth = 4;
    const corners: [number, number, number, number][] = [
      [box.x, box.y, 1, 1],
      [box.x + box.width, box.y, -1, 1],
      [box.x, box.y + box.height, 1, -1],
      [box.x + box.width, box.y + box.height, -1, -1],
    ];
    for (const [cx, cy, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + cornerLen * dy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + cornerLen * dx, cy);
      ctx.stroke();
    }
    ctx.restore();
  }

  private isPointInBoard(px: number, py: number, box: BoardBox | null): boolean {
    if (!box) return false;
    return px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height;
  }

  private drawHandSkeleton(landmarksPx: Point[]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;

    for (const [iA, iB] of HAND_CONNECTIONS) {
      const a = landmarksPx[iA];
      const b = landmarksPx[iB];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.shadowBlur = 6;
    ctx.fillStyle = "white";
    for (const p of landmarksPx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHandSkeletonsOverBoard(handsLandmarks: NormalizedLandmark[][], box: BoardBox | null): void {
    if (!box || !handsLandmarks.length) return;
    for (const lm of handsLandmarks) {
      const landmarksPx = lm.map((pt) => this.toPixel(this.mirrorLandmarkX(pt)));
      const overBoard = landmarksPx.some((p) => this.isPointInBoard(p.x, p.y, box));
      if (overBoard) this.drawHandSkeleton(landmarksPx);
    }
  }

  // ---------------------------------------------------------------------
  // Shatter (save) animation
  // ---------------------------------------------------------------------

  private startShatter(sourceCanvas: HTMLCanvasElement, box: BoardBox): void {
    const cols = SHATTER_COLS;
    const rows = SHATTER_ROWS;
    const fragW = sourceCanvas.width / cols;
    const fragH = sourceCanvas.height / rows;
    const fragments: ShatterFragment[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sx = col * fragW;
        const sy = row * fragH;

        const fragCanvas = document.createElement("canvas");
        fragCanvas.width = Math.ceil(fragW);
        fragCanvas.height = Math.ceil(fragH);
        fragCanvas.getContext("2d")!.drawImage(sourceCanvas, sx, sy, fragW, fragH, 0, 0, fragCanvas.width, fragCanvas.height);

        const cx = box.x + sx + fragW / 2;
        const cy = box.y + sy + fragH / 2;
        const boardCx = box.x + box.width / 2;
        const boardCy = box.y + box.height / 2;
        const dirX = cx - boardCx;
        const dirY = cy - boardCy;
        const dirLen = Math.max(1, Math.hypot(dirX, dirY));
        const speed = 90 + Math.random() * 160;

        fragments.push({
          canvas: fragCanvas,
          x: cx,
          y: cy,
          w: fragW,
          h: fragH,
          vx: (dirX / dirLen) * speed + (Math.random() - 0.5) * 40,
          vy: (dirY / dirLen) * speed + (Math.random() - 0.5) * 40 - 60,
          rotation: 0,
          rotationSpeed: (Math.random() - 0.5) * 6,
          gravity: 220 + Math.random() * 80,
        });
      }
    }

    this.shatter.fragments = fragments;
    this.shatter.active = true;
    this.shatter.startedAt = performance.now();
    this.appState = "shattering";
  }

  private updateAndDrawShatter(): void {
    const elapsedMs = performance.now() - this.shatter.startedAt;
    const t = Math.min(1, elapsedMs / SHATTER_DURATION_MS);

    if (t >= 1) {
      this.finishShatter();
      return;
    }

    const dt = 1 / 60;
    const fadeStart = 0.45;
    const ctx = this.ctx;

    ctx.save();
    for (const frag of this.shatter.fragments) {
      frag.x += frag.vx * dt;
      frag.y += frag.vy * dt;
      frag.vy += frag.gravity * dt;
      frag.rotation += frag.rotationSpeed * dt;

      const alpha = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));
      const scale = 1 - t * 0.25;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(frag.x, frag.y);
      ctx.rotate(frag.rotation);
      ctx.scale(scale, scale);
      ctx.drawImage(frag.canvas, -frag.w / 2, -frag.h / 2, frag.w, frag.h);
      ctx.restore();
    }
    ctx.restore();
  }

  private finishShatter(): void {
    this.shatter.active = false;
    this.shatter.fragments = [];
    if (this.shatter.pendingCanvas) {
      this.addToGallery(this.shatter.pendingCanvas);
      this.callbacks.onStatusText("Tersimpan di strip foto!");
      this.shatter.pendingCanvas = null;
    }
    this.resetPuzzleOnly();
  }

  private handleFistReset(): void {
    if (this.appState !== "puzzle") {
      this.callbacks.onStatusText("direset (kepalan tangan)");
      this.resetPuzzleOnly();
      return;
    }

    const reallySolved = this.reconcilePlacedState(this.puzzle.boardBox, this.puzzle.tileW, this.puzzle.tileH);
    this.puzzle.solved = reallySolved;

    if (reallySolved && this.puzzle.fullPhotoboothCanvas) {
      this.shatter.pendingCanvas = this.puzzle.fullPhotoboothCanvas;
      this.startShatter(this.puzzle.fullPhotoboothCanvas, this.puzzle.boardBox!);
    } else {
      this.callbacks.onStatusText("direset (kepalan tangan)");
      this.resetPuzzleOnly();
    }
  }

  // ---------------------------------------------------------------------
  // Gallery & tema strip foto
  // ---------------------------------------------------------------------

  private isStripFull(): boolean {
    return this.galleryEntries.length >= STRIP_MAX_PHOTOS;
  }

  private addToGallery(snapshotCanvas: HTMLCanvasElement): void {
    if (this.galleryEntries.length >= STRIP_MAX_PHOTOS) return;

    this.galleryEntries.push({ canvas: snapshotCanvas, time: Date.now() });

    this.callbacks.onGalleryCount(this.galleryEntries.length, STRIP_MAX_PHOTOS);
    this.callbacks.onDownloadEnabled(true);
    this.emitStripPreview();

    if (this.galleryEntries.length >= STRIP_MAX_PHOTOS) {
      this.callbacks.onStripFull(true);
    }
  }

  /**
   * Ganti tema/kustomisasi strip. Aman dipanggil berkali-kali (mis. saat
   * color picker digeser): pratinjau digabung per frame.
   */
  setStripStyle(next: StripCustomization): void {
    this.stripStyle = { ...next };
    this.emitStripPreview();
  }

  private emitStripPreview(): void {
    if (this.previewQueued) return;
    this.previewQueued = true;
    requestAnimationFrame(() => {
      this.previewQueued = false;
      if (this.destroyed) return;

      let entries = this.galleryEntries;
      if (entries.length === 0) {
        if (!this.placeholderEntries) this.placeholderEntries = makePlaceholderEntries();
        entries = this.placeholderEntries;
      }

      const preview = renderPhotoStrip(entries, this.stripStyle, { maxWidth: STRIP_PREVIEW_WIDTH });
      if (preview) this.callbacks.onStripPreview(preview.toDataURL("image/jpeg", 0.92));
    });
  }

  downloadPhotoStrip(): void {
    const stripCanvas = renderPhotoStrip(this.galleryEntries, this.stripStyle);
    if (!stripCanvas) return;

    stripCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `puzzlecam_strip_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, "image/png");
  }

  resetPuzzleOnly(): void {
    this.puzzle.boardBox = null;
    this.puzzle.pieces = [];
    this.puzzle.solved = false;
    this.puzzle.fullPhotoboothCanvas = null;
    this.appState = "tracking";
    this.countdown.active = false;
    this.drag.activeHand = null;
    this.drag.piece = null;
    this.shatter.active = false;
    this.shatter.fragments = [];
    this.shatter.pendingCanvas = null;
    this.fistHoldCounter = 0;
    this.lastSeenFrame.box = null;
    this.lastSeenFrame.at = 0;
    this.updateProgressBadge();
  }

  /** Hapus semua foto di strip. Tema & warna pilihan pengguna tetap dipertahankan. */
  resetAll(): void {
    this.galleryEntries = [];
    this.callbacks.onGalleryCount(0, STRIP_MAX_PHOTOS);
    this.callbacks.onStripFull(false);
    this.callbacks.onDownloadEnabled(false);
    this.emitStripPreview();
    this.resetPuzzleOnly();
    this.callbacks.onStatusText("Semua Direset");
  }

  // ---------------------------------------------------------------------
  // Main per-frame logic (mirrors the original processResults)
  // ---------------------------------------------------------------------

  private processResults(result: { landmarks: NormalizedLandmark[][] }): void {
    if (this.appState === "shattering") {
      this.updateAndDrawShatter();
      this.callbacks.onStatusText("menyimpan…");
      return;
    }

    const handsLandmarks = result.landmarks || [];
    const noHands = handsLandmarks.length === 0;

    if (noHands) {
      this.callbacks.onStatusDot(this.puzzle.solved ? "solved" : "idle");
      this.fistHoldCounter = 0;
      this.freezeGate.holding = false;

      if (this.drag.activeHand && this.drag.piece) {
        this.handleDragForHand(this.drag.activeHand, false, { x: this.drag.piece.x, y: this.drag.piece.y });
      }

      if (this.appState === "tracking") {
        const sinceLastSeen = performance.now() - this.lastSeenFrame.at;
        if (this.lastSeenFrame.box && sinceLastSeen < FRAME_GRACE_MS) {
          this.applyBWInsideBox(this.lastSeenFrame.box);
          this.drawLiveFrameOverlay(this.lastSeenFrame.box);
        }
        this.callbacks.onStatusText(this.isStripFull() ? "strip penuh — unduh atau reset" : "mencari tangan…");
        return;
      }

      if (this.appState === "countdown") {
        this.drawCountdownOverlay(this.puzzle.boardBox!);
        return;
      }

      if (this.appState === "puzzle") {
        this.puzzle.solved = this.reconcilePlacedState(this.puzzle.boardBox, this.puzzle.tileW, this.puzzle.tileH);
        this.updateProgressBadge();
        this.drawBoardAndPieces();
        this.callbacks.onStatusText(
          this.puzzle.solved ? "puzzle selesai! kepalkan tangan untuk menyimpan" : "susun puzzle dengan cubit foto"
        );
        return;
      }
      return;
    }

    this.callbacks.onStatusDot(this.puzzle.solved ? "solved" : "live");

    const anyFist = handsLandmarks.some((lm) => this.isFist(lm));
    const draggingNow = this.drag.activeHand !== null && this.drag.piece !== null;
    if (anyFist && !draggingNow && this.appState !== "tracking") {
      this.fistHoldCounter++;
      if (this.fistHoldCounter >= FIST_HOLD_FRAMES) {
        this.fistHoldCounter = 0;
        this.handleFistReset();
        return;
      }
    } else {
      this.fistHoldCounter = 0;
    }

    if (this.appState === "tracking") {
      if (this.isStripFull()) {
        this.callbacks.onStatusText("strip penuh — unduh atau reset");
        return;
      }
      if (handsLandmarks.length === 2) {
        const [handA, handB] = handsLandmarks;
        const indexA = this.mirrorLandmarkX(handA[LM.INDEX_TIP]);
        const indexB = this.mirrorLandmarkX(handB[LM.INDEX_TIP]);
        const frameBox = this.computeHandFrame(indexA, indexB);

        if (frameBox.width > 4 && frameBox.height > 4) {
          this.applyBWInsideBox(frameBox);
          this.drawLiveFrameOverlay(frameBox);
          this.lastSeenFrame.box = frameBox;
          this.lastSeenFrame.at = performance.now();
        }

        const bothPinching = this.isPinching(handA) && this.isPinching(handB);
        if (bothPinching && frameBox.width > 40 && frameBox.height > 40) {
          if (!this.freezeGate.holding) {
            this.freezeGate.holding = true;
            this.freezeGate.since = performance.now();
          }
          this.callbacks.onStatusDot("armed");
          this.callbacks.onStatusText("tahan cubitannya…");

          if (performance.now() - this.freezeGate.since > FREEZE_HOLD_MS) {
            this.freezeGate.holding = false;
            this.startCountdown(frameBox);
          }
        } else {
          this.freezeGate.holding = false;
          this.callbacks.onStatusText("tangan sedang dilacak");
        }
      } else {
        this.freezeGate.holding = false;
        const sinceLastSeen = performance.now() - this.lastSeenFrame.at;
        if (this.lastSeenFrame.box && sinceLastSeen < FRAME_GRACE_MS) {
          this.applyBWInsideBox(this.lastSeenFrame.box);
          this.drawLiveFrameOverlay(this.lastSeenFrame.box);
        }
        this.callbacks.onStatusText("tangan sedang dilacak");
      }
      return;
    }

    if (this.appState === "countdown") {
      this.drawCountdownOverlay(this.puzzle.boardBox!);
      return;
    }

    if (this.appState === "puzzle") {
      const labelsPresent = new Set<string>();
      handsLandmarks.forEach((lm, i) => {
        const label = i === 0 ? "A" : "B";
        labelsPresent.add(label);
        const pinching = this.isPinching(lm);
        const indexPx = this.toPixel(this.mirrorLandmarkX(lm[LM.INDEX_TIP]));
        this.handleDragForHand(label, pinching, indexPx);
      });

      if (this.drag.activeHand && !labelsPresent.has(this.drag.activeHand) && this.drag.piece) {
        this.handleDragForHand(this.drag.activeHand, false, { x: this.drag.piece.x, y: this.drag.piece.y });
      }

      if (!this.drag.piece) {
        this.puzzle.solved = this.reconcilePlacedState(this.puzzle.boardBox, this.puzzle.tileW, this.puzzle.tileH);
        this.updateProgressBadge();
      }

      this.drawBoardAndPieces();
      this.drawHandSkeletonsOverBoard(handsLandmarks, this.puzzle.boardBox);

      this.callbacks.onStatusText(
        this.puzzle.solved
          ? this.fistHoldCounter > 0
            ? `menyimpan… tahan kepalan tangan (${this.fistHoldCounter}/${FIST_HOLD_FRAMES})`
            : "puzzle selesai! kepalkan tangan untuk menyimpan"
          : "susun puzzle dengan cubit"
      );
    }
  }

  private renderLoop = (): void => {
    if (this.destroyed) return;
    if (this.video.readyState >= 2 && this.handLandmarker) {
      this.drawVideoFrame();
      const nowMs = performance.now();
      const result = this.handLandmarker.detectForVideo(this.video, nowMs);
      this.processResults(result as { landmarks: NormalizedLandmark[][] });
    }
    this.rafId = requestAnimationFrame(this.renderLoop);
  };
}