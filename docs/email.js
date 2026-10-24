// Official integration references (no credentials are embedded):
// https://formsubmit.co/ajax-documentation
// https://formsubmit.co/documentation
// https://formsubmit.co/help
// The applicant supplies these fields for private review and an email reply.
// Attachments use the separate native multipart transport, not this JSON endpoint.
export const EMAIL_RECIPIENT = 'huanggt37@163.com';
// FormSubmit recommends _url when cross-origin Referer omits the form path.
// Keep the public form identity independent of application IDs and UI routes.
export const EMAIL_FORM_URL = 'https://guantianhuangg.github.io/synthetic-lge-portal/';
const EMAIL_ENDPOINT = `https://formsubmit.co/ajax/${EMAIL_RECIPIENT}`;
const EVENTS = Object.freeze({
  application_submitted: 'Application submitted',
  agreement_confirmed: 'Agreement confirmed',
  results_preview: 'Results available',
});
const REFERENCE_PATTERN = /^LGE-(?:DEMO-)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_INPUT_KEYS = new Set(['reference', 'event', 'createdAt', 'applicantEmail', 'project', 'sample', 'purpose', 'phase']);
const TEXT_LIMITS = Object.freeze({ project: 120, sample: 80, purpose: 2000, phase: 120 });
const MESSAGES = Object.freeze({
  accepted: 'The email service accepted the notification request. Recipient activation may still be required; inbox delivery is not verified.',
  activation_required: 'The research team must activate the receiving mailbox. Contact the team if the submission service displays an activation notice.',
  unknown: 'The notification status could not be confirmed. It may have been accepted; retrying could send a duplicate.',
  failed: 'The email service rejected the notification request. Your application remains available in this tab.',
  invalid: 'Notification details are invalid. No email request was sent.',
});

/** Validate a single deliverable-format address, without accepting header controls. */
export function isValidApplicantEmail(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  const email = value.trim();
  if (email.length > 254 || !/^[\x21-\x7e]+$/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
      || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every(label => label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

function applicantText(input, field) {
  const value = input[field];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > TEXT_LIMITS[field]
      || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new TypeError(`A valid ${field} is required.`);
  }
  return value.trim();
}

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
  return `LGE-${uuid}`;
}

/** Build an explicit, closed payload. Extra fields are rejected, not serialized. */
export function buildNotification(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new TypeError('Notification details must be a plain object.');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== ALLOWED_INPUT_KEYS.size || keys.some(key => !ALLOWED_INPUT_KEYS.has(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'))) {
    throw new TypeError('A reference, event, createdAt, applicantEmail, project, sample, purpose, and phase are required.');
  }
  const { reference, event, createdAt } = input;
  if (typeof reference !== 'string' || !REFERENCE_PATTERN.test(reference)) {
    throw new TypeError('A generated notification reference is required.');
  }
  if (typeof event !== 'string' || !Object.hasOwn(EVENTS, event)) {
    throw new TypeError('An approved notification event is required.');
  }
  if (typeof createdAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)
      || !Number.isFinite(Date.parse(createdAt))
      || new Date(createdAt).toISOString() !== createdAt) {
    throw new TypeError('A canonical UTC creation timestamp is required.');
  }
  if (!isValidApplicantEmail(input.applicantEmail)) {
    throw new TypeError('A valid applicant email address is required.');
  }
  const applicantEmail = input.applicantEmail.trim();
  return {
    _subject: `Synthetic LGE — ${EVENTS[event]}`,
    _template: 'table',
    _url: EMAIL_FORM_URL,
    _replyto: applicantEmail,
    email: applicantEmail,
    applicant_email: applicantEmail,
    project: applicantText(input, 'project'),
    sample: applicantText(input, 'sample'),
    purpose: applicantText(input, 'purpose'),
    phase: applicantText(input, 'phase'),
    notification_reference: reference,
    event,
    created_at: createdAt,
    notice: 'External research application for manual review. Reply to the applicant email with questions, the review decision, or agreed research results. Submission does not imply approval or automatic model generation.',
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
