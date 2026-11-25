export type AppState = "tracking" | "countdown" | "puzzle" | "shattering";

export type StatusDotVariant = "idle" | "live" | "armed" | "solved";

export interface Point2D {
  x: number;
  y: number;
}

export interface BoardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PuzzlePiece {
  row: number;
  col: number;
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  x: number;
  y: number;
  placed: boolean;
  dragging: boolean;
  displacing?: boolean;
}

export interface GalleryEntry {
  canvas: HTMLCanvasElement;
  time: number;
}

/** Minimal shape of a MediaPipe normalized landmark — avoids a hard
 * dependency on internal library types while staying type-safe. */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export interface HandLandmarkerResultLike {
  landmarks: NormalizedLandmark[][];
}

// ---------------------------------------------------------------------
// Tema strip foto
// ---------------------------------------------------------------------

export type OrnamentType = "none" | "stars" | "hearts" | "dots" | "confetti" | "film";

export interface StripTheme {
  id: string;
  label: string;
  /** Warna solid, atau [atas, bawah] untuk gradasi. */
  background: string | [string, string];
  photoBorder: string;
  photoBorderWidth: number;
  ornament: OrnamentType;
  ornamentColor: string;
  textColor: string;
  caption: string;
}

/**
 * Pilihan pengguna di atas tema dasar. Nilai `null` berarti "pakai bawaan tema".
 * Untuk `caption`, string kosong ("") berarti tanpa caption.
 */
export interface StripCustomization {
  themeId: string;
  borderColor: string | null;
  backgroundColor: string | null;
  caption: string | null;
}

/** Callbacks the imperative engine uses to push UI updates out to React
 * state, instead of touching the DOM directly (as the original app.js did
 * via getElementById/textContent). Canvas drawing itself stays imperative —
 * that's the correct pattern for a webcam + <canvas> render loop. */
export interface EngineCallbacks {
  onStatusText: (text: string) => void;
  onStatusDot: (variant: StatusDotVariant) => void;
  onLoading: (loading: boolean) => void;
  onLoaderText: (text: string, isError: boolean) => void;
  onError: (message: string | null) => void;
  onProgress: (visible: boolean, text: string, solved: boolean) => void;
  onGalleryCount: (count: number, max: number) => void;
  onStripFull: (full: boolean) => void;
  onDownloadEnabled: (enabled: boolean) => void;
  /** Pratinjau strip (data URL) sesuai tema + foto yang sudah tersimpan. */
  onStripPreview: (dataUrl: string) => void;
}

// ---------------------------------------------------------------------
// Online multiplayer session
// ---------------------------------------------------------------------

export interface OnlineSession {
  token: string;
  channelName: string;
  isHost: boolean;
  members: SessionMember[];
  status: 'idle' | 'countdown' | 'capturing' | 'assembling' | 'done';
}

export interface SessionMember {
  id: string;
  name: string;
  imageData?: string;
}

export interface AssemblyOptions {
  cellWidth?: number;
  cellHeight?: number;
  gap?: number;
  labelHeight?: number;
  background?: string;
}