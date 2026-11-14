import './hv-editor-attachments';
import {
  all,
  defined,
  makeAttachment,
  makeItem,
  makeManual,
  makeMediaBindings,
  mountComponent,
  q,
  settle,
  stubViewport,
} from '../test.utils';
import { MEDIA_NAME_TOKEN_PARAM, MEDIA_SIZE_PARAM, attachmentNameToken } from '../ui/media';
import type { HVEditorAttachments } from './hv-editor-attachments';
import type { Item } from '../store/types';

async function mount(item: Item | null, props: Partial<HVEditorAttachments> = {}) {
  const { el } = await mountComponent<HVEditorAttachments>('hv-editor-attachments', { item, ...props });
  return el;
}

/** The dialog behind a testid, awaited so its own render has run. */
async function dialog(el: HVEditorAttachments, testid: string) {
  const found = q(el, `[data-testid="${testid}"]`) as HTMLElement & {
    updateComplete: Promise<unknown>;
    open: boolean;
  };
  await found.updateComplete;
  return found;
}

/** Press a remove control and answer the guard it opens. */
async function removeAttachment(el: HVEditorAttachments, testid: string, answer: 'confirm' | 'cancel') {
  (q(el, `[data-testid="${testid}"]`) as HTMLButtonElement).click();
  await el.updateComplete;
  const guard = await dialog(el, 'editor-remove-confirm');
  (
    guard.shadowRoot?.querySelector(
      answer === 'confirm' ? '[data-testid="confirm-accept"]' : '[data-testid="confirm-cancel"]',
    ) as HTMLButtonElement
  ).click();
  await el.updateComplete;
}

describe('hv-editor-attachments: pictures', () => {
  /** Drive the hidden file input the way a picker does. */
  function pick(el: HVEditorAttachments, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  /** The same, through the camera tile a phone gets. */
  function pickCamera(el: HVEditorAttachments, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-camera-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const png = (name = 'photo.png') => new File(['x'], name, { type: 'image/png' });

  const CONFIG = {
    picture_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    max_pictures_per_item: 2,
    max_attachment_bytes: 16,
  };

  it('shows no pictures section while creating an item', async () => {
    // An attachment is filed against an item id, and a new item has none.
    const el = await mount(null, { media: makeMediaBindings() });

    expect(q(el, '[data-testid="editor-photos"]')).toBeNull();
  });

  it('renders each attached picture with a remove button', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', name: 'Drill', attachments: [makeAttachment({ id: 'att-1' })] }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(1);
    expect(q(el, '[data-testid="editor-photo-remove"]')?.getAttribute('aria-label')).toBe(
      'Remove Photo of Drill',
    );
  });

  // The tile is ~90px and the lightbox behind it is what shows the picture, so
  // the form asks the backend for the small form of every photo it lists.
  it('draws its picture tiles from the row-tile variant', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', name: 'Drill', attachments: [makeAttachment({ id: 'att-1' })] }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    await el.updateComplete;

    const img = el.shadowRoot?.querySelector('[data-testid="editor-photo"] img');
    expect(img?.getAttribute('src')).toContain(`${MEDIA_SIZE_PARAM}=thumb`);
  });

  it('uploads a picked file and adopts the version the backend came back with', async () => {
    const media = makeMediaBindings({
      upload: async (itemId) =>
        makeItem({ id: itemId, version: 7, attachments: [makeAttachment({ id: 'att-new' })] }),
    });
    const el = await mount(makeItem({ id: 'i-1', version: 3 }), { media });

    pick(el, [png()]);
    // A macrotask, so the whole prepare-then-send chain drains first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(1);
    expect(media.uploads[0]?.itemId).toBe('i-1');

    // The next save must carry the post-upload version, or the backend answers
    // `conflict` against a version the upload already moved past.
    expect(el.current?.version).toBe(7);
  });

  it('renders per-file error text and leaves the other files alone', async () => {
    let seen = 0;
    const media = makeMediaBindings({
      upload: async (itemId) => {
        seen += 1;
        if (seen === 1) throw new Error('That file is not an image.');
        return makeItem({ id: itemId, version: 5 });
      },
    });
    const el = await mount(makeItem({ id: 'i-1', version: 1 }), { media });

    pick(el, [png('bad.png'), png('good.png')]);
    // A macrotask, so the whole sequential queue drains before the assertion.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const entries = all(el, '[data-testid="editor-upload"]');
    // The failed one stays with its message; the one that succeeded is gone.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.dataset.state).toBe('error');
    expect(entries[0]?.textContent).toContain('bad.png');
    expect(entries[0]?.textContent).toContain('That file is not an image.');
    expect(media.uploads.map((u) => u.file.name)).toEqual(['bad.png', 'good.png']);
  });

  it('refuses an oversized file before it is sent', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [new File(['x'.repeat(64)], 'huge.png', { type: 'image/png' })]);
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('over the');
  });

  it('refuses a type the backend does not accept before it is sent', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [new File(['x'], 'drawing.svg', { type: 'image/svg+xml' })]);
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('not an accepted image');
  });

  it('refuses a file past the per-item cap before it is sent', async () => {
    const media = makeMediaBindings();
    const el = await mount(
      makeItem({
        id: 'i-1',
        attachments: [makeAttachment({ id: 'a' }), makeAttachment({ id: 'b' })],
      }),
      { media, mediaConfig: CONFIG },
    );

    pick(el, [png()]);
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('2 photos is the limit');
  });

  // Deleting an attachment destroys the only copy of the file, so it asks —
  // like every other destructive action on the card.
  it('removes a picture once the guard is answered, and adopts the returned item', async () => {
    const media = makeMediaBindings({
      remove: async (itemId) => makeItem({ id: itemId, version: 9, attachments: [] }),
    });
    const el = await mount(
      makeItem({ id: 'i-1', version: 4, attachments: [makeAttachment({ id: 'att-1' })] }),
      { media },
    );
    await el.updateComplete;

    (q(el, '[data-testid="editor-photo-remove"]') as HTMLButtonElement).click();
    await el.updateComplete;
    // Nothing is sent on the press itself.
    expect(media.removals).toEqual([]);
    expect((await dialog(el, 'editor-remove-confirm')).open).toBe(true);

    (
      (await dialog(el, 'editor-remove-confirm')).shadowRoot?.querySelector(
        '[data-testid="confirm-accept"]',
      ) as HTMLButtonElement
    ).click();
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(media.removals).toEqual([{ itemId: 'i-1', attachmentId: 'att-1' }]);
    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(0);
  });

  // The guard hands focus back to the control that raised it, and that control
  // is the removed tile's own remove button — gone by the time the strip
  // redraws. Focus lands on the document, out of the form and out of reach of
  // its Escape, unless the form catches it: this element says so, and the form
  // knows where focus belongs.
  it('catches the focus the removed tile took with it', async () => {
    const media = makeMediaBindings({
      remove: async (itemId) => makeItem({ id: itemId, version: 9, attachments: [] }),
    });
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }), { media });
    await el.updateComplete;
    let stranded = 0;
    el.addEventListener('focus-stranded', () => {
      stranded += 1;
    });
    // A press moves focus to the control pressed; jsdom's click does not.
    (q(el, '[data-testid="editor-photo-remove"]') as HTMLButtonElement).focus();

    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(0);
    expect(stranded).toBe(1);
  });

  it('keeps the picture when the guard is dismissed', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }), {
      media,
    });
    await el.updateComplete;

    await removeAttachment(el, 'editor-photo-remove', 'cancel');
    for (let i = 0; i < 3; i += 1) await el.updateComplete;

    expect(media.removals).toEqual([]);
    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(1);
  });

  // The guard sits outside the form's own event scope: a host closes the editor
  // on `cancel`, and answering "no, keep the photo" is not that.
  it('keeps its guard events to itself', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    await removeAttachment(el, 'editor-photo-remove', 'cancel');
    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    for (let i = 0; i < 3; i += 1) await el.updateComplete;

    expect(cancels).toBe(0);
  });

  it('gives a phone a camera tile beside the library tile', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), {
      media: makeMediaBindings(),
      mediaConfig: CONFIG,
      mobile: true,
    });

    // Only the camera tile carries `capture`, and a camera returns one shot.
    const camera = q(el, '[data-testid="editor-photo-camera-input"]') as HTMLInputElement;
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(camera.multiple).toBe(false);
    expect(camera.getAttribute('accept')).toBe(CONFIG.picture_mime_types.join(','));

    const library = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    expect(library.getAttribute('capture')).toBeNull();
    expect(library.multiple).toBe(true);
    expect(library.getAttribute('accept')).toBe(CONFIG.picture_mime_types.join(','));

    // The camera comes first, and each tile says which of the two it is.
    expect(all(el, '[data-testid="editor-photos"] .picker').map((tile) => tile.dataset.testid)).toEqual([
      'editor-photo-camera',
      'editor-photo-picker',
    ]);
    expect(q(el, '[data-testid="editor-photo-camera"]')?.textContent).toContain('Take photo');
    expect(q(el, '[data-testid="editor-photo-picker"]')?.textContent).toContain('Add photo');
  });

  it('leaves a desktop editor one tile, and no capture on it', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), {
      media: makeMediaBindings(),
      mediaConfig: CONFIG,
      mobile: false,
    });

    expect(q(el, '[data-testid="editor-photo-camera"]')).toBeNull();
    const library = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    expect(library.getAttribute('capture')).toBeNull();
  });

  it('sends a shot from the camera tile down the same upload path', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), {
      media,
      mediaConfig: CONFIG,
      mobile: true,
    });

    pickCamera(el, [png('shot.png')]);
    // A macrotask, so the whole prepare-then-send chain drains first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads.map((u) => [u.file.name, u.kind])).toEqual([['shot.png', 'picture']]);
  });

  it('shows a placeholder rather than a broken image when signing fails', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }), {
      media: makeMediaBindings({ signFails: true }),
    });
    for (let i = 0; i < 3; i += 1) await el.updateComplete;

    expect(q(el, '[data-testid="editor-photo-placeholder"]')).toBeTruthy();
    expect(el.shadowRoot?.querySelector('[data-testid="editor-photo"] img')).toBeNull();
  });
});

describe('hv-editor-attachments: documents', () => {
  /** Drive the hidden document input the way a picker does. */
  function pick(el: HVEditorAttachments, files: File[]) {
    const input = q(el, '[data-testid="editor-manual-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const pdf = (name = 'manual.pdf') => new File(['x'], name, { type: 'application/pdf' });

  const CONFIG = {
    picture_mime_types: ['image/png'],
    max_pictures_per_item: 4,
    manual_mime_types: ['application/pdf'],
    max_manuals_per_item: 1,
    max_attachment_bytes: 16,
  };

  it('shows no documents section while creating an item', async () => {
    const el = await mount(null, { media: makeMediaBindings() });

    expect(q(el, '[data-testid="editor-documents"]')).toBeNull();
  });

  it('lists the manuals and leaves the pictures to the strip above', async () => {
    const el = await mount(
      makeItem({
        id: 'i-1',
        attachments: [makeAttachment({ id: 'p-1' }), makeManual({ id: 'm-1' })],
      }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    expect(all(el, '[data-testid="editor-document"]')).toHaveLength(1);
    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(1);
  });

  it('uploads a picked file as a manual, not as a picture', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [pdf()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(1);
    expect(media.uploads[0]?.kind).toBe('manual');
  });

  // A document comes off the file system; pointing the control at the camera
  // would put a photo of a page where the PDF should be.
  it('accepts documents only and never opens the camera', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), {
      media: makeMediaBindings(),
      mediaConfig: CONFIG,
    });

    const input = q(el, '[data-testid="editor-manual-input"]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('application/pdf');
    expect(input.getAttribute('capture')).toBeNull();
  });

  it('refuses a document past its own per-item cap, not the photo one', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1' })] }), {
      media,
      mediaConfig: CONFIG,
    });

    pick(el, [pdf()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('1 documents is the limit');
  });

  it('refuses a type the backend does not accept as a document', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('not an accepted document type');
  });

  it('sends a document cap the config never mentioned to the backend to judge', async () => {
    // An older backend reports no document cap. Guessing one here would refuse
    // a file the server would have taken.
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1' })] }), {
      media,
      mediaConfig: { picture_mime_types: ['image/png'], max_pictures_per_item: 4, max_attachment_bytes: 16 },
    });

    pick(el, [pdf()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(1);
  });

  it('retitles a document on change and adopts the item that comes back', async () => {
    const media = makeMediaBindings({
      retitle: async (itemId) =>
        makeItem({
          id: itemId,
          version: 6,
          attachments: [makeManual({ id: 'm-1', title: 'Dishwasher manual' })],
        }),
    });
    const el = await mount(makeItem({ id: 'i-1', version: 5, attachments: [makeManual({ id: 'm-1' })] }), {
      media,
    });
    await el.updateComplete;

    const field = q(el, '[data-testid="editor-document-title"]') as HTMLInputElement;
    field.value = '  Dishwasher manual  ';
    field.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.retitles).toEqual([{ itemId: 'i-1', attachmentId: 'm-1', title: 'Dishwasher manual' }]);
    // The retitle bumped the version, so the next save must carry the new one.
    expect(el.current?.version).toBe(6);
  });

  it('shows the filename as the placeholder for an untitled document', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1', filename: 'scan_0142.pdf' })] }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    const field = q(el, '[data-testid="editor-document-title"]') as HTMLInputElement;
    expect(field.getAttribute('placeholder')).toBe('scan_0142.pdf');
    expect(field.value).toBe('');
  });

  it('removes a document and adopts the returned item', async () => {
    const media = makeMediaBindings({
      remove: async (itemId) => makeItem({ id: itemId, version: 9, attachments: [] }),
    });
    const el = await mount(makeItem({ id: 'i-1', version: 4, attachments: [makeManual({ id: 'm-1' })] }), {
      media,
    });
    await el.updateComplete;

    await removeAttachment(el, 'editor-document-remove', 'confirm');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.removals).toEqual([{ itemId: 'i-1', attachmentId: 'm-1' }]);
    expect(all(el, '[data-testid="editor-document"]')).toHaveLength(0);
  });

  it('names the document in the guard, not the photo copy', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1' })] }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;

    (q(el, '[data-testid="editor-document-remove"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const guard = await dialog(el, 'editor-remove-confirm');

    expect(guard.shadowRoot?.querySelector('h2')?.textContent).toContain('document');
    expect(guard.shadowRoot?.querySelector('[data-testid="confirm-message"]')?.textContent).toContain(
      'deleted',
    );
  });

  it('names the file that failed rather than the section it came from', async () => {
    const media = makeMediaBindings({
      upload: async () => {
        throw new Error('That file is not a PDF.');
      },
    });
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    pick(el, [pdf('broken.pdf')]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const entry = q(el, '[data-testid="editor-upload"]');
    expect(entry?.textContent).toContain('broken.pdf');
    expect(entry?.textContent).toContain('That file is not a PDF.');
  });
});

describe('hv-editor-attachments: opening a document', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serve(status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
  }

  // The detail sheet's read view is a phone surface; on a desktop this form is
  // the only place a manual is reachable at all.
  it('offers each document as a link to the signed URL', async () => {
    serve(206);
    const el = await mount(
      makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1', title: 'Warranty' })] }),
      { media: makeMediaBindings() },
    );
    for (let i = 0; i < 3; i += 1) await el.updateComplete;

    const open = q(el, '[data-testid="editor-document-open"]') as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe(
      `/api/haventory/media/i-1/m-1?${MEDIA_NAME_TOKEN_PARAM}=` +
        `${attachmentNameToken(makeManual({ id: 'm-1', title: 'Warranty' }))}&authSig=test`,
    );
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('aria-label')).toBe('Open Warranty');
  });

  it('replaces the link with the missing state when the file is gone', async () => {
    serve(404);
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeManual({ id: 'm-1' })] }), {
      media: makeMediaBindings(),
    });
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(q(el, '[data-testid="editor-document-missing"]')).toBeTruthy();
    expect(q(el, '[data-testid="editor-document-open"]')).toBeNull();
    // The title stays editable: the metadata is still the item's to correct.
    expect(q(el, '[data-testid="editor-document-title"]')).toBeTruthy();
  });
});

/**
 * The state an import onto a fresh machine leaves every picture in — the export
 * carries the metadata and not the bytes. A photo whose file is gone gets the
 * same chip its manual sibling gets, not the browser's broken-image glyph.
 */
describe('hv-editor-attachments: a picture whose file is gone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serve(status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
  }

  it('gives it the same missing state a manual already gets', async () => {
    serve(404);
    const el = await mount(
      makeItem({ id: 'i-1', name: 'Coffee maker', attachments: [makeAttachment({ id: 'p-1' })] }),
      { media: makeMediaBindings() },
    );
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    const tile = q(el, '[data-testid="editor-photo-missing"]');
    expect(tile).toBeTruthy();
    expect(tile?.textContent).toContain('File missing');
    expect(tile?.querySelector('.hv-chip.warning')).toBeTruthy();
    // No <img>: an element with a src is what draws the glyph and spills the
    // alt text out of a 72px tile. And nothing to open, because the lightbox
    // has nothing to show.
    expect(el.shadowRoot?.querySelector('img')).toBeNull();
    expect(q(el, '[data-testid="editor-photo-open"]')).toBeNull();
    // The reference is still the item's to clear.
    expect(q(el, '[data-testid="editor-photo-remove"]')).toBeTruthy();
  });

  it('keeps a picture the probe could not rule out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'p-1' })] }), {
      media: makeMediaBindings(),
    });
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(q(el, '[data-testid="editor-photo-missing"]')).toBeNull();
    expect(q(el, '[data-testid="editor-photo-open"]')).toBeTruthy();
  });
});

describe('hv-editor-attachments: photo order and the cover', () => {
  function pick(el: HVEditorAttachments, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const png = (name = 'photo.png') => new File(['x'], name, { type: 'image/png' });

  const three = () => [
    makeAttachment({ id: 'a', order: 0 }),
    makeAttachment({ id: 'b', order: 1 }),
    makeAttachment({ id: 'c', order: 2 }),
  ];

  const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('marks the first photo as the cover and offers no control to re-cover it', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;

    // One inert mark, on the photo the list row and detail header already show.
    expect(all(el, '[data-testid="editor-photo-cover"]')).toHaveLength(1);
    expect(all(el, '[data-testid="editor-photo-make-cover"]')).toHaveLength(2);
  });

  it('makes a photo the cover by moving it to position 0', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), { media });
    await el.updateComplete;

    defined(all(el, '[data-testid="editor-photo-make-cover"]')[1], 'photo button 1').click();
    await drain();

    expect(media.reorders).toEqual([{ itemId: 'i-1', kind: 'picture', attachmentIds: ['c', 'a', 'b'] }]);
  });

  it('moves one photo a single place and names the whole order', async () => {
    // The backend refuses anything but a full permutation of the kind.
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), { media });
    await el.updateComplete;

    defined(all(el, '[data-testid="editor-photo-later"]')[0], 'photo button 0').click();
    await drain();

    expect(media.reorders[0]?.attachmentIds).toEqual(['b', 'a', 'c']);
  });

  it('offers no move past either end', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;

    const earlier = all<HTMLButtonElement>(el, '[data-testid="editor-photo-earlier"]');
    const later = all<HTMLButtonElement>(el, '[data-testid="editor-photo-later"]');
    expect([earlier[0]?.disabled, earlier[2]?.disabled]).toEqual([true, false]);
    expect([later[0]?.disabled, later[2]?.disabled]).toEqual([false, true]);
  });

  it('shows no ordering controls for a single photo', async () => {
    // Nothing to order, and a lone photo is the cover by definition.
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'a' })] }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-photo-earlier"]')).toBeNull();
    expect(q(el, '[data-testid="editor-photo-cover"]')).toBeNull();
  });

  it('reports a refused reorder rather than leaving the strip silently unmoved', async () => {
    const media = makeMediaBindings({
      reorder: async () => {
        throw new Error('version conflict');
      },
    });
    const el = await mount(makeItem({ id: 'i-1', attachments: three() }), { media });
    await el.updateComplete;

    defined(all(el, '[data-testid="editor-photo-later"]')[0], 'photo button 0').click();
    await drain();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('version conflict');
  });

  it('sends the failed file again on retry, without asking for it twice', async () => {
    // On a phone the original came from the camera and was never on disk, so
    // "pick it again" means retaking the photo.
    let attempts = 0;
    const media = makeMediaBindings({
      upload: async (itemId) => {
        attempts += 1;
        if (attempts === 1) throw new Error('Upload failed (503)');
        return makeItem({ id: itemId, version: 9 });
      },
    });
    const el = await mount(makeItem({ id: 'i-1', version: 2 }), { media });

    pick(el, [png('shelf.png')]);
    await drain();
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-upload"]')?.dataset.state).toBe('error');

    q(el, '[data-testid="editor-upload-retry"]')?.click();
    await drain();
    await el.updateComplete;

    expect(media.uploads).toHaveLength(2);
    expect(media.uploads[1]?.file.name).toBe('shelf.png');
    // The entry clears once it lands, like any other successful upload.
    expect(q(el, '[data-testid="editor-upload"]')).toBeNull();
  });

  it('offers no retry for a failure that has no file behind it', async () => {
    const media = makeMediaBindings({
      remove: async () => {
        throw new Error('gone already');
      },
    });
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'a' })] }), {
      media,
    });
    await el.updateComplete;

    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    await drain();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('gone already');
    expect(q(el, '[data-testid="editor-upload-retry"]')).toBeNull();
  });
});

describe('hv-editor-attachments: shrinking a photo before it is sent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** jsdom has no image decoder and no 2D context; both are the seam. */
  function stubCanvas(encodedBytes: number) {
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 4032,
      height: 3024,
      close: () => undefined,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => undefined,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      callback(new Blob([new Uint8Array(encodedBytes)], { type }));
    });
  }

  function pick(el: HVEditorAttachments, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  function oversized(): File {
    const f = new File(['x'], 'IMG_0042.jpg', { type: 'image/jpeg' });
    Object.defineProperty(f, 'size', { value: 4 * 1024 * 1024 });
    return f;
  }

  const CONFIG = {
    picture_mime_types: ['image/jpeg'],
    max_pictures_per_item: 4,
    max_attachment_bytes: 1024,
  };

  // The whole point of the pass: a phone frame is several times the cap, so
  // without this the most ordinary way to add a photo is the one that fails.
  it('measures the cap against the shrunk file, so an oversized photo lands', async () => {
    stubCanvas(512);
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [oversized()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(1);
    expect(media.uploads[0]?.file.size).toBe(512);
    expect(q(el, '[data-testid="editor-upload"]')).toBeNull();
  });

  it('still refuses a photo the shrink could not bring under the cap', async () => {
    stubCanvas(4096);
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mediaConfig: CONFIG });

    pick(el, [oversized()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('over the');
  });

  it('never re-encodes a document', async () => {
    stubCanvas(512);
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });
    const pdf = new File(['x'], 'manual.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: 4 * 1024 * 1024 });

    const input = q(el, '[data-testid="editor-manual-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [pdf], configurable: true });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(media.uploads[0]?.file).toBe(pdf);
  });
});

describe('hv-editor-attachments: upload errors outlive their siblings', () => {
  function pick(el: HVEditorAttachments, files: File[]) {
    const input = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const png = (name: string) => new File(['x'], name, { type: 'image/png' });

  /** Refuses anything named "broken", takes everything else. */
  async function mountWithOneRefusal() {
    const media = makeMediaBindings({
      upload: async (itemId, file) => {
        if (file.name.includes('broken')) {
          throw new Error('file content is not one of the accepted types');
        }
        return makeItem({ id: itemId, version: 5 });
      },
    });
    const el = await mount(makeItem({ id: 'i-1', version: 1 }), { media });

    pick(el, [png('broken.jpg'), png('photo-3-landscape.jpg')]);
    // A macrotask, so the whole sequential queue drains before the assertion.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The sibling's success reaches the card as a broadcast, and the host hands
    // the still-open editor a fresh object for the same item.
    el.item = makeItem({ id: 'i-1', version: 5 });
    await el.updateComplete;
    return el;
  }

  it('keeps the refused file reported after the item refreshes', async () => {
    const el = await mountWithOneRefusal();

    const entries = all(el, '[data-testid="editor-upload"]');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.dataset.state).toBe('error');
    expect(entries[0]?.textContent).toContain('broken.jpg');
    expect(entries[0]?.textContent).toContain('not one of the accepted types');
    expect(q(el, '[data-testid="editor-upload-retry"]')).toBeTruthy();
  });

  it('clears exactly the row whose dismiss was pressed', async () => {
    const el = await mountWithOneRefusal();
    pick(el, [png('also-broken.jpg')]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(all(el, '[data-testid="editor-upload"]')).toHaveLength(2);

    (all(el, '[data-testid="editor-upload-dismiss"]')[0] as HTMLButtonElement).click();
    await el.updateComplete;

    const left = all(el, '[data-testid="editor-upload"]');
    expect(left).toHaveLength(1);
    expect(left[0]?.textContent).toContain('also-broken.jpg');
  });

  // Nothing else clears the queue any more, so a row with no Retry — a failed
  // reorder or removal — would otherwise stay for the life of the form.
  it('offers a dismiss on an error row that carries no file to retry', async () => {
    const media = makeMediaBindings({
      remove: async () => {
        throw new Error('gone already');
      },
    });
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }), { media });
    await el.updateComplete;

    await removeAttachment(el, 'editor-photo-remove', 'confirm');
    for (let i = 0; i < 4; i += 1) await el.updateComplete;
    expect(q(el, '[data-testid="editor-upload-retry"]')).toBeNull();

    (q(el, '[data-testid="editor-upload-dismiss"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(q(el, '[data-testid="editor-upload"]')).toBeNull();
  });
});

// A multi-MB photo on a phone connection renders as one static word for twenty
// seconds unless something moves, and the queue that reported it sat two
// sections below the grid the user was watching.
describe('hv-editor-attachments: the upload queue reports where the work is', () => {
  function pick(el: HVEditorAttachments, testid: string, files: File[]) {
    const input = q(el, `[data-testid="${testid}"]`) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  /** Hold the upload open so the queue can be inspected mid-flight. */
  function stalledMedia() {
    return makeMediaBindings({ upload: () => new Promise<Item>(() => {}) });
  }

  it('files each queue under the section that started it', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: stalledMedia() });
    await el.updateComplete;

    pick(el, 'editor-photo-input', [new File(['x'], 'shelf.png', { type: 'image/png' })]);
    pick(el, 'editor-manual-input', [new File(['x'], 'manual.pdf', { type: 'application/pdf' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const lists = all(el, '[data-testid="editor-upload-list"]');
    expect(lists.map((l) => l.dataset.kind)).toEqual(['picture', 'manual']);
    expect(lists[0]?.textContent).toContain('shelf.png');
    expect(lists[0]?.textContent).not.toContain('manual.pdf');
    expect(lists[1]?.textContent).toContain('manual.pdf');
    // Each list sits inside the section whose picker filled it.
    expect(lists[0]?.closest('.section')?.querySelector('[data-testid="editor-photos"]')).toBeTruthy();
    expect(lists[1]?.closest('.section')?.querySelector('[data-testid="editor-documents"]')).toBeTruthy();
  });

  it('moves something while a file is in flight, and stops when it fails', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: stalledMedia() });
    await el.updateComplete;

    pick(el, 'editor-photo-input', [new File(['x'], 'shelf.png', { type: 'image/png' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const row = q(el, '[data-testid="editor-upload"]') as HTMLElement;
    expect(row.dataset.state).toBe('uploading');
    const bar = q(el, '[data-testid="editor-upload-progress"]') as HTMLElement;
    expect(bar).toBeTruthy();
    // Indeterminate on purpose: the WebSocket path reports no bytes sent, so
    // the bar must not carry a value it would have to invent.
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('drops the indicator once the row is an error someone has to read', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), {
      media: makeMediaBindings({
        upload: async () => {
          throw new Error('file content is not one of the accepted types');
        },
      }),
    });
    await el.updateComplete;

    pick(el, 'editor-photo-input', [new File(['x'], 'broken.jpg', { type: 'image/png' })]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect((q(el, '[data-testid="editor-upload"]') as HTMLElement).dataset.state).toBe('error');
    expect(q(el, '[data-testid="editor-upload-progress"]')).toBe(null);
  });
});

// jsdom builds a `DragEvent` with no `DataTransfer` behind it, so the files ride
// on a plain object. What is worth asserting here is the routing — which kind
// each dropped file becomes, and that nothing new appears on the upload path.
// The browser's own drag machinery is the handover's job.
describe('hv-editor-attachments: dropping files onto the sections', () => {
  const png = (name = 'photo.png') => new File(['x'], name, { type: 'image/png' });
  const pdf = (name = 'manual.pdf') => new File(['x'], name, { type: 'application/pdf' });

  function dragEvent(type: string, files: File[]) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', {
      value: { files, dropEffect: 'none' },
      configurable: true,
    });
    return e as DragEvent;
  }

  async function dropOn(el: HVEditorAttachments, testid: string, files: File[]) {
    const target = q(el, `[data-testid="${testid}"]`) as HTMLElement;
    target.dispatchEvent(dragEvent('drop', files));
    // A macrotask, so the prepare-then-send chain drains first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }

  it('attaches an image dropped on the photo strip as a photo', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-photos', [png()]);

    expect(media.uploads.map((u) => [u.file.name, u.kind])).toEqual([['photo.png', 'picture']]);
  });

  it('attaches a document dropped on the document list as a manual', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-documents', [pdf()]);

    expect(media.uploads.map((u) => [u.file.name, u.kind])).toEqual([['manual.pdf', 'manual']]);
  });

  // The file decides, not the cell it crossed: refusing a PDF because it landed
  // on the photo strip would be arguing with something the user can see.
  it('attaches a document dropped on the photo strip as a manual', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-photos', [pdf()]);

    expect(media.uploads.map((u) => u.kind)).toEqual(['manual']);
  });

  it('attaches an image dropped on the document list as a photo', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-documents', [png()]);

    expect(media.uploads.map((u) => u.kind)).toEqual(['picture']);
  });

  it('routes a mixed multi-file drop file by file', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media });

    await dropOn(el, 'editor-photos', [png('a.png'), pdf('b.pdf'), png('c.png')]);

    expect(media.uploads.map((u) => [u.file.name, u.kind])).toEqual([
      ['a.png', 'picture'],
      ['c.png', 'picture'],
      ['b.pdf', 'manual'],
    ]);
  });

  // The existing preflight is the one place that knows what the backend takes,
  // so a refused file is refused in the same words a picked one would be.
  it('sends a dropped file through the same preflight a picked one gets', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), {
      media,
      mediaConfig: {
        picture_mime_types: ['image/png'],
        manual_mime_types: ['application/pdf'],
        max_attachment_bytes: 16,
      } as HVEditorAttachments['mediaConfig'],
    });

    await dropOn(el, 'editor-documents', [new File(['x'], 'notes.txt', { type: 'text/plain' })]);

    expect(media.uploads).toHaveLength(0);
    expect(q(el, '[data-testid="editor-upload"]')?.textContent).toContain('not an accepted');
  });

  it('cancels dragover so the browser does not navigate to the file', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings() });
    const over = dragEvent('dragover', [png()]);

    (q(el, '[data-testid="editor-photos"]') as HTMLElement).dispatchEvent(over);

    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe('copy');
  });

  it('marks the section a drag is over, and unmarks it on the way out', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings() });
    const photos = q(el, '[data-testid="editor-photos"]') as HTMLElement;

    photos.dispatchEvent(dragEvent('dragover', [png()]));
    await el.updateComplete;
    expect(photos.classList.contains('dropping')).toBe(true);

    photos.dispatchEvent(new Event('dragleave', { bubbles: true }));
    await el.updateComplete;
    expect(photos.classList.contains('dropping')).toBe(false);
  });

  // There is no drag on touch, so an over-state could only ever fire by accident
  // — the phone layout carries no target at all rather than one that declines.
  // The root guard stays: `mobile` is the card element's width, and a narrow
  // card in a desktop window still has a mouse with a file on the end of it.
  it('renders no drop target on a phone', async () => {
    const media = makeMediaBindings();
    const el = await mount(makeItem({ id: 'i-1' }), { media, mobile: true });
    const photos = q(el, '[data-testid="editor-photos"]') as HTMLElement;

    photos.dispatchEvent(dragEvent('dragover', [png()]));
    await dropOn(el, 'editor-photos', [png()]);

    expect(photos.classList.contains('dropping')).toBe(false);
    expect(media.uploads).toHaveLength(0);
  });
});

// A 72px thumbnail is no way to look at a photo, so the form opens the lightbox
// from one wherever it is hosted — not only on the phone's detail sheet.
describe('hv-editor-attachments: photos open full-size', () => {
  const shots = () => [makeAttachment({ id: 'att-1' }), makeAttachment({ id: 'att-2' })];

  async function withPhotos() {
    const el = await mount(makeItem({ id: 'i-1', name: 'Drill', attachments: shots() }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;
    await el.updateComplete;
    return el;
  }

  const box = (el: HVEditorAttachments) =>
    q(el, 'hv-lightbox')?.shadowRoot?.querySelector('[data-testid="lightbox"]') as HTMLElement | null;

  const settleBox = async (el: HVEditorAttachments) => {
    await settle(el);
    await q<HTMLElement & { updateComplete?: Promise<unknown> }>(el, 'hv-lightbox')?.updateComplete;
  };

  it('opens the photo that was clicked', async () => {
    const el = await withPhotos();

    (all(el, '[data-testid="editor-photo-open"]')[1] as HTMLButtonElement).click();
    await settleBox(el);
    await settleBox(el);

    expect(box(el)?.getAttribute('aria-label')).toBe('Drill — photo 2 of 2');
  });

  it('names each thumbnail for the photo it opens', async () => {
    const el = await withPhotos();
    expect(all(el, '[data-testid="editor-photo-open"]').map((b) => b.getAttribute('aria-label'))).toEqual([
      'View Drill — photo 1 of 2',
      'View Drill — photo 2 of 2',
    ]);
  });

  it('closes again and leaves the form standing', async () => {
    const el = await withPhotos();
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    (all(el, '[data-testid="editor-photo-open"]')[0] as HTMLButtonElement).click();
    await settleBox(el);
    await settleBox(el);
    (
      q(el, 'hv-lightbox')?.shadowRoot?.querySelector('[data-testid="lightbox-close"]') as HTMLButtonElement
    ).click();
    await settleBox(el);

    expect(box(el)).toBe(null);
    // Escape inside the lightbox must not read as Escape on the form.
    expect(cancels).toBe(0);
    expect(q(el, '[data-testid="editor-photos"]')).toBeTruthy();
  });

  // Without a signed URL there is no photo to open, only the camera placeholder.
  it('offers nothing to open where the URL has not arrived', async () => {
    const el = await mount(makeItem({ id: 'i-1', attachments: shots() }), { media: null });
    await el.updateComplete;
    expect(q(el, '[data-testid="editor-photo-open"]')).toBe(null);
  });
});

describe('hv-editor-attachments: the remove guard', () => {
  // The remove dialog is fixed to the window, so it takes its phone form from
  // the viewport — this element's own `mobile` is the card element's width and
  // would put a bottom sheet on a desktop monitor whenever the card sat in a
  // narrow column.
  it('editor-remove-confirm takes its phone form from the viewport, not the card', async () => {
    for (const narrow of [true, false]) {
      const restore = stubViewport(narrow);
      try {
        const el = await mount(makeItem({ id: '1', name: 'A' }), {
          media: makeMediaBindings(),
          mobile: !narrow,
        });
        expect((await dialog(el, 'editor-remove-confirm')).hasAttribute('mobile')).toBe(narrow);
        el.remove();
      } finally {
        restore();
      }
    }
  });
});

describe('hv-editor-attachments: what it owns of the form', () => {
  it('renders nothing without media bindings', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: null });

    expect(q(el, '[data-testid="editor-photos"]')).toBeNull();
    expect(q(el, '[data-testid="editor-documents"]')).toBeNull();
  });

  it('answers with the input item until an upload hands back a newer one', async () => {
    const media = makeMediaBindings({
      upload: async (itemId) => makeItem({ id: itemId, version: 7 }),
    });
    const input = makeItem({ id: 'i-1', version: 3 });
    const el = await mount(input, { media });
    expect(el.current).toBe(input);

    const picker = q(el, '[data-testid="editor-photo-input"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', {
      value: [new File(['x'], 'photo.png', { type: 'image/png' })],
      configurable: true,
    });
    picker.dispatchEvent(new Event('change'));
    await settle(el);
    expect(el.current?.version).toBe(7);

    // The input reaching the upload's version makes it the fresher copy.
    const caughtUp = makeItem({ id: 'i-1', version: 7 });
    el.item = caughtUp;
    expect(el.current).toBe(caughtUp);
    await el.updateComplete;
    expect(el.current).toBe(caughtUp);

    const newer = makeItem({ id: 'i-1', version: 9 });
    el.item = newer;
    await el.updateComplete;
    expect(el.current).toBe(newer);
  });

  it('clears a drag in progress when the form ends it', async () => {
    const el = await mount(makeItem({ id: 'i-1' }), { media: makeMediaBindings() });
    const photos = q(el, '[data-testid="editor-photos"]') as HTMLElement;
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { files: [], dropEffect: 'none' } });
    photos.dispatchEvent(over);
    await el.updateComplete;
    expect(photos.classList.contains('dropping')).toBe(true);

    el.endDrag();
    await el.updateComplete;

    expect(photos.classList.contains('dropping')).toBe(false);
  });
});

// The form saves on Ctrl/Cmd+Enter and hears every key from inside this element.
// The remove guard and the lightbox are not part of the form, so the chord ends
// at them; any other key still has to reach a host's focus trap.
describe('hv-editor-attachments: keys inside the overlays', () => {
  const chord = (key: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init });

  async function withGuardOpen() {
    const el = await mount(makeItem({ id: 'i-1', attachments: [makeAttachment({ id: 'att-1' })] }), {
      media: makeMediaBindings(),
    });
    await el.updateComplete;
    (q(el, '[data-testid="editor-photo-remove"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const guard = await dialog(el, 'editor-remove-confirm');
    const accept = guard.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLElement;
    return { el, accept };
  }

  it.each([{ ctrlKey: true }, { metaKey: true }])('stops %o + Enter inside the guard', async (mods) => {
    const { el, accept } = await withGuardOpen();
    const heard: string[] = [];
    el.addEventListener('keydown', (e) => heard.push(e.key));

    accept.dispatchEvent(chord('Enter', mods));

    expect(heard).toEqual([]);
  });

  it('lets every other key out of the guard', async () => {
    const { el, accept } = await withGuardOpen();
    const heard: string[] = [];
    el.addEventListener('keydown', (e) => heard.push(e.key));

    accept.dispatchEvent(chord('Tab'));
    accept.dispatchEvent(chord('Enter'));

    expect(heard).toEqual(['Tab', 'Enter']);
  });

  it('stops the chord inside the lightbox and lets Tab out', async () => {
    const el = await mount(
      makeItem({
        id: 'i-1',
        name: 'Drill',
        attachments: [makeAttachment({ id: 'att-1' }), makeAttachment({ id: 'att-2' })],
      }),
      { media: makeMediaBindings() },
    );
    await settle(el);
    (all(el, '[data-testid="editor-photo-open"]')[0] as HTMLButtonElement).click();
    await settle(el);
    const lightbox = q<HTMLElement & { updateComplete?: Promise<unknown> }>(el, 'hv-lightbox');
    await lightbox?.updateComplete;
    const box = lightbox?.shadowRoot?.querySelector('[data-testid="lightbox"]') as HTMLElement;
    const heard: string[] = [];
    el.addEventListener('keydown', (e) => heard.push(e.key));

    box.dispatchEvent(chord('Enter', { ctrlKey: true }));
    box.dispatchEvent(chord('Tab'));

    expect(heard).toEqual(['Tab']);
  });
});

// Every host re-binds `.item` from a fresh lookup on each store broadcast, so
// an upload landing — or anyone else editing the same row — hands the element a
// new object for the item it is already showing.
describe('hv-editor-attachments: same-item refreshes', () => {
  it('adopts the attachments the refreshed item carries', async () => {
    const el = await mount(
      makeItem({ id: 'i-1', name: 'Drill', version: 3, attachments: [makeAttachment({ id: 'att-1' })] }),
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(1);

    el.item = makeItem({
      id: 'i-1',
      name: 'Drill',
      version: 4,
      attachments: [makeAttachment({ id: 'att-1' }), makeAttachment({ id: 'att-2' })],
    });
    await el.updateComplete;
    await el.updateComplete;

    expect(all(el, '[data-testid="editor-photo"]')).toHaveLength(2);
  });
});
