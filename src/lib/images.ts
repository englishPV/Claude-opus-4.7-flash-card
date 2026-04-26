export async function imageFileToDataUrl(file: File, maxSide = 1800, quality = 0.88): Promise<string> {
  const raw = await readAsDataUrl(file);
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return raw;

  const img = await loadImage(raw);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale >= 1 && raw.length < 1_500_000) return raw;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // JPEG réduit énormément les captures et schémas. Si le résultat est plus gros, on garde l'original.
  const compressed = canvas.toDataURL("image/jpeg", quality);
  return compressed.length < raw.length ? compressed : raw;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}