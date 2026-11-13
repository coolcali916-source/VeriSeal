export interface ProcessedStampResult {
  dataUrl: string;
  width: number;
  height: number;
  transparentPixelRatio: number;
}

/**
 * Loads an uploaded stamp image (PNG, JPG, WEBP, SVG) onto an offscreen canvas,
 * removes light/white paper background pixels with smooth anti-aliased feathering,
 * optionally normalizes ink color (original, navy, or black), and exports a
 * genuine alpha-transparent PNG data URL.
 */
export async function processNotaryStampToTransparentPng(
  fileOrDataUrl: File | string,
  options: {
    threshold?: number; // 150..250, default 215
    feather?: number; // 10..60, default 32
    inkMode?: 'original' | 'navy' | 'black';
  } = {}
): Promise<ProcessedStampResult> {
  const threshold = options.threshold ?? 215;
  const feather = options.feather ?? 32;
  const inkMode = options.inkMode ?? 'original';

  const srcUrl =
    typeof fileOrDataUrl === 'string'
      ? fileOrDataUrl
      : await fileToDataUrl(fileOrDataUrl);

  const img = await loadImage(srcUrl);

  const maxDim = 360;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize canvas 2D context for stamp processing.');
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let transparentCount = 0;
  const totalPixels = width * height;
  const lowerBound = Math.max(0, threshold - feather);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const origAlpha = data[i + 3];

    if (origAlpha === 0) {
      transparentCount += 1;
      continue;
    }

    // Perceived luminance
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    if (luminance >= threshold) {
      data[i + 3] = 0;
      transparentCount += 1;
    } else if (luminance > lowerBound) {
      const ratio = 1 - (luminance - lowerBound) / (threshold - lowerBound);
      const nextAlpha = Math.round(origAlpha * Math.max(0, Math.min(1, ratio)));
      data[i + 3] = nextAlpha;
      if (nextAlpha < 16) transparentCount += 1;
    }

    if (data[i + 3] > 0 && inkMode !== 'original') {
      if (inkMode === 'navy') {
        data[i] = 22;
        data[i + 1] = 45;
        data[i + 2] = 92;
      } else if (inkMode === 'black') {
        data[i] = 15;
        data[i + 1] = 23;
        data[i + 2] = 42;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Trim excess transparent padding if any, keeping 6px breathing margin
  const trimmedCanvas = trimTransparentCanvas(canvas, 6);
  const dataUrl = trimmedCanvas.toDataURL('image/png');

  return {
    dataUrl,
    width: trimmedCanvas.width,
    height: trimmedCanvas.height,
    transparentPixelRatio: totalPixels > 0 ? transparentCount / totalPixels : 0,
  };
}

function trimTransparentCanvas(
  source: HTMLCanvasElement,
  margin: number
): HTMLCanvasElement {
  const ctx = source.getContext('2d');
  if (!ctx) return source;
  const { width, height } = source;
  const pixels = ctx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha > 12) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return source;
  }

  const cropX = Math.max(0, minX - margin);
  const cropY = Math.max(0, minY - margin);
  const cropW = Math.min(width - cropX, maxX - minX + 1 + margin * 2);
  const cropH = Math.min(height - cropY, maxY - minY + 1 + margin * 2);

  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const outCtx = out.getContext('2d');
  if (!outCtx) return source;
  outCtx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return out;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read stamp image file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Invalid or unsupported stamp image format.'));
    img.src = src;
  });
}
