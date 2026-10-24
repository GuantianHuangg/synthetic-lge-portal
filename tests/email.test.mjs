import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotification, createNotificationReference, EMAIL_FORM_URL, isValidApplicantEmail, sendNotification } from '../docs/email.js';

const input = () => ({
  reference: 'LGE-DEMO-12345678-1234-4234-8234-1234567890ab',
  event: 'application_submitted',
  createdAt: '2026-10-24T01:23:45.678Z',
  applicantEmail: ' researcher+lge@example.org ',
  project: ' External validation study ',
  sample: ' STUDY-001 ',
  purpose: 'Paired external evaluation',
  phase: 'Continuous 25-frame cine',
});

test('new references use LGE while legacy LGE-DEMO references still validate', () => {
  const reference = createNotificationReference();
  assert.match(reference, /^LGE-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(buildNotification({ ...input(), reference }).notification_reference, reference);
  assert.equal(buildNotification(input()).notification_reference, input().reference);
});

test('email validation accepts a single ordinary mailbox and rejects header injection and malformed addresses', () => {
  for (const email of ['researcher@example.org', 'researcher+lge@example.org', ' user@163.com ', 'a@sub.example.ac.uk']) {
    assert.equal(isValidApplicantEmail(email), true, email);
  }
  for (const email of [null, undefined, 1, '', '   ', 'user', 'user@example', 'user@', '@example.org',
    'user name@example.org', 'A <user@example.org>', 'a@b.org,c@d.org', 'a@b.org;c@d.org',
    'a@example.org\r\nBcc: victim@example.org', 'a@example.org\n', 'a@ex\u0000ample.org',
    'a@example.org\u007f', 'a@example.org\u0085', 'a@@example.org', '.a@example.org',
    'a.@example.org', 'a..b@example.org', 'a@-example.org', 'a@example-.org',
    'a@ex..org', `${'a'.repeat(65)}@example.org`, `a@${'x'.repeat(64)}.org`,
    `a@${'x'.repeat(63)}.${'x'.repeat(63)}.${'x'.repeat(63)}.${'x'.repeat(63)}`]) {
    assert.equal(isValidApplicantEmail(email), false, String(email));
  }
});

test('closed notification schema includes applicant reply address and research metadata only', () => {
  const payload = buildNotification(input());
  assert.deepEqual(Object.keys(payload).sort(), [
    '_subject', '_template', '_url', '_replyto', 'email', 'applicant_email', 'project', 'sample', 'purpose', 'phase',
    'notification_reference', 'event', 'created_at', 'notice',
  ].sort());
  assert.equal(payload._replyto, 'researcher+lge@example.org');
  assert.equal(payload._url, 'https://guantianhuangg.github.io/synthetic-lge-portal/');
  assert.equal(payload.email, payload._replyto);
  assert.equal(payload.applicant_email, payload._replyto);
  assert.equal(payload.project, 'External validation study');
  assert.equal(payload.sample, 'STUDY-001');
  assert.equal(payload.purpose, input().purpose);
  assert.equal(payload.phase, input().phase);
  assert.match(payload.notice, /manual review/);
  assert.throws(() => buildNotification({ ...input(), recipient: 'other@example.org' }), TypeError);
  assert.throws(() => buildNotification({ ...input(), _cc: 'other@example.org' }), TypeError);
  const getterInput = input();
  Object.defineProperty(getterInput, 'applicantEmail', { get() { throw new Error('Getter should not run'); } });
  assert.throws(() => buildNotification(getterInput), TypeError);
});

test('form URL stays canonical across application references, events, and dates', () => {
  const original = buildNotification(input());
  const another = buildNotification({ ...input(),
    reference: 'LGE-DEMO-aaaaaaaa-1234-4234-8234-1234567890ab',
    event: 'agreement_confirmed',
    createdAt: '2026-10-25T01:23:45.678Z',
  });
  assert.equal(original._url, EMAIL_FORM_URL);
  assert.equal(another._url, EMAIL_FORM_URL);
  assert.throws(() => buildNotification({ ...input(), _url: 'https://other.example/' }), TypeError);
});

test('invalid applicant email is rejected before the notification transport is called', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('No request expected'); };
  for (const applicantEmail of [undefined, '', 'invalid', 'a@example.org\r\n_cc:other@example.org']) {
    const result = await sendNotification({ ...input(), applicantEmail }, { fetchImpl });
    assert.equal(result.status, 'failed');
  }
  assert.equal(calls, 0);
});

test('notification uses the fixed owner endpoint and does not promise inbox delivery', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ success: true }) };
  };
  const result = await sendNotification(input(), { fetchImpl });
  assert.equal(captured.url, 'https://formsubmit.co/ajax/huanggt37@163.com');
  assert.equal(captured.options.method, 'POST');
  assert.equal(JSON.parse(captured.options.body)._replyto, 'researcher+lge@example.org');
  assert.equal(result.status, 'accepted');
  assert.match(result.message, /delivery is not verified/);
});
