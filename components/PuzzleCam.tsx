"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { PuzzleCamEngine } from "@/lib/puzzleCamEngine";
import {
  DEFAULT_STRIP_STYLE,
  STRIP_THEMES,
  getTheme,
  themeBackgroundCss,
  themeBackgroundHex,
} from "@/lib/stripThemes";
import type { EngineCallbacks, StatusDotVariant, StripCustomization } from "@/lib/types";
import { useOnlineSession } from "@/lib/useOnlineSession";

const STRIP_MAX_PHOTOS = 3;
const CAPTION_MAX_LENGTH = 24;

export default function PuzzleCam() {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PuzzleCamEngine | null>(null);
  const miniPreviewRef = useRef<HTMLCanvasElement>(null);

  const [statusText, setStatusText] = useState("memulai kamera…");
  const [statusDot, setStatusDot] = useState<StatusDotVariant>("idle");

  const [loading, setLoading] = useState(true);
  const [loaderText, setLoaderText] = useState("Memuat model marker…");
  const [loaderIsError, setLoaderIsError] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [progressVisible, setProgressVisible] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressSolved, setProgressSolved] = useState(false);

  const [galleryCount, setGalleryCount] = useState(0);
  const [stripFull, setStripFull] = useState(false);
  const [downloadEnabled, setDownloadEnabled] = useState(false);

  const [stripStyle, setStripStyle] = useState<StripCustomization>(DEFAULT_STRIP_STYLE);
  const [stripPreview, setStripPreview] = useState<string | null>(null);

  // Online multiplayer state
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(false);
  const [joinTokenInput, setJoinTokenInput] = useState("");
  const [displayName, setDisplayName] = useState("");

  const {
    session,
    pusherUnconfigured,
    error: onlineError,
    countdownValue,
    collageUrl,
    myId,
    createSession,
    joinSession,
    triggerCountdown,
    leaveSession,
    resetCollage,
  } = useOnlineSession(videoRef, displayName || "Tamu");

  // Draw a still frame into the mini preview canvas when session becomes active
  useEffect(() => {
    if (!session || session.status === "done") return;
    const video = videoRef.current;
    const canvas = miniPreviewRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 160;
    canvas.height = 120;
    ctx.drawImage(video, 0, 0, 160, 120);
  }, [session]);


  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !stageRef.current) return;

    const callbacks: EngineCallbacks = {
      onStatusText: setStatusText,
      onStatusDot: setStatusDot,
      onLoading: setLoading,
      onLoaderText: (text, isError) => {
        setLoaderText(text);
        setLoaderIsError(isError);
      },
      onError: setErrorMessage,
      onProgress: (visible, text, solved) => {
        setProgressVisible(visible);
        setProgressText(text);
        setProgressSolved(solved);
      },
      onGalleryCount: (count) => setGalleryCount(count),
      onStripFull: setStripFull,
      onDownloadEnabled: setDownloadEnabled,
      onStripPreview: setStripPreview,
    };

    const engine = new PuzzleCamEngine(videoRef.current, canvasRef.current, stageRef.current, callbacks);
    engineRef.current = engine;
    void engine.boot();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setStripStyle(stripStyle);
  }, [stripStyle]);

  const handleRetry = useCallback(() => engineRef.current?.retry(), []);
  const handleDownloadStrip = useCallback(() => engineRef.current?.downloadPhotoStrip(), []);
  const handleResetAll = useCallback(() => {
    const confirmed = window.confirm("Yakin ingin menghapus seluruh strip foto dan memulai dari awal?");
    if (confirmed) {
      engineRef.current?.resetAll();
    }
  }, []);

  const handleSelectTheme = useCallback((themeId: string) => {
    setStripStyle({ themeId, borderColor: null, backgroundColor: null, caption: null });
  }, []);

  const updateStrip = useCallback((patch: Partial<StripCustomization>) => {
    setStripStyle((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleDownloadCollage = useCallback(() => {
    if (!collageUrl) return;
    const a = document.createElement("a");
    a.href = collageUrl;
    a.download = `puzzlecam_bersama_${Date.now()}.jpg`;
    a.click();
  }, [collageUrl]);

  const activeTheme = getTheme(stripStyle.themeId);
  const borderValue = stripStyle.borderColor ?? activeTheme.photoBorder;
  const backgroundValue = stripStyle.backgroundColor ?? themeBackgroundHex(activeTheme);
  const captionValue = stripStyle.caption ?? activeTheme.caption;
  const isCustomized =
    stripStyle.borderColor !== null || stripStyle.backgroundColor !== null || stripStyle.caption !== null;

  const statusLabel = (() => {
    if (!session) return "";
    switch (session.status) {
      case "countdown": return "Bersiap…";
      case "capturing": return "Mengambil foto…";
      case "assembling": return "Menggabungkan foto…";
      default: return "";
    }
  })();

  return (
    <div id="app">
      <div id="stage" ref={stageRef}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video id="webcam" ref={videoRef} playsInline autoPlay muted />
        <canvas id="sceneCanvas" ref={canvasRef} />

        <div className="hud-top">
          <div className="brand">
            PuzzleCam - Nexus.Art <small>tangkapan gerakan tangan</small>
          </div>
          <div className="status-pill">
            <span className={`status-dot ${statusDot !== "idle" ? statusDot : ""}`} />
            <span>{statusText}</span>
          </div>
        </div>

        <div className={`progress-badge${progressVisible ? " visible" : ""}${progressSolved ? " solved" : ""}`}>
          <span>{progressText}</span>
        </div>

        {/* Online panel toggle button */}
        <div className="online-toggle-btn-wrap">
          <button
            type="button"
            className="online-toggle-btn"
            onClick={() => setOnlinePanelOpen((v) => !v)}
          >
            {session ? "🔴 Online" : "📡 Online"}
          </button>
        </div>

        {/* Countdown overlay */}
        {countdownValue !== null && countdownValue > 0 && (
          <div className="countdown-overlay">
            <span>{countdownValue}</span>
          </div>
        )}

        <div id="loadingOverlay" className={loading ? "" : "hidden"}>
          <div className="loader-text" style={loaderIsError ? { color: "#e0533d" } : undefined}>
            {loaderText}
          </div>
          <div className="loader-bar" />
          <button
            type="button"
            className={`loader-retry${loaderIsError ? "" : " hidden"}`}
            onClick={handleRetry}
          >
            coba lagi
          </button>
        </div>

        {errorMessage && <div id="errorBanner" style={{ display: "block" }}>{errorMessage}</div>}
      </div>

      <aside id="gallery">
        <div className="gallery-head">
          <span className="gallery-title">Galeri</span>
          <span className="gallery-count">
            {galleryCount} / {STRIP_MAX_PHOTOS}
          </span>
        </div>

        {/* <div className={`strip-complete-msg${stripFull ? " visible" : ""}`}>
          galeri lengkap — unduh atau mulai ulang untuk melanjutkan
        </div> */}

        <div className="strip-designer">
          <div className="designer-group">
            <span className="designer-label" id="theme-label">
              Tema strip
            </span>
            <div className="theme-list" role="radiogroup" aria-labelledby="theme-label">
              {STRIP_THEMES.map((t) => {
                const active = t.id === stripStyle.themeId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`theme-chip${active ? " active" : ""}`}
                    onClick={() => handleSelectTheme(t.id)}
                  >
                    <span
                      className="theme-swatch"
                      style={{ background: themeBackgroundCss(t), borderColor: t.photoBorder }}
                    />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="designer-group designer-colors">
            <label className="color-field">
              <span className="designer-label">Background</span>
              <input
                type="color"
                value={backgroundValue}
                onChange={(e) => updateStrip({ backgroundColor: e.target.value })}
              />
            </label>
            <label className="color-field">
              <span className="designer-label">Border foto</span>
              <input
                type="color"
                value={borderValue}
                onChange={(e) => updateStrip({ borderColor: e.target.value })}
              />
            </label>
          </div>

          <label className="designer-group">
            <span className="designer-label">Tulisan di bawah strip</span>
            <input
              type="text"
              className="caption-input"
              value={captionValue}
              maxLength={CAPTION_MAX_LENGTH}
              placeholder="Kosongkan jika tidak perlu"
              onChange={(e) => updateStrip({ caption: e.target.value })}
            />
          </label>

          <button
            type="button"
            className="designer-reset"
            disabled={!isCustomized}
            onClick={() => updateStrip({ borderColor: null, backgroundColor: null, caption: null })}
          >
            Reset
          </button>
        </div>

        <div className="gallery-strip">
          {stripPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="strip-preview-img"
              src={stripPreview}
              alt={`Pratinjau strip foto, tema ${activeTheme.label}`}
            />
          )}
          {galleryCount === 0 && (
            <div className="gallery-empty">
              Ini pratinjau tema.
              <br />
              Puzzle yang selesai akan mengisi strip.
            </div>
          )}
        </div>

        <div className="gallery-actions">
          <button
            type="button"
            className="gallery-action-btn"
            disabled={!downloadEnabled}
            onClick={handleDownloadStrip}
          >
            UNDUH GALERI
          </button>
          <button
            type="button"
            className="gallery-action-btn gallery-action-btn--danger"
            onClick={handleResetAll}
          >
            MULAI ULANG SEMUA
          </button>
        </div>
      </aside>

      {/* ================================================================
          Online Multiplayer Panel
      ================================================================ */}
      <aside id="online-panel" className={`online-panel${onlinePanelOpen ? " open" : ""}`}>
        <div className="online-panel-head">
          <span className="online-panel-title">Mode Online</span>
          <button
            type="button"
            className="online-panel-close"
            onClick={() => setOnlinePanelOpen(false)}
            aria-label="Tutup panel online"
          >
            ✕
          </button>
        </div>

        {/* Error banner */}
        {onlineError && (
          <div className="online-error">{onlineError}</div>
        )}

        {/* A: Pusher not configured */}
        {pusherUnconfigured && (
          <div className="online-config-warning">
            Pusher belum dikonfigurasi. Tambahkan env vars ke .env.local untuk mengaktifkan mode online.
          </div>
        )}

        {/* B: Pre-session view */}
        {!pusherUnconfigured && session === null && (
          <div className="online-panel-section">
            <label className="online-field-label">
              Nama tampilan
              <input
                type="text"
                className="online-name-input"
                value={displayName}
                placeholder="Nama tampilan"
                maxLength={32}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>

            <button
              type="button"
              className="online-btn"
              onClick={() => void createSession()}
            >
              BUAT SESI
            </button>

            <div className="online-separator">— atau —</div>

            <input
              type="text"
              className="online-token-input"
              value={joinTokenInput}
              placeholder="Masukkan token 6 karakter"
              maxLength={6}
              onChange={(e) => setJoinTokenInput(e.target.value.toUpperCase())}
            />

            <button
              type="button"
              className="online-btn"
              disabled={joinTokenInput.trim().length < 6}
              onClick={() => void joinSession(joinTokenInput.trim().toUpperCase())}
            >
              GABUNG
            </button>
          </div>
        )}

        {/* C: Active session view */}
        {session !== null && session.status !== "done" && (
          <div className="online-panel-section">
            <div className="online-token-label">TOKEN SESI</div>
            <div className="online-token-row">
              <span className="online-token-display">{session.token}</span>
              <button
                type="button"
                className="online-token-copy-btn"
                onClick={() => void navigator.clipboard.writeText(session.token)}
                title="Salin token"
              >
                Salin
              </button>
            </div>

            <div className="online-members-label">
              {session.members.length} / 6 peserta
            </div>
            <div className="online-members-chips">
              {session.members.map((m) => (
                <span key={m.id} className="member-chip">{m.name}</span>
              ))}
            </div>

            <canvas ref={miniPreviewRef} className="mini-preview" />

            {session.members
              .filter((m) => m.id !== myId)
              .map((m) => (
                <div key={m.id} className="participant-placeholder">
                  {m.name}
                </div>
              ))}

            {session.isHost && (
              <button
                type="button"
                className="online-btn"
                disabled={session.status !== "idle" || session.members.length < 1}
                onClick={() => void triggerCountdown()}
              >
                FOTO BERSAMA
              </button>
            )}

            {session.isHost && session.members.length === 0 && (
              <div className="online-status-text">Menunggu peserta…</div>
            )}

            {statusLabel !== "" && (
              <div className="online-status-text">{statusLabel}</div>
            )}

            <button
              type="button"
              className="online-btn online-btn--danger"
              onClick={leaveSession}
            >
              KELUAR SESI
            </button>
          </div>
        )}

        {/* E: Results view */}
        {session !== null && session.status === "done" && collageUrl && (
          <div className="online-panel-section">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={collageUrl}
              className="collage-result"
              alt="Foto Bersama"
            />

            <button
              type="button"
              className="online-btn"
              onClick={handleDownloadCollage}
            >
              UNDUH FOTO
            </button>

            <button
              type="button"
              className="online-btn"
              onClick={resetCollage}
            >
              FOTO LAGI
            </button>

            <button
              type="button"
              className="online-btn online-btn--danger"
              onClick={leaveSession}
            >
              KELUAR SESI
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
