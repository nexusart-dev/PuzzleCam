# PuzzleCam - Nexus.Art

PuzzleCam - Nexus.Art adalah aplikasi web interaktif berbasis kamera yang menggabungkan teknologi deteksi tangan dan permainan puzzle foto. Pengguna dapat menangkap area foto dengan gerakan tangan, lalu menyusun potongan puzzle secara langsung di layar dengan gesture pinch dan drag.

Aplikasi ini dibuat sebagai pengalaman photo booth yang unik dan lebih interaktif dibandingkan kamera biasa, dengan gaya visual yang modern dan tampilan dashboard galeri singkat untuk menyimpan hasil foto.

## Fitur utama

- Deteksi tangan real-time menggunakan MediaPipe Hand Landmarker
- Capture foto dari dua tangan yang membentuk frame secara otomatis
- Efek photobooth pada hasil foto yang diambil
- Puzzle foto 3x3 yang bisa disusun secara manual
- Interaksi drag dan snap menggunakan jari yang mencubit (pinch gesture)
- Reset puzzle dan reset seluruh galeri
- Simpan hasil foto ke dalam strip galeri hingga maksimal 3 foto
- Unduh strip foto dalam format PNG
- Mode siap pakai untuk browser modern dengan izin kamera

## Teknologi yang digunakan

- HTML5
- CSS3
- JavaScript (ES Modules)
- MediaPipe Tasks Vision
- Web Camera API (getUserMedia)
- Canvas API untuk rendering dan efek visual

## Persyaratan

- Browser modern seperti Chrome, Edge, atau Brave
- Kamera terhubung dan izin kamera diberikan
- Koneksi internet untuk memuat model MediaPipe dan CDN yang dipakai
- Jalankan project melalui server lokal agar kamera dan modul browser bekerja dengan benar

## Cara menjalankan

1. Buka terminal di folder project.
2. Jalankan menggunakan ekstensi Live Server:

   ```bash
   Jalankan pada index.html
   ```

3. Buka browser dan akses:

   ```text
   http://localhost:5500
   ```

> Disarankan untuk tidak membuka file HTML langsung dari filesystem karena beberapa fitur seperti kamera dan modul browser bekerja lebih stabil saat dijalankan dari server lokal.

## Cara menggunakan aplikasi

1. Izinkan browser untuk mengakses kamera.
2. Tampilkan dua tangan di depan kamera.
3. Ciptakan frame tangkapan dengan posisi jari telunjuk yang saling menjauh dan kemudian melakukan pinch pada kedua tangan.
4. Tunggu countdown untuk mengambil foto.
5. Setelah foto berubah menjadi puzzle, susun kepingan dengan gerakan cubit dan seret.
6. Jika puzzle sudah benar, kepalkan tangan untuk menyimpan hasil ke galeri.
7. Gunakan tombol unduh galeri untuk menyimpan strip hasil foto.
8. Jika perlu, gunakan tombol reset untuk memulai ulang semua proses.

## Struktur project

```text
PuzzleCam-Nexus.art/
├── app.js
├── index.html
├── Readme.md
├── css/
│   └── styles.css
└── .gitignore (jika ada)
```

## Catatan penting

- Aplikasi ini bergantung pada model HandLandmarker dari Google MediaPipe yang dimuat dari CDN.
- Karena memakai kamera dan model AI dari internet, koneksi internet yang stabil sangat disarankan.
- Jika kamera tidak muncul, pastikan browser memiliki izin kamera aktif dan tidak ada konflik dengan aplikasi lain yang memakai kamera.

## Lisensi

Proyek ini dibuat untuk kebutuhan demo interaktif dan dapat dimodifikasi sesuai kebutuhan pengembangan lebih lanjut.

## Kontribusi

Jika Anda ingin mengembangkan project ini lebih lanjut, Anda dapat menambahkan fitur seperti:

- mode multi-puzzle
- custom background dan filter
- animasi hasil penyelesaian yang lebih kaya
- dukungan penyimpanan hasil ke cloud atau lokal
- versi mobile-first dengan kontrol yang lebih responsif

---

PuzzleCam - Nexus.Art dibuat untuk pengalaman foto kreatif berbasis gesture interaction yang menyenangkan dan eksperimental.
