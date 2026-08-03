const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 0.85;

export interface ProcessedImage {
  blob: Blob;
  sha256: string;
  width: number;
  height: number;
}

function fitWithinMaxDimension(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const scale = w > h ? max / w : max / h;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** canvas.toBlobはWebP非対応ブラウザではPNGにフォールバックすることがあるため、typeを確認しJPEGへ再変換する */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function computeSha256(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * アップロード前にクライアント側で長辺1600px・WebPへ変換する（要件定義3.6）。
 * iOSのHEIC出力もcreateImageBitmapでデコードされるため、この変換で解消される。
 */
export async function processImageFile(file: File | Blob): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithinMaxDimension(bitmap.width, bitmap.height, MAX_DIMENSION);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d contextを取得できませんでした');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
  if (!blob || blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg', WEBP_QUALITY);
  }
  if (!blob) throw new Error('画像の変換に失敗しました');

  const sha256 = await computeSha256(blob);
  return { blob, sha256, width, height };
}
