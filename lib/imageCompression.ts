type CompressionResult = { dataUrl: string; bytes: number; width: number; height: number };

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 350_000;
const MAX_DIMENSION = 1_400;

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("The selected image could not be read."));
  reader.onload = () => resolve(String(reader.result));
  reader.readAsDataURL(file);
});

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onerror = () => reject(new Error("The selected file is not a readable image."));
  image.onload = () => resolve(image);
  image.src = source;
});

const approximateBytes = (dataUrl: string) => Math.ceil((dataUrl.slice(dataUrl.indexOf(",") + 1).length * 3) / 4);

export async function compressImageForRealtimeDatabase(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<CompressionResult> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG, or WebP image.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("Choose an image no larger than 8 MB.");

  onProgress?.(15);
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the selected image.");
  context.drawImage(image, 0, 0, width, height);

  onProgress?.(45);
  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
    const dataUrl = canvas.toDataURL("image/webp", quality);
    const bytes = approximateBytes(dataUrl);
    if (bytes <= MAX_OUTPUT_BYTES) {
      onProgress?.(100);
      return { dataUrl, bytes, width, height };
    }
  }
  throw new Error("The image is still too large after compression. Choose a smaller image.");
}
