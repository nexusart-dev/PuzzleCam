# PuzzleCam — Next.js + TypeScript

Port dari PuzzleCam (vanilla JS + MediaPipe HandLandmarker) ke Next.js 14 (App Router) + TypeScript.

## Menjalankan

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`. Perlu HTTPS/localhost untuk izin kamera browser (localhost otomatis dianggap "secure origin").

Build produksi:

```bash
npm run build
npm run start
```

## Struktur

```
app/
  layout.tsx      # <html>/<body>, load font Inter & IBM Plex Mono via next/font
  page.tsx         # dynamic import PuzzleCam dengan ssr:false (webcam butuh browser)
  globals.css      # port dari styles.css lama
components/
  PuzzleCam.tsx    # "use client" — JSX + React state (status, gallery, loading, progress)
lib/
  puzzleCamEngine.ts # port app.js jadi class: render loop, deteksi tangan, logika puzzle
  types.ts         # tipe bersama (PuzzlePiece, BoardBox, EngineCallbacks, dst.)
```

## Apa yang berubah dari versi asli

- **Struktur project**: HTML/CSS/JS statis → Next.js App Router dengan TypeScript penuh.
- **Canvas & webcam tetap imperatif** (`lib/puzzleCamEngine.ts`) — ini pola yang benar untuk
  render loop `requestAnimationFrame` + `<canvas>`, tidak dipaksakan jadi state React per-frame.
- **UI (status teks, dot warna, loading overlay, progress badge, galeri) sekarang React state**,
  bukan `document.getElementById(...).textContent = ...` seperti sebelumnya. Engine memanggil
  callback (`EngineCallbacks`) untuk melaporkan perubahan, komponen yang render JSX-nya.
- **Galeri**: sebelumnya engine menyisipkan elemen `<canvas>` langsung ke DOM; sekarang engine
  mengonversi thumbnail ke `dataURL` dan React yang me-render `<img>` lewat `.map()`.
- **Cleanup**: `engine.destroy()` dipanggil di `useEffect` cleanup — stop track webcam, cancel
  `requestAnimationFrame`, dan `removeEventListener('resize', ...)`, supaya tidak leak saat
  komponen unmount (mis. saat navigasi client-side di Next.js).
- **SSR-safety**: komponen di-load lewat `next/dynamic(..., { ssr: false })` karena `getUserMedia`
  dan `<canvas>` tidak ada di server.
- **Font**: dimuat lewat `next/font/google` (self-hosted otomatis oleh Next.js, tanpa request ke
  Google Fonts saat runtime) alih-alih `<link>` CDN.
- **MediaPipe**: `@mediapipe/tasks-vision` diimpor sebagai dependency npm (dengan tipe TS resmi)
  alih-alih lewat `<script type="module">` dari CDN jsdelivr. File WASM & model `.task` tetap
  diambil dari CDN/`storage.googleapis.com` saat runtime seperti sebelumnya.

## Catatan deploy

- Pastikan domain produksi pakai **HTTPS** (wajib untuk `getUserMedia`).
- Jika mau self-host model/wasm MediaPipe (bukan lewat CDN publik), unduh asetnya dan taruh di
  `public/`, lalu ganti `modelAssetPath` dan base path `FilesetResolver.forVisionTasks(...)` di
  `lib/puzzleCamEngine.ts`.
