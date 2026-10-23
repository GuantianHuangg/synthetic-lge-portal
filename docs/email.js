// Official integration references (no credentials are embedded):
// https://formsubmit.co/ajax-documentation
// https://formsubmit.co/documentation
// https://formsubmit.co/help
// This endpoint receives only synthetic demo event metadata, never application
// form fields, image files, DICOM metadata, or patient information.
export const EMAIL_RECIPIENT = 'huanggt37@163.com';
const EMAIL_ENDPOINT = `https://formsubmit.co/ajax/${EMAIL_RECIPIENT}`;
const EVENTS = Object.freeze({
  application_submitted: 'Demo application submitted',
  agreement_confirmed: 'Demo agreement confirmed',
  results_preview: 'Demo results preview opened',
});
const REFERENCE_PATTERN = /^LGE-DEMO-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_INPUT_KEYS = new Set(['reference', 'event', 'createdAt']);
const MESSAGES = Object.freeze({
  accepted: 'The email service accepted the notification request. Recipient activation may still be required; inbox delivery is not verified.',
  activation_required: `Recipient activation is required. Check ${EMAIL_RECIPIENT} for the confirmation email, including the spam folder.`,
  unknown: 'The notification status could not be confirmed. It may have been accepted; retrying could send a duplicate.',
  failed: 'The email service rejected the notification request. The demo application remains available.',
  invalid: 'Notification details are invalid. No email request was sent.',
});

/** Generate an identifier unrelated to any application or patient field. */
export function createNotificationReference() {
  const cryptoApi = globalThis.crypto;
  let uuid;
  if (typeof cryptoApi?.randomUUID === 'function') {
    uuid = cryptoApi.randomUUID();
  } else if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } else {
    throw new Error('Secure notification identifiers are unavailable in this browser.');
  }
  return `LGE-DEMO-${uuid}`;
}

/** Build an explicit, closed payload. Extra fields are rejected, not serialized. */
export function buildNotification(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new TypeError('Notification details must be a plain object.');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 3 || keys.some(key => !ALLOWED_INPUT_KEYS.has(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'))) {
    throw new TypeError('Only reference, event, and createdAt are accepted.');
  }
  const { reference, event, createdAt } = input;
  if (typeof reference !== 'string' || !REFERENCE_PATTERN.test(reference)) {
    throw new TypeError('A generated demo notification reference is required.');
  }
  if (typeof event !== 'string' || !Object.hasOwn(EVENTS, event)) {
    throw new TypeError('An approved demo event is required.');
  }
  if (typeof createdAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)
      || !Number.isFinite(Date.parse(createdAt))
      || new Date(createdAt).toISOString() !== createdAt) {
    throw new TypeError('A canonical UTC creation timestamp is required.');
  }
  return {
    _subject: `Synthetic LGE demo — ${EVENTS[event]}`,
    _template: 'table',
    notification_reference: reference,
    event,
    created_at: createdAt,
    notice: 'DEMO ONLY. This is a synthetic workflow notification. No application details, images, DICOM metadata, patient information, or signed documents are included.',
  };
}

function result(status) {
  return { status, message: MESSAGES[status] };
}

function needsActivation(data) {
  const serviceMessage = [data.message, data.error]
    .filter(value => typeof value === 'string').join(' ');
  // Used only for classification. Never render arbitrary service text in the UI.
  return /activation (?:is )?required|(?:activate|confirm|verify) (?:your |the )?(?:email(?: address)?|form)|(?:sent|send|sending).{0,80}(?:activation|confirmation|verification) (?:email|link)|(?:check|open).{0,60}(?:activation|confirmation|verification)/i.test(serviceMessage);
}

/**
 * Make one attempt only. Acknowledgment is not an inbox delivery receipt.
 * Reuse the same reference on an explicit retry; the service does not document
 * idempotency, so retries after an ambiguous response can create duplicate mail.
 * _captcha is deliberately omitted. The vendor's AJAX example does not disable
 * it, but the documentation does not promise an interactive AJAX CAPTCHA flow.
 */
export async function sendNotification(input, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  let payload;
  try {
    payload = buildNotification(input);
    if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('Invalid transport settings.');
    }
  } catch {
    return { status: 'failed', message: MESSAGES.invalid };
  }

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Notification timeout.'));
    }, timeoutMs);
  });
  const request = async () => {
    const response = await fetchImpl(EMAIL_ENDPOINT, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) return result('failed');
    let data;
    try { data = await response.json(); }
    catch { return result('unknown'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return result('unknown');
    const positive = data.success === true || data.success === 'true';
    const negative = data.success === false || data.success === 'false';
    if ((positive || negative) && needsActivation(data)) return result('activation_required');
    if (positive) return result('accepted');
    if (negative) return result('failed');
    return result('unknown');
  };
  try {
    return await Promise.race([request(), timeout]);
  } catch {
    // A network failure/timeout can happen after submission reached the service.
    return result('unknown');
  } finally {
    clearTimeout(timer);
  }
}
