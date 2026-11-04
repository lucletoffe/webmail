import { describe, it, expect, vi } from 'vitest';
import { inlineDataImages } from '../inline-data-images';

// A 1×1 PNG and a 1×1 GIF.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const PNG_DATA = `data:image/png;base64,${PNG}`;
const GIF_DATA = `data:image/gif;base64,${GIF}`;

function uploader() {
  let n = 0;
  return vi.fn(async (_file: File, _src: string) => ({ cid: `img${++n}@webmail` }));
}

const images = (html: string) => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img'));

describe('inlineDataImages', () => {
  it('sends a data: image as a cid: part', async () => {
    const upload = uploader();
    const out = await inlineDataImages(`<p>Regards</p><img src="${PNG_DATA}" alt="ACME" width="120">`, upload);

    expect(upload).toHaveBeenCalledTimes(1);
    const [file, src] = upload.mock.calls[0];
    expect(file).toMatchObject({ name: 'image-1.png', type: 'image/png' });
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0)));
    expect(src).toBe(PNG_DATA);
    expect(out.cids).toEqual(['img1@webmail']);
    const [img] = images(out.html);
    expect(img.getAttribute('src')).toBe('cid:img1@webmail');
    expect(img.getAttribute('alt')).toBe('ACME');
    expect(img.getAttribute('width')).toBe('120');
    expect(out.html).not.toContain('data:image');
  });

  it('sends an image shown twice as one part', async () => {
    const upload = uploader();
    const out = await inlineDataImages(`<img src="${PNG_DATA}"><p>and again</p><img src="${PNG_DATA}">`, upload);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(out.cids).toEqual(['img1@webmail']);
    expect(images(out.html).map((img) => img.getAttribute('src'))).toEqual(['cid:img1@webmail', 'cid:img1@webmail']);
  });

  it('sends two different images as two parts', async () => {
    const upload = uploader();
    const out = await inlineDataImages(`<img src="${PNG_DATA}"><img src="${GIF_DATA}">`, upload);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map(([file]) => file.type)).toEqual(['image/png', 'image/gif']);
    expect(out.cids).toEqual(['img1@webmail', 'img2@webmail']);
  });

  it('drops a cid the image was tagged with before', async () => {
    const out = await inlineDataImages(`<img src="${PNG_DATA}" data-cid="stale@webmail">`, uploader());

    const [img] = images(out.html);
    expect(img.getAttribute('src')).toBe('cid:img1@webmail');
    expect(img.hasAttribute('data-cid')).toBe(false);
  });

  it.each([
    ['an SVG', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['a URL-encoded image', 'data:image/png,%89PNG'],
    ['a data: document', 'data:text/html;base64,PGI+aGk8L2I+'],
    ['a remote image', 'https://example.com/logo.png'],
    ['a cid: image', 'cid:logo@example.com'],
  ])('leaves %s alone', async (_label, src) => {
    const upload = uploader();
    const html = `<p>Hi</p><img src="${src}">`;

    expect(await inlineDataImages(html, upload)).toEqual({ html, cids: [] });
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns a body without data: images untouched', async () => {
    const upload = uploader();
    const html = '<div style="font-family:Arial"><p>No images here, only data:image/png in the text</p></div>';

    expect(await inlineDataImages(html, upload)).toEqual({ html, cids: [] });
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps an image whose upload did not happen as it is', async () => {
    const html = `<img src="${PNG_DATA}"><img src="${GIF_DATA}">`;
    const upload = vi.fn(async (file: File) => (file.type === 'image/gif' ? { cid: 'gif@webmail' } : null));

    const out = await inlineDataImages(html, upload);

    expect(out.cids).toEqual(['gif@webmail']);
    expect(images(out.html).map((img) => img.getAttribute('src'))).toEqual([PNG_DATA, 'cid:gif@webmail']);
  });

  it('returns the body untouched when no upload happened', async () => {
    const html = `<img src="${PNG_DATA}">`;

    expect(await inlineDataImages(html, async () => null)).toEqual({ html, cids: [] });
  });
});
