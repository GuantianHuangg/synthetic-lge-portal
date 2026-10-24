import { buildNotification } from './email.js';
import { MAX_ATTACHMENT_BYTES } from './attachments.js';

const ENDPOINT = 'https://formsubmit.co/huanggt37@163.com';
const ENTRY_NAMES = ['SAX.dcm', 'T1_mapping.dcm', 'LGE_reference.dcm', 'manifest.json'];
const MESSAGES = Object.freeze({
  handoff: 'The DICOM email submission opened in a separate tab. Complete any FormSubmit verification or recipient activation there. Inbox and attachment delivery are not confirmed; do not resend unless needed.',
  invalid: 'The prepared DICOM attachment is invalid or exceeds the 10 MB email limit. No upload was started.',
  unsupported: 'This browser could not prepare a file attachment for email. No upload was started. Use a current browser and prepare the package again.',
  blocked: 'The email submission tab could not be opened. Allow pop-ups for this site, then try again. No upload was started.',
  failed: 'The browser could not hand the attachment to the email service. Delivery is not confirmed. Keep this application open and check the submission tab before retrying.',
});
let handoffSequence = 0;

function failure(message) { return { status: 'failed', message }; }

function validArchive(archive, reference, BlobImpl) {
  return typeof BlobImpl === 'function' && archive?.blob instanceof BlobImpl
    && archive.blob.type === 'application/zip'
    && archive.filename === `${reference}-DICOM.zip`
    && Number.isSafeInteger(archive.bytes) && archive.bytes > 0
    && archive.bytes === archive.blob.size && archive.bytes <= MAX_ATTACHMENT_BYTES
    && Array.isArray(archive.entries) && archive.entries.length === ENTRY_NAMES.length
    && archive.entries.every((entry, index) => entry?.name === ENTRY_NAMES[index]
      && Number.isSafeInteger(entry.bytes) && entry.bytes > 0);
}

/**
 * Call synchronously from the user's Send click, after createDicomArchive resolves.
 * Native multipart submission keeps file bytes binary and lets the provider show
 * its own verification flow. A handoff is never an inbox-delivery receipt.
 */
export function handoffDicomEmail(input, {
  documentImpl = globalThis.document,
  windowImpl = globalThis.window,
} = {}) {
  let metadata;
  try {
    metadata = buildNotification({
      reference: input?.reference,
      event: 'application_submitted',
      createdAt: input?.createdAt,
    });
    if (!validArchive(input?.archive, input.reference, windowImpl?.Blob)) {
      return failure(MESSAGES.invalid);
    }
  } catch {
    return failure(MESSAGES.invalid);
  }

  if (!documentImpl?.body || typeof documentImpl.createElement !== 'function'
      || typeof windowImpl?.open !== 'function'
      || typeof windowImpl.File !== 'function' || typeof windowImpl.DataTransfer !== 'function') {
    return failure(MESSAGES.unsupported);
  }

  let form;
  try {
    form = documentImpl.createElement('form');
    form.action = ENDPOINT;
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    form.style.display = 'none';
    const fields = {
      _subject: 'Synthetic LGE — Application with DICOM files',
      _template: 'table',
      notification_reference: metadata.notification_reference,
      event: metadata.event,
      created_at: metadata.created_at,
      notice: 'Contains the three original, user-selected SAX, T1 mapping, and reference LGE DICOM files in one ZIP. Research demonstration only; no model inference or clinical interpretation occurred. The portal does not de-identify these files.',
    };
    for (const [name, value] of Object.entries(fields)) {
      const field = documentImpl.createElement('input');
      field.type = 'hidden';
      field.name = name;
      field.value = value;
      form.appendChild(field);
    }
    const attachment = documentImpl.createElement('input');
    attachment.type = 'file';
    attachment.name = 'attachment';
    const transfer = new windowImpl.DataTransfer();
    transfer.items.add(new windowImpl.File([input.archive.blob], input.archive.filename, {
      type: 'application/zip',
    }));
    attachment.files = transfer.files;
    if (attachment.files.length !== 1 || attachment.files[0].size !== input.archive.bytes) {
      throw new Error('Attachment assignment failed.');
    }
    form.appendChild(attachment);
  } catch {
    form?.remove();
    return failure(MESSAGES.unsupported);
  }

  let popup;
  try {
    // Open first so a blocked popup cannot silently turn into an upload attempt.
    // Detach the opener while about:blank is same-origin, before navigation.
    const target = `lge_dicom_${input.reference}_${++handoffSequence}`;
    popup = windowImpl.open('about:blank', target);
    if (!popup || popup.closed) return failure(MESSAGES.blocked);
    popup.opener = null;
    if (popup.opener !== null) throw new Error('Unable to detach opener.');
    form.target = target;
    documentImpl.body.appendChild(form);
    form.submit();
    return { status: 'handoff', message: MESSAGES.handoff };
  } catch {
    try { popup?.close(); } catch { /* No cross-origin inspection is needed. */ }
    return failure(MESSAGES.failed);
  } finally {
    form.remove();
  }
}
