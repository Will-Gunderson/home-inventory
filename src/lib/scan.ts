// Multi-page document scanning: clean up each page photo, then combine them into one PDF.

const MAX_SIDE = 2000;

export interface ScannedPage {
  blob: Blob; // JPEG
  width: number;
  height: number;
  url: string; // object URL for the thumbnail
}

/** Downscale and stretch contrast so paper looks white and text dark (auto levels). */
export async function cleanPage(file: Blob): Promise<ScannedPage> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  // Auto levels per color channel: the darkest 2% becomes black and the paper (most of the page,
  // so ~90th percentile) becomes white. Doing it per channel also removes yellow/blue light casts.
  const n = d.length / 4;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) hist[j][d[i + j]]++;
  const pct = (h: Uint32Array, p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += h[v]) >= n * p) return v;
    return 255;
  };
  const lo = hist.map((h) => pct(h, 0.02));
  const k = hist.map((h, j) => 255 / (Math.max(lo[j] + 40, pct(h, 0.9)) - lo[j]));
  for (let i = 0; i < d.length; i += 4) {
    for (let j = 0; j < 3; j++) d[i + j] = Math.max(0, Math.min(255, (d[i + j] - lo[j]) * k[j]));
  }
  g.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process page"))), "image/jpeg", 0.82));
  return { blob, width: w, height: h, url: URL.createObjectURL(blob) };
}

/** Build a PDF with one JPEG per page (no library needed: JPEGs embed directly with DCTDecode). */
export async function pagesToPdf(pages: ScannedPage[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === "string" ? enc.encode(b) : b;
    parts.push(u);
    pos += u.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // Objects: 1 catalog, 2 pages, then 3 per page (page, image, content).
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const [pageId, imgId, contentId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    const W = 612; // US Letter width in points; height follows the photo's shape
    const H = Math.round((W * p.height) / p.width);
    const jpeg = new Uint8Array(await p.blob.arrayBuffer());
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(pageId, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`),
    );
    obj(imgId, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      push(jpeg);
      push("\nendstream");
    });
    obj(contentId, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  }
  const count = 3 + pages.length * 3;
  const xref = pos;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}
