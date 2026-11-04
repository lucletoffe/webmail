/**
 * Images an HTML body shows as data: URIs. Gmail and Outlook don't show
 * them, so they go out as cid: parts instead: each distinct image is handed
 * to `upload` - the composer's pasted-image upload - once, and the image
 * refers to the cid it returns (#1490).
 *
 * Only base64 raster images qualify; an SVG can carry script, so it is never
 * turned into a part a recipient's client would render.
 */

const DATA_IMAGE = /^data:(image\/(?:png|jpe?g|gif|webp|bmp|avif));base64,([a-z0-9+/=\s]+)$/i;

/** Resolves null when the image was not uploaded; it is then left as it is. */
export type DataImageUpload = (file: File, src: string) => Promise<{ cid: string } | null>;

function dataImageFile(src: string, name: string): File | null {
  const match = DATA_IMAGE.exec(src);
  if (!match) return null;
  try {
    const binary = atob(match[2].replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const type = match[1].toLowerCase();
    return new File([bytes], `${name}.${type.slice('image/'.length).replace('jpeg', 'jpg')}`, { type });
  } catch {
    return null;
  }
}

/**
 * Uploads the data: images of `html` and lets `place` point each image at
 * its cid. Returns the body (unchanged when no image was placed) and the
 * cids it now refers to.
 */
export async function embedDataImages(
  html: string,
  upload: DataImageUpload,
  place: (img: Element, cid: string) => void,
): Promise<{ html: string; cids: string[] }> {
  if (!/<img\b[^>]*\bsrc\s*=\s*["']?\s*data:image\//i.test(html)) return { html, cids: [] };
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const images = Array.from(doc.querySelectorAll('img[src]'))
    .map((img) => ({ img, src: img.getAttribute('src')!.trim() }))
    .filter(({ src }) => DATA_IMAGE.test(src));
  if (images.length === 0) return { html, cids: [] };
  // The same image shown twice goes out as one part.
  const sources = Array.from(new Set(images.map(({ src }) => src)));
  const cids = new Map(await Promise.all(sources.map(async (src, i) => {
    const file = dataImageFile(src, `image-${i + 1}`);
    return [src, file ? (await upload(file, src))?.cid : undefined] as const;
  })));
  const placed = new Set<string>();
  for (const { img, src } of images) {
    const cid = cids.get(src);
    if (!cid) continue;
    place(img, cid);
    placed.add(cid);
  }
  return placed.size > 0 ? { html: doc.body.innerHTML, cids: Array.from(placed) } : { html, cids: [] };
}

/**
 * The outgoing HTML with its data: images replaced by cid: references, and
 * the cids it now refers to; the caller sends a part for each. Run on the
 * message as it goes, so what was added after the editor (the signature, the
 * organisation's signature, a plugin's footer) goes out as parts too.
 */
export function inlineDataImages(html: string, upload: DataImageUpload): Promise<{ html: string; cids: string[] }> {
  return embedDataImages(html, upload, (img, cid) => {
    img.setAttribute('src', `cid:${cid}`);
    img.removeAttribute('data-cid');
  });
}
