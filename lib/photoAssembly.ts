import type { AssemblyOptions } from './types';

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export async function assemblePhotos(
  photos: { memberId: string; name: string; imageData: string }[],
  options: AssemblyOptions = {}
): Promise<string> {
  if (photos.length === 0) {
    return Promise.reject(new Error('No photos to assemble'));
  }

  const cellWidth = options.cellWidth ?? 400;
  const cellHeight = options.cellHeight ?? 300;
  const gap = options.gap ?? 12;
  const labelHeight = options.labelHeight ?? 32;
  const background = options.background ?? '#120b1f';

  const n = photos.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  const totalW = cols * cellWidth + (cols + 1) * gap;
  const totalH = rows * (cellHeight + labelHeight) + (rows + 1) * gap;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // Fill background
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, totalW, totalH);

  // Draw each photo
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    const x = gap + col * (cellWidth + gap);
    const y = gap + row * (cellHeight + labelHeight + gap);

    const img = await loadImage(photo.imageData);
    ctx.drawImage(img, x, y, cellWidth, cellHeight);

    // Member name label
    ctx.fillStyle = '#ece7f5';
    ctx.font = '13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      photo.name,
      x + cellWidth / 2,
      y + cellHeight + labelHeight / 2,
      cellWidth
    );
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}
