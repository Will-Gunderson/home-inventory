// Client-side image work: resize before upload, crop items out of a photo,
// and "make it saleable" (background removal + auto-brighten).

const MAX_UPLOAD = 1600;

function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    img.onload = () => {
      if (typeof src !== "string") URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Couldn't load image"));
    img.crossOrigin = "use-credentials";
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), type, quality),
  );
}

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  return [c, c.getContext("2d")!] as const;
}

/** Downscale a camera image to a JPEG no larger than 1600px on the long side. */
export async function prepareUpload(source: Blob | HTMLCanvasElement) {
  let w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  if (source instanceof HTMLCanvasElement) {
    w = source.width;
    h = source.height;
    draw = (ctx, cw, ch) => ctx.drawImage(source, 0, 0, cw, ch);
  } else {
    // createImageBitmap honours EXIF orientation from phone cameras.
    const bmp = await createImageBitmap(source, { imageOrientation: "from-image" });
    w = bmp.width;
    h = bmp.height;
    draw = (ctx, cw, ch) => ctx.drawImage(bmp, 0, 0, cw, ch);
  }
  const scale = Math.min(1, MAX_UPLOAD / Math.max(w, h));
  const [c, ctx] = canvasOf(w * scale, h * scale);
  draw(ctx, c.width, c.height);
  const blob = await toBlob(c, "image/jpeg", 0.85);
  return { blob, width: c.width, height: c.height };
}

/** Crop one item out of the full photo using the AI's bounding box (with padding). */
export async function cropToBox(photo: Blob, box: { x: number; y: number; w: number; h: number }): Promise<Blob | null> {
  // If the item fills most of the frame, the original photo is already a good item photo.
  if (box.w * box.h > 0.7) return null;
  const img = await loadImage(photo);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const padX = box.w * 0.12 + 0.02;
  const padY = box.h * 0.12 + 0.02;
  const x0 = Math.max(0, box.x - padX) * W;
  const y0 = Math.max(0, box.y - padY) * H;
  const x1 = Math.min(1, box.x + box.w + padX) * W;
  const y1 = Math.min(1, box.y + box.h + padY) * H;
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 64 || ch < 64) return null;
  const [c, ctx] = canvasOf(cw, ch);
  ctx.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);
  return toBlob(c);
}

/** Stretch levels per channel (1st-99th percentile) and lift shadows a touch. */
function autoLevels(ctx: CanvasRenderingContext2D, w: number, h: number, mask?: Uint8ClampedArray) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (mask && mask[i + 3] < 128) continue;
    hist[0][px[i]]++;
    hist[1][px[i + 1]]++;
    hist[2][px[i + 2]]++;
    n++;
  }
  if (!n) return;
  const bounds = hist.map((hst) => {
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hst[v]) > n * 0.01) { lo = v; break; }
    acc = 0;
    for (let v = 255; v >= 0; v--) if ((acc += hst[v]) > n * 0.01) { hi = v; break; }
    // Don't over-stretch already well-exposed or low-contrast subjects.
    return [Math.min(lo, 40), Math.max(hi, 200)];
  });
  const lut = bounds.map(([lo, hi]) => {
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const s = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      t[v] = Math.round(255 * Math.pow(s, 0.9)); // gamma < 1 brightens midtones
    }
    return t;
  });
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[0][px[i]];
    px[i + 1] = lut[1][px[i + 1]];
    px[i + 2] = lut[2][px[i + 2]];
  }
  ctx.putImageData(data, 0, 0);
}

export type EnhanceMode = "white" | "brighten";

/**
 * "white": remove the background and place the item centered on clean white, square.
 * "brighten": keep the scene, just fix exposure and color.
 */
export async function enhance(src: string, mode: EnhanceMode, onProgress?: (msg: string) => void): Promise<Blob> {
  const res = await fetch(src, { credentials: "same-origin" });
  const original = await res.blob();

  if (mode === "brighten") {
    const img = await loadImage(original);
    const [c, ctx] = canvasOf(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, 0, 0);
    autoLevels(ctx, c.width, c.height);
    return toBlob(c, "image/jpeg", 0.9);
  }

  onProgress?.("Loading background remover…");
  const { removeBackground } = await import("@imgly/background-removal");
  const cutout = await removeBackground(original, {
    model: "isnet_fp16",
    output: { format: "image/png" },
    progress: (key, cur, total) => {
      if (key.startsWith("fetch")) onProgress?.(`Downloading model… ${Math.round((cur / total) * 100)}%`);
      else onProgress?.("Removing background…");
    },
  });
  const img = await loadImage(cutout);
  const [fc, fctx] = canvasOf(img.naturalWidth, img.naturalHeight);
  fctx.drawImage(img, 0, 0);
  const alpha = fctx.getImageData(0, 0, fc.width, fc.height).data;

  // Find the subject's bounds from the alpha mask.
  let minX = fc.width, minY = fc.height, maxX = 0, maxY = 0;
  for (let y = 0; y < fc.height; y++) {
    for (let x = 0; x < fc.width; x++) {
      if (alpha[(y * fc.width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) throw new Error("Couldn't find the item in this photo");
  autoLevels(fctx, fc.width, fc.height, alpha);

  const sw = maxX - minX + 1;
  const sh = maxY - minY + 1;
  const size = Math.min(1600, Math.max(sw, sh) * 1.25);
  const scale = (size * 0.8) / Math.max(sw, sh);
  const [out, ctx] = canvasOf(size, size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  // Soft contact shadow so the item doesn't look pasted on.
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.filter = `blur(${Math.round(size * 0.02)}px)`;
  ctx.beginPath();
  ctx.ellipse(size / 2, dy + dh, dw * 0.42, size * 0.025, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.drawImage(fc, minX, minY, sw, sh, dx, dy, dw, dh);
  return toBlob(out, "image/jpeg", 0.92);
}

/** Fetch item images as Files so they can be shared to the Facebook / eBay / Depop apps. */
export async function imagesAsFiles(urls: string[]): Promise<File[]> {
  const files = await Promise.all(
    urls.map(async (u, i) => {
      const b = await (await fetch(u, { credentials: "same-origin" })).blob();
      const ext = b.type.includes("png") ? "png" : "jpg";
      return new File([b], `item-${i + 1}.${ext}`, { type: b.type || "image/jpeg" });
    }),
  );
  return files;
}
