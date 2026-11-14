import { t } from '../i18n';
import { serverErrorText } from '../store/server-error';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import { tokens, base } from '../ui/tokens';
import { editorFields } from '../ui/editor-fields';
import { chip } from '../ui/chip';
import { icon } from '../ui/icons';
import { ViewportNarrow } from '../ui/responsive';
import { focusStranded } from '../ui/dialog-focus';
import {
  MEDIA_VARIANT_THUMB,
  MediaUrls,
  attachmentNameToken,
  attachmentTitle,
  formatBytes,
  manuals,
  pictureAlt,
  pictures,
} from '../ui/media';
import type { MediaBindings } from '../ui/media';
import { prepareForUpload } from '../ui/downscale';
import { docIcon, renderDocumentRow, renderLightboxHost, renderPhotoFigure } from '../ui/attachments';
import type { AttachmentKind, Item, MediaConfig } from '../store/types';
import './hv-confirm';

/**
 * One file the picker is working through. A failed entry keeps the `File` so
 * Retry sends exactly what was picked, even a photo never written to disk.
 */
interface UploadEntry {
  id: string;
  name: string;
  state: 'queued' | 'preparing' | 'uploading' | 'error';
  message: string | null;
  file: File | null;
  kind: AttachmentKind;
}

/** How each kind of attachment names itself in a confirmation. */
const removeCopy = (kind: AttachmentKind): { heading: string; message: string } =>
  kind === 'manual'
    ? {
        heading: t('hv.editor.removeDocument.heading'),
        message: t('hv.editor.removeDocument.message'),
      }
    : {
        heading: t('hv.editor.removePhoto.heading'),
        message: t('hv.editor.removePhoto.message'),
      };

/** The refusal on a rejected command, whatever shape the rejection arrived in. */
function errorText(err: unknown): string {
  return serverErrorText(err, t('hv.editor.upload.failed'));
}

/**
 * The item editor's photo strip and document list, with the upload queue under
 * each, the remove confirmation and the lightbox. It owns every attachment
 * write; the editor passes the item and the media bindings in and reads back
 * `current`, the item to save against.
 */
@customElement('hv-editor-attachments')
export class HVEditorAttachments extends LitElement {
  static override styles = [
    tokens,
    base,
    editorFields,
    chip,
    docIcon,
    css`
      /* Packed to the top, so a stretched section does not share its surplus
         between the label and the control. */
      .section {
        display: grid;
        align-content: start;
        gap: 4px;
        min-width: 0;
      }
      .photos {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .photos figure {
        position: relative;
        margin: 0;
        width: 72px;
        border-radius: 8px;
        overflow: hidden;
        background: var(--hv-surface-raised);
      }
      .photos .open {
        display: block;
        padding: 0;
        border: none;
        background: none;
      }
      .photos img {
        width: 72px;
        height: 72px;
        object-fit: cover;
        display: block;
      }
      .photos .placeholder {
        display: grid;
        place-items: center;
        width: 72px;
        height: 72px;
        color: var(--hv-text-tertiary);
      }
      /* A picture whose file is gone keeps its box so the strip does not reflow. */
      .photos .placeholder.missing {
        gap: 4px;
        box-sizing: border-box;
        border: 1px dashed var(--hv-input-border);
        border-radius: 8px;
      }
      /* Smaller than the card's chip, which a 72px tile would clip. */
      .photos .placeholder.missing .hv-chip {
        max-width: 100%;
        padding: 1px 5px;
        font-size: 10px;
        line-height: 1.2;
        white-space: normal;
        text-align: center;
      }
      /* Under the thumbnail, since no overlay is legible on every photo. Three
         share the tile's width, so a finger gets height rather than 44px squares. */
      .tile-controls {
        display: flex;
        align-items: stretch;
        justify-content: space-between;
        height: 24px;
        background: var(--hv-surface-raised);
      }
      :host([mobile]) .tile-controls {
        height: var(--hv-tap-min, 24px);
      }
      .tile-controls button,
      .tile-controls .is-cover {
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        background: none;
        color: var(--hv-text-secondary);
      }
      :host([mobile]) .tile-controls button,
      :host([mobile]) .tile-controls .is-cover {
        height: auto;
      }
      .tile-controls button[disabled] {
        opacity: 0.3;
      }
      .tile-controls .is-cover {
        color: var(--hv-amber);
      }
      /* WCAG's 24px floor is also the most a control on a 72px thumbnail can
         take; the confirm step behind it makes the small target safe. */
      .photos .remove {
        position: absolute;
        top: 2px;
        right: 2px;
        display: inline-grid;
        place-items: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        border-radius: 50%;
        /* Fixed dark chip: it sits on an arbitrary photo in either theme. */
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
      }
      .photos .picker {
        display: grid;
        place-items: center;
        gap: 2px;
        width: 72px;
        height: 72px;
        border: 1px dashed var(--hv-input-border);
        border-radius: 8px;
        color: var(--hv-text-secondary);
        font-size: 11px;
        text-align: center;
        cursor: pointer;
      }
      /* Hidden but focusable; display: none would leave the tab order. */
      .reveal {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }
      .documents {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      /* Outline, so nothing inside shifts as a drag crosses in. */
      .photos.dropping,
      .documents.dropping {
        outline: 2px dashed var(--hv-primary);
        outline-offset: 4px;
        border-radius: var(--hv-radius-input);
      }
      .documents li {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .documents .doc-title {
        flex: 1;
        min-width: 0;
      }
      .documents .doc-size {
        flex: none;
        font-size: var(--hv-editor-note);
        color: var(--hv-text-secondary);
      }
      .documents .doc-open,
      .documents .doc-remove {
        flex: none;
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: none;
        background: none;
        border-radius: 50%;
        color: var(--hv-text-secondary);
      }
      .doc-picker {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: start;
        margin-top: 6px;
        min-height: 36px;
        padding: 0 12px;
        border: 1px dashed var(--hv-input-border);
        border-radius: var(--hv-radius-chip);
        color: var(--hv-text-secondary);
        font-size: var(--hv-editor-note);
        cursor: pointer;
      }
      .upload-list {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
        display: grid;
        gap: 5px;
        font-size: var(--hv-editor-note);
        color: var(--hv-text-secondary);
      }
      .upload-list li {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px 8px;
      }
      .upload-list li .kind {
        flex: none;
        display: inline-grid;
        place-items: center;
        color: var(--hv-text-tertiary);
      }
      .upload-list li .file {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 45%;
      }
      .upload-list li.failed .state {
        color: var(--hv-error);
      }
      .upload-list li .retry,
      .upload-list li .dismiss {
        display: inline-grid;
        place-items: center;
        margin-left: auto;
        min-width: var(--hv-tap-min, 24px);
        min-height: var(--hv-tap-min, 24px);
        border: none;
        background: none;
        padding: 0 4px;
        color: var(--hv-primary-dark);
        font: 500 var(--hv-editor-note) var(--hv-font);
        cursor: pointer;
      }
      .upload-list li .dismiss {
        color: var(--hv-text-secondary);
      }
      /* Retry already claimed the free space; the dismiss follows it. */
      .upload-list li .retry ~ .dismiss {
        margin-left: 0;
      }
      /* Indeterminate: nothing on the WebSocket path reports bytes sent. */
      .progress {
        flex: 0 0 100%;
        position: relative;
        overflow: hidden;
        height: 3px;
        border-radius: 999px;
        background: var(--hv-divider);
      }
      .progress .fill {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 40%;
        border-radius: inherit;
        background: var(--hv-primary);
      }
      @media (prefers-reduced-motion: no-preference) {
        .progress .fill {
          animation: hv-upload-sweep 1.3s ease-in-out infinite;
        }
      }
      @keyframes hv-upload-sweep {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(250%);
        }
      }
      /* The confirm is a block box, which would take a grid row and a gap even
         when it draws nothing but fixed layers; out of flow, it takes neither. */
      .overlays {
        position: absolute;
      }
    `,
  ];

  /** The host's copy of the item; null while the form is creating one. */
  @property({ attribute: false }) item: Item | null = null;
  /** Attachment access; null hides both sections. */
  @property({ attribute: false }) media: MediaBindings | null = null;
  /** Caps and accepted types, so a doomed file is refused before it is sent. */
  @property({ attribute: false }) mediaConfig: MediaConfig | null = null;
  @property({ type: Boolean, reflect: true }) mobile = false;

  /** Files the picker is working through; a failed one stays until retried or dismissed. */
  @state() private _uploads: UploadEntry[] = [];
  /** The item as an upload left it, until `item` catches up. */
  @state() private _uploaded: Item | null = null;
  /** The attachment awaiting a yes, and what kind it is. */
  @state() private _confirmRemove: { id: string; kind: AttachmentKind } | null = null;
  /** Which attachment section a drag is currently over, for the over-state. */
  @state() private _dropTarget: AttachmentKind | null = null;
  /** Which photo the lightbox was opened on, or null when it is closed. */
  @state() private _lightbox: number | null = null;

  private readonly _urls = new MediaUrls(this);
  /** Window width, for the dialog this element raises over itself. */
  private readonly _viewport = new ViewportNarrow(this);
  private readonly _emit = emitter<'hv-editor-attachments'>(this);
  private _uploadSeq = 0;

  /** The item to save against: whatever the last upload returned, else the input. */
  get current(): Item | null {
    return this._caughtUp ? this.item : (this._uploaded ?? this.item);
  }

  /** Once `item` reaches the upload's version it is the fresher copy. */
  private get _caughtUp(): boolean {
    return !!this._uploaded && !!this.item && this.item.version >= this._uploaded.version;
  }

  /** Cancel a drag in progress, for a drop that landed outside both sections. */
  endDrag(): void {
    this._dropTarget = null;
  }

  protected override willUpdate() {
    this._urls.configure(this.media?.sign ?? null);
    if (this._caughtUp) this._uploaded = null;
  }

  /**
   * Why this file cannot be uploaded, or null when it can: a courtesy check
   * against the reported caps, so a doomed file fails before it is sent. The
   * backend decides from the file's own bytes.
   */
  private _preflight(file: File, kind: AttachmentKind, alreadyAttached: number): string | null {
    const config = this.mediaConfig;
    if (!config) return null;
    const cap = kind === 'manual' ? config.max_manuals_per_item : config.max_pictures_per_item;
    if (cap !== undefined && alreadyAttached >= cap) {
      return kind === 'manual'
        ? t('hv.editor.preflight.tooManyDocuments', { cap })
        : t('hv.editor.preflight.tooManyPhotos', { cap });
    }
    if (file.size > config.max_attachment_bytes) {
      return t('hv.editor.preflight.tooBig', {
        size: formatBytes(file.size),
        limit: formatBytes(config.max_attachment_bytes),
      });
    }
    const accepted = kind === 'manual' ? config.manual_mime_types : config.picture_mime_types;
    if (file.type && accepted && !accepted.includes(file.type)) {
      return kind === 'manual'
        ? t('hv.editor.preflight.badDocumentType', { type: file.type })
        : t('hv.editor.preflight.badImageType', { type: file.type });
    }
    return null;
  }

  private _patchUpload(id: string, patch: Partial<UploadEntry>) {
    this._uploads = this._uploads.map((u) => (u.id === id ? { ...u, ...patch } : u));
  }

  /** Report a failed reorder, removal or retitle in the upload queue, without Retry. */
  private _pushUploadError(prefix: string, kind: AttachmentKind, name: string, err: unknown) {
    this._uploads = [
      ...this._uploads,
      {
        id: `${prefix}-${(this._uploadSeq += 1)}`,
        name,
        state: 'error',
        message: errorText(err),
        file: null,
        kind,
      },
    ];
  }

  /**
   * Upload the picked files one at a time: each upload bumps the version and
   * returns the whole attachment list, so two in flight would race.
   */
  private async _uploadFiles(files: File[], kind: AttachmentKind) {
    const queued: UploadEntry[] = files.map((file) => ({
      id: `upload-${(this._uploadSeq += 1)}`,
      name: file.name,
      state: 'queued',
      message: null,
      file,
      kind,
    }));
    this._uploads = [...this._uploads, ...queued];
    for (const entry of queued) await this._sendOne(entry);
  }

  /**
   * One file from preflight to attached, for the picker and Retry alike. The
   * shrink comes first so the byte cap measures the size actually sent.
   */
  private async _sendOne(entry: UploadEntry) {
    const media = this.media;
    const item = this.current;
    const picked = entry.file;
    if (!media || !item || !picked) return;

    this._patchUpload(entry.id, { state: 'preparing', message: null });
    const file = await prepareForUpload(picked, entry.kind);
    this._patchUpload(entry.id, { state: 'uploading', name: file.name });

    const attached =
      entry.kind === 'manual' ? manuals(this.current?.attachments) : pictures(this.current?.attachments);
    const refused = this._preflight(file, entry.kind, attached.length);
    if (refused) {
      this._patchUpload(entry.id, { state: 'error', message: refused });
      return;
    }
    try {
      this._uploaded = await media.upload(item.id, file, entry.kind);
      this._uploads = this._uploads.filter((u) => u.id !== entry.id);
    } catch (err) {
      this._patchUpload(entry.id, { state: 'error', message: errorText(err) });
    }
  }

  /** Move one attachment within its kind; `-Infinity` makes a picture the cover (position 0). */
  private async _moveAttachment(attachmentId: string, kind: AttachmentKind, delta: number) {
    const media = this.media;
    const item = this.current;
    if (!media || !item) return;
    const ordered = (kind === 'manual' ? manuals : pictures)(item.attachments).map((a) => a.id);
    const from = ordered.indexOf(attachmentId);
    if (from < 0) return;
    const to = Math.min(Math.max(from + delta, 0), ordered.length - 1);
    if (to === from) return;
    ordered.splice(from, 1);
    ordered.splice(to, 0, attachmentId);
    try {
      this._uploaded = await media.reorder(item.id, kind, ordered);
    } catch (err) {
      this._pushUploadError('reorder', kind, t('hv.editor.upload.reorderPhotos'), err);
    }
  }

  /** Delete one attachment, once `_confirmRemove` has been answered. */
  private async _removeAttachment(attachmentId: string, kind: AttachmentKind) {
    const media = this.media;
    const item = this.current;
    if (!media || !item) return;
    try {
      this._uploaded = await media.remove(item.id, attachmentId);
      // The confirm's opener was this tile's remove button, now gone.
      await this.updateComplete;
      if (focusStranded()) this._emit('focus-stranded');
    } catch (err) {
      this._pushUploadError(
        'remove',
        kind,
        kind === 'manual' ? t('hv.editor.upload.removeDocument') : t('hv.editor.upload.removePhoto'),
        err,
      );
    }
  }

  /**
   * Move and cover buttons under one thumbnail, keyboard-usable like the
   * organize dialog's. The star is inert on the cover and a button elsewhere.
   */
  private _renderPhotoControls(attachmentId: string, index: number, total: number) {
    const move = (delta: number) => () => void this._moveAttachment(attachmentId, 'picture', delta);
    return html`<div class="tile-controls">
      <button
        data-testid="editor-photo-earlier"
        aria-label=${t('hv.editor.movePhotoEarlier', { position: index + 1 })}
        ?disabled=${index === 0}
        @click=${move(-1)}
      >
        ${icon('chevronLeft', 15)}
      </button>
      ${
        index === 0
          ? html`<span
            class="is-cover"
            data-testid="editor-photo-cover"
            title=${t('hv.editor.coverPhoto')}
            >${icon('star', 14)}</span
          >`
          : html`<button
            data-testid="editor-photo-make-cover"
            aria-label=${t('hv.editor.makePhotoCover', { position: index + 1 })}
            title=${t('hv.editor.makeCover')}
            @click=${move(-Infinity)}
          >
            ${icon('star', 14)}
          </button>`
      }
      <button
        data-testid="editor-photo-later"
        aria-label=${t('hv.editor.movePhotoLater', { position: index + 1 })}
        ?disabled=${index === total - 1}
        @click=${move(1)}
      >
        ${icon('chevronRight', 15)}
      </button>
    </div>`;
  }

  /** The photos already attached and the picker; only for a saved item, which has an id. */
  private _renderPictures() {
    const item = this.current;
    if (!item || !this.media) return null;
    const shots = pictures(item.attachments);
    const accepted = this.mediaConfig?.picture_mime_types.join(',') ?? 'image/*';

    const drop = this._dropBindings('picture');
    return html`<div class="section">
      <span class="hv-label">${t('hv.editor.photos')}</span>
      <div
        class="photos ${!this.mobile && this._dropTarget === 'picture' ? 'dropping' : ''}"
        data-testid="editor-photos"
        @dragover=${drop.over}
        @dragleave=${drop.leave}
        @drop=${drop.drop}
      >
        ${shots.map((picture, index) => {
          const alt = pictureAlt(item.name, index, shots.length);
          const missing = this._urls.presence(item.id, picture.id) === 'missing';
          // The thumbnail; the lightbox asks for the stored file itself.
          const src = missing
            ? null
            : this._urls.get(item.id, picture.id, attachmentNameToken(picture), MEDIA_VARIANT_THUMB);
          return renderPhotoFigure(
            {
              src,
              missing,
              alt,
              openLabel: t('hv.editor.viewPhoto', { photo: alt }),
              onOpen: () => {
                this._lightbox = index;
              },
            },
            {
              testid: 'editor-photo',
              glyph: 20,
              tileClass: 'placeholder',
              openClass: 'open',
              pendingTile: true,
            },
            html`<button
                class="remove"
                data-testid="editor-photo-remove"
                aria-label=${t('hv.editor.removePhoto', { photo: alt })}
                @click=${() => {
                  this._confirmRemove = { id: picture.id, kind: 'picture' };
                }}
              >
                ${icon('close', 15)}
              </button>
              ${shots.length > 1 ? this._renderPhotoControls(picture.id, index, shots.length) : null}`,
          );
        })}
        <!-- Two inputs on a phone: capture="environment" opens the camera with
             no way to the library, so the library needs its own. -->
        ${
          this.mobile
            ? html`<label class="picker" data-testid="editor-photo-camera">
              ${icon('camera', 20)}
              <span>${t('hv.editor.takePhoto')}</span>
              <input
                class="reveal"
                type="file"
                accept=${accepted}
                capture="environment"
                data-testid="editor-photo-camera-input"
                @change=${(e: Event) => this._onPicked(e, 'picture')}
              />
            </label>`
            : null
        }
        <label class="picker" data-testid="editor-photo-picker">
          ${icon('image', 20)}
          <span>${t('hv.editor.addPhoto')}</span>
          <input
            class="reveal"
            type="file"
            accept=${accepted}
            multiple
            data-testid="editor-photo-input"
            @change=${(e: Event) => this._onPicked(e, 'picture')}
          />
        </label>
      </div>
      ${this._renderUploadList('picture')}
    </div>`;
  }

  /** Hand the picked files to the queue and let the same file be picked again. */
  private _onPicked(e: Event, kind: AttachmentKind) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Cleared so picking the same file twice still fires `change`.
    input.value = '';
    void this._uploadFiles(files, kind);
  }

  /**
   * Attach dropped files, each routed by its own type rather than where it
   * landed: pictures first, then manuals, so the two queues never interleave.
   */
  private async _onDrop(e: DragEvent) {
    e.preventDefault();
    this._dropTarget = null;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const pictureFiles = files.filter((f) => f.type.startsWith('image/'));
    const manualFiles = files.filter((f) => !f.type.startsWith('image/'));
    if (pictureFiles.length) await this._uploadFiles(pictureFiles, 'picture');
    if (manualFiles.length) await this._uploadFiles(manualFiles, 'manual');
  }

  /** A section's drop-target listeners, or none on a phone (Lit drops `undefined` ones). */
  private _dropBindings(kind: AttachmentKind) {
    if (this.mobile) return { over: undefined, leave: undefined, drop: undefined };
    return {
      over: (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        this._dropTarget = kind;
      },
      leave: () => {
        if (this._dropTarget === kind) this._dropTarget = null;
      },
      drop: (e: DragEvent) => void this._onDrop(e),
    };
  }

  /** Rename one document, on `change` so typing is not a command per keystroke. */
  private async _retitle(attachmentId: string, title: string) {
    const media = this.media;
    const item = this.current;
    if (!media || !item) return;
    try {
      this._uploaded = await media.retitle(item.id, attachmentId, title);
    } catch (err) {
      this._pushUploadError('retitle', 'manual', t('hv.editor.upload.renameDocument'), err);
    }
  }

  /**
   * The documents already attached, each with a title field that falls back to
   * the filename, and the picker that adds one (no `capture`: a document comes
   * from the file system).
   */
  private _renderDocuments() {
    const item = this.current;
    if (!item || !this.media) return null;
    const docs = manuals(item.attachments);
    const accepted = this.mediaConfig?.manual_mime_types?.join(',') ?? 'application/pdf';

    const drop = this._dropBindings('manual');
    return html`<div class="section">
      <span class="hv-label">${t('hv.field.documents')}</span>
      <ul
        class="documents ${!this.mobile && this._dropTarget === 'manual' ? 'dropping' : ''}"
        data-testid="editor-documents"
        @dragover=${drop.over}
        @dragleave=${drop.leave}
        @drop=${drop.drop}
      >
        ${docs.map((doc) =>
          renderDocumentRow(
            {
              src: this._urls.get(item.id, doc.id, attachmentNameToken(doc)),
              missing: this._urls.presence(item.id, doc.id) === 'missing',
            },
            {
              testid: 'editor-document',
              glyph: 18,
              openLabel: t('hv.editor.openNamed', { name: attachmentTitle(doc) }),
              openTitle: t('hv.editor.openDocument'),
            },
            html`<input
                class="hv-input doc-title"
                data-testid="editor-document-title"
                .value=${doc.title}
                placeholder=${doc.filename}
                aria-label=${t('hv.editor.titleFor', { filename: doc.filename })}
                @change=${(e: Event) => void this._retitle(doc.id, (e.target as HTMLInputElement).value.trim())}
              />
              <span class="doc-size">${formatBytes(doc.size)}</span>`,
            html`<button
              class="doc-remove"
              data-testid="editor-document-remove"
              aria-label=${t('hv.editor.removeNamed', { name: attachmentTitle(doc) })}
              @click=${() => {
                this._confirmRemove = { id: doc.id, kind: 'manual' };
              }}
            >
              ${icon('close', 15)}
            </button>`,
          ),
        )}
      </ul>
      <label class="picker doc-picker" data-testid="editor-manual-picker">
        ${icon('fileDocument', 18)}
        <span>${t('hv.editor.addManual')}</span>
        <input
          class="reveal"
          type="file"
          accept=${accepted}
          multiple
          data-testid="editor-manual-input"
          @change=${(e: Event) => this._onPicked(e, 'manual')}
        />
      </label>
      ${this._renderUploadList('manual')}
    </div>`;
  }

  /** The upload queue for one kind, under the section it is filling. */
  private _renderUploadList(kind: AttachmentKind) {
    const entries = this._uploads.filter((u) => u.kind === kind);
    if (!entries.length) return null;
    const glyph = kind === 'manual' ? 'fileDocument' : 'camera';
    return html`<ul class="upload-list" data-testid="editor-upload-list" data-kind=${kind}>
      ${entries.map(
        (entry) => html`<li
          class=${entry.state === 'error' ? 'failed' : ''}
          data-testid="editor-upload"
          data-state=${entry.state}
        >
          <span class="kind">${icon(glyph, 14)}</span>
          <span class="file">${entry.name}</span>
          <span class="state"
            >${entry.state === 'error' ? entry.message : t(`hv.editor.upload.state.${entry.state}`)}</span
          >
          ${
            entry.state === 'error'
              ? html`${
                  entry.file
                    ? html`<button
                      class="retry"
                      data-testid="editor-upload-retry"
                      aria-label=${t('hv.editor.upload.retryNamed', { name: entry.name })}
                      @click=${() => void this._sendOne(entry)}
                    >
                      ${t('hv.action.repeat')}
                    </button>`
                    : null
                }
                <button
                  class="dismiss"
                  data-testid="editor-upload-dismiss"
                  aria-label=${t('hv.editor.upload.dismissNamed', { name: entry.name })}
                  @click=${() => {
                    this._uploads = this._uploads.filter((u) => u.id !== entry.id);
                  }}
                >
                  ${icon('close', 13)}
                </button>`
              : html`<span
                class="progress"
                role="progressbar"
                aria-label=${t('hv.editor.upload.progress', {
                  name: entry.name,
                  state: entry.state,
                })}
                data-testid="editor-upload-progress"
                ><span class="fill"></span
              ></span>`
          }
        </li>`,
      )}
    </ul>`;
  }

  /**
   * Ctrl/Cmd+Enter saves the form, and the form hears keys from everything
   * inside this element. Neither overlay is part of the form, so the chord
   * stops here; every other key, Tab included, still reaches a host's focus trap.
   */
  private _stopSaveChord(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.stopPropagation();
  }

  override render() {
    const removing = removeCopy(this._confirmRemove?.kind ?? 'picture');
    return html`
      ${this._renderPictures()} ${this._renderDocuments()}

      <!-- Out of the grid's flow, and outside the form's own keys. -->
      <div class="overlays" @keydown=${this._stopSaveChord}>
        ${renderLightboxHost({
          testid: 'editor-lightbox-host',
          item: this.current,
          media: this.media,
          index: this._lightbox,
          onOpenerGone: () => this._emit('focus-stranded'),
          onClose: () => {
            this._lightbox = null;
          },
        })}

        <!-- Its events stop here, or its cancel would read to the host as "close
             the form". Fixed to the window, so it follows the viewport's width. -->
        <hv-confirm
          data-testid="editor-remove-confirm"
          ?open=${this._confirmRemove !== null}
          ?mobile=${this._viewport.narrow}
          .heading=${removing.heading}
          .message=${removing.message}
          .confirmLabel=${t('hv.action.remove')}
          destructive
          @confirm=${(e: HvEvent<'hv-confirm', 'confirm'>) => {
            e.stopPropagation();
            const target = this._confirmRemove;
            this._confirmRemove = null;
            if (target) void this._removeAttachment(target.id, target.kind);
          }}
          @cancel=${(e: HvEvent<'hv-confirm', 'cancel'>) => {
            e.stopPropagation();
            this._confirmRemove = null;
          }}
        ></hv-confirm>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-editor-attachments': HVEditorAttachments;
  }
}
