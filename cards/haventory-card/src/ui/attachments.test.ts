import { html, render } from 'lit';
import { renderDocumentRow, renderLightboxHost, renderPhotoFigure } from './attachments';
import type { DocumentRowStyle, PhotoFigureStyle } from './attachments';

/** The editor's strip: 72px tiles, its own placeholder box, controls on top. */
const EDITOR_PHOTO: PhotoFigureStyle = {
  testid: 'editor-photo',
  glyph: 20,
  tileClass: 'placeholder',
  openClass: 'open',
  pendingTile: true,
};

/** The sheet's strip: bigger tiles, nothing to hang on them, nothing to manage. */
const SHEET_PHOTO: PhotoFigureStyle = { testid: 'sheet-photo', glyph: 24 };

const EDITOR_DOC: DocumentRowStyle = {
  testid: 'editor-document',
  glyph: 18,
  openLabel: 'Open Manual',
  openTitle: 'Open',
};
const SHEET_DOC: DocumentRowStyle = { testid: 'sheet-document', glyph: 20, openText: 'Open' };

function draw(content: unknown) {
  const box = document.createElement('div');
  render(html`${content}`, box);
  document.body.append(box);
  return box;
}

const q = (box: HTMLElement, testid: string) =>
  box.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

const photo = (patch: Record<string, unknown> = {}) => ({
  src: '/media/1?sig=x',
  missing: false,
  alt: 'Photo 1 of 2 of Drill',
  openLabel: 'View photo 1 of 2 of Drill',
  onOpen: () => undefined,
  ...patch,
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderPhotoFigure', () => {
  it('opens the lightbox from the tile it drew', () => {
    const opened: true[] = [];
    const box = draw(renderPhotoFigure(photo({ onOpen: () => opened.push(true) }), EDITOR_PHOTO));
    const open = q(box, 'editor-photo-open') as HTMLButtonElement;
    expect(open.className).toBe('open');
    expect(open.getAttribute('aria-label')).toBe('View photo 1 of 2 of Drill');
    const img = open.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/media/1?sig=x');
    expect(img.getAttribute('alt')).toBe('Photo 1 of 2 of Drill');
    expect(img.getAttribute('loading')).toBe('lazy');
    open.click();
    expect(opened).toEqual([true]);
  });

  // An export carries the references and not the bytes, so both surfaces have
  // to answer a reference the backend cannot resolve — and answer it the same.
  it('marks a picture whose file the backend does not have, on either surface', () => {
    for (const style of [EDITOR_PHOTO, SHEET_PHOTO]) {
      const box = draw(renderPhotoFigure(photo({ src: null, missing: true }), style));
      const tile = q(box, `${style.testid}-missing`);
      expect(tile, style.testid).toBeTruthy();
      expect(tile?.textContent, style.testid).toContain('File missing');
      expect(tile?.querySelector('.hv-chip.warning'), style.testid).toBeTruthy();
      expect(tile?.classList.contains('missing'), style.testid).toBe(true);
      // Never an <img>: a src is what draws the browser's broken-image glyph.
      expect(box.querySelector('img'), style.testid).toBe(null);
      expect(q(box, `${style.testid}-open`), style.testid).toBe(null);
      document.body.innerHTML = '';
    }
  });

  it('keeps each strip own dressing on the missing tile', () => {
    const box = draw(renderPhotoFigure(photo({ src: null, missing: true }), EDITOR_PHOTO));
    expect(q(box, 'editor-photo-missing')?.className).toBe('placeholder missing');
    const sheet = draw(renderPhotoFigure(photo({ src: null, missing: true }), SHEET_PHOTO));
    expect(q(sheet, 'sheet-photo-missing')?.className).toBe('missing');
  });

  // Signing can fail or still be running. The editor holds the tile's place in
  // a grid it is also a picker for; the sheet's strip simply has one photo less.
  it('holds the place for an unsigned picture only where the surface asked', () => {
    const box = draw(renderPhotoFigure(photo({ src: null }), EDITOR_PHOTO));
    expect(q(box, 'editor-photo-placeholder')?.className).toBe('placeholder');
    expect(box.querySelector('img')).toBe(null);
    expect(renderPhotoFigure(photo({ src: null }), SHEET_PHOTO)).toBe(null);
  });

  it('hangs the surface controls on the figure, missing or not', () => {
    const extra = html`<button data-testid="editor-photo-remove">x</button>`;
    for (const patch of [{}, { src: null, missing: true }]) {
      const box = draw(renderPhotoFigure(photo(patch), EDITOR_PHOTO, extra));
      expect(q(box, 'editor-photo-remove')).toBeTruthy();
      expect(q(box, 'editor-photo')?.querySelector('[data-testid="editor-photo-remove"]')).toBeTruthy();
      document.body.innerHTML = '';
    }
  });
});

describe('renderDocumentRow', () => {
  const body = html`<span class="doc-text">Manual</span>`;

  // An anchor to the signed URL, not a button that fetches one: the URL has to
  // be on the element before the tap or a popup blocker eats the new tab.
  it('links straight to the signed file', () => {
    const box = draw(renderDocumentRow({ src: '/media/d?sig=x', missing: false }, SHEET_DOC, body));
    const link = q(box, 'sheet-document-open') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/media/d?sig=x');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('Open');
  });

  it('names the link where the row has no words for it', () => {
    const box = draw(renderDocumentRow({ src: '/media/d?sig=x', missing: false }, EDITOR_DOC, body));
    const link = q(box, 'editor-document-open') as HTMLAnchorElement;
    expect(link.getAttribute('aria-label')).toBe('Open Manual');
    expect(link.getAttribute('title')).toBe('Open');
    expect(link.textContent?.trim()).toBe('');
  });

  it('marks a document whose file the backend does not have, on either surface', () => {
    for (const style of [EDITOR_DOC, SHEET_DOC]) {
      const box = draw(renderDocumentRow({ src: '/media/d?sig=x', missing: true }, style, body));
      expect(q(box, `${style.testid}-missing`)?.textContent, style.testid).toContain('File missing');
      expect(q(box, `${style.testid}-open`), style.testid).toBe(null);
      expect(q(box, style.testid)?.classList.contains('missing'), style.testid).toBe(true);
      document.body.innerHTML = '';
    }
  });

  it('offers nothing at all while the URL is unsigned', () => {
    const box = draw(renderDocumentRow({ src: null, missing: false }, SHEET_DOC, body));
    expect(q(box, 'sheet-document-open')).toBe(null);
    expect(q(box, 'sheet-document-missing')).toBe(null);
    expect(q(box, 'sheet-document')?.textContent).toContain('Manual');
  });

  it('hangs the surface controls on the end of the row', () => {
    const tail = html`<button data-testid="editor-document-remove">x</button>`;
    const box = draw(renderDocumentRow({ src: null, missing: false }, EDITOR_DOC, body, tail));
    expect(q(box, 'editor-document')?.lastElementChild?.getAttribute('data-testid')).toBe(
      'editor-document-remove',
    );
  });
});

describe('renderLightboxHost', () => {
  // A host listening to the surface for "the user is done" must not read a
  // photo being shut as the surface being shut.
  it('closes without telling the host of the surface around it', () => {
    const closed: true[] = [];
    const outer: Event[] = [];
    const box = draw(
      renderLightboxHost({
        testid: 'sheet-lightbox-host',
        item: null,
        media: null,
        index: 2,
        onOpenerGone: () => undefined,
        onClose: () => closed.push(true),
      }),
    );
    box.addEventListener('close', (e) => outer.push(e));
    const lightbox = q(box, 'sheet-lightbox-host') as HTMLElement;
    lightbox.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    expect(closed).toEqual([true]);
    expect(outer).toEqual([]);
  });

  it('opens at the picture the surface named', () => {
    const box = draw(
      renderLightboxHost({
        testid: 'editor-lightbox-host',
        item: null,
        media: null,
        index: 3,
        onOpenerGone: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect((q(box, 'editor-lightbox-host') as unknown as { index: number }).index).toBe(3);
  });
});
