const MAX_DIMENSION = 1600;
const THUMBNAIL_MAX_DIMENSION = 320;
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

async function resizeToWebp(file: File | Blob, maxDimension: number): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithinMaxDimension(bitmap.width, bitmap.height, maxDimension);

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

/**
 * アップロード前にクライアント側で長辺1600px・WebPへ変換する（要件定義3.6）。
 * iOSのHEIC出力もcreateImageBitmapでデコードされるため、この変換で解消される。
 */
export function processImageFile(file: File | Blob): Promise<ProcessedImage> {
  return resizeToWebp(file, MAX_DIMENSION);
}

/**
 * 一覧のサムネイル表示専用の低解像度版（長辺320px）を追加生成する（改修5回目・
 * 改修4回目ブレインストーム案F「添付画像の複数解像度生成」）。AttachmentList等の
 * 小さいグリッド表示で、本体の1600px画像を毎回フルサイズで読み込まずに済むようにする
 */
export function processThumbnail(file: File | Blob): Promise<ProcessedImage> {
  return resizeToWebp(file, THUMBNAIL_MAX_DIMENSION);
}
