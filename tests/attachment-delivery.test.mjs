import test from 'node:test';
import assert from 'node:assert/strict';
import { createDicomArchive, MAX_ATTACHMENT_BYTES } from '../docs/attachments.js';
import { handoffDicomEmail } from '../docs/attachment-delivery.js';

const metadata = {
  reference: 'LGE-12345678-1234-4234-8234-1234567890ab',
  createdAt: '2026-10-24T01:23:45.678Z',
};
const archive = await createDicomArchive({
  SAX: new File([new Uint8Array([0, 255, 1, 128, 42])], 'private-original-sax.dcm'),
  T1: new File([new Uint8Array([20, 0, 15])], 'private-original-t1.dcm'),
  LGE: new File([new Uint8Array([4, 8, 9, 0])], 'private-original-lge.dcm'),
}, metadata);
const applicantDetails = {
  applicantEmail: 'researcher@example.org',
  project: 'External validation study',
  sample: 'STUDY-001',
  purpose: 'Paired external evaluation',
  phase: 'Continuous 25-frame cine',
};
const input = () => ({ ...metadata, ...applicantDetails, archive });

function browser({ blocked = false, submitThrows = false, openerThrows = false, assignmentThrows = false } = {}) {
  const opened = [], submitted = [], nodes = [];
  const popup = { closed: false, opener: {}, close() { this.closed = true; } };
  if (openerThrows) Object.defineProperty(popup, 'opener', { get() { return {}; }, set() { throw new Error('denied'); } });
  const documentImpl = {
    body: { appendChild(node) { node.connected = true; return node; } },
    createElement(tag) {
      const node = {
        tag, style: {}, children: [], connected: false,
        appendChild(child) { this.children.push(child); return child; },
        remove() { this.connected = false; this.removed = true; },
      };
      if (tag === 'input' && assignmentThrows) {
        Object.defineProperty(node, 'files', { set() { throw new Error('FileList rejected'); } });
      }
      if (tag === 'form') node.submit = function () {
        assert.equal(this.connected, true, 'Native form is attached before submitting.');
        assert.equal(popup.opener, null, 'Opener is detached before external navigation.');
        assert.equal(this.target, opened[0].target, 'Submission uses the opened tab.');
        if (submitThrows) throw new Error('Native submit unavailable');
        submitted.push(this);
      };
      nodes.push(node);
      return node;
    },
  };
  class DataTransfer {
    files = [];
    items = { add: file => this.files.push(file) };
  }
  const windowImpl = {
    Blob, File, DataTransfer,
    location: { href: 'https://guantianhuangg.github.io/synthetic-lge-portal/' },
    open(url, target) { opened.push({ url, target }); return blocked ? null : popup; },
  };
  return { documentImpl, windowImpl, opened, submitted, popup, nodes };
}

test('native multipart handoff contains one ZIP with identical binary bytes and a closed field set', async () => {
  const mock = browser();
  const result = handoffDicomEmail(input(), mock);
  assert.equal(result.status, 'handoff');
  assert.match(result.message, /not confirmed/);
  assert.equal(mock.opened.length, 1);
  assert.equal(mock.opened[0].url, 'about:blank');
  assert.equal(mock.submitted.length, 1);
  const form = mock.submitted[0];
  assert.equal(form.action, 'https://formsubmit.co/huanggt37@163.com');
  assert.equal(form.method, 'POST');
  assert.equal(form.enctype, 'multipart/form-data');
  assert.equal(form.removed, true);
  assert.equal(mock.popup.closed, false);
  const fields = Object.fromEntries(form.children.map(field => [field.name, field]));
  assert.deepEqual(Object.keys(fields).sort(), [
    '_subject', '_template', '_url', '_replyto', 'email', 'applicant_email', 'project', 'sample', 'purpose', 'phase',
    'notification_reference', 'event', 'created_at', 'notice', 'attachment',
  ].sort());
  assert.equal(fields._subject.value, 'Synthetic LGE — Application with DICOM files');
  assert.equal(fields._template.value, 'table');
  assert.equal(fields._url.value, 'https://guantianhuangg.github.io/synthetic-lge-portal/');
  assert.equal(fields.notification_reference.value, metadata.reference);
  assert.equal(fields.created_at.value, metadata.createdAt);
  assert.equal(fields.event.value, 'application_submitted');
  assert.equal(fields._replyto.value, applicantDetails.applicantEmail);
  assert.equal(fields.email.value, applicantDetails.applicantEmail);
  assert.equal(fields.applicant_email.value, applicantDetails.applicantEmail);
  for (const field of ['project', 'sample', 'purpose', 'phase']) {
    assert.equal(fields[field].value, applicantDetails[field]);
  }
  assert.match(fields.notice.value, /does not de-identify/);
  assert.match(fields.notice.value, /manual review/);
  assert.equal(fields.attachment.type, 'file');
  assert.equal(fields.attachment.value, undefined, 'ZIP is not a JSON or base64 text field.');
  assert.equal(fields.attachment.files.length, 1);
  const file = fields.attachment.files[0];
  assert.equal(file.name, `${metadata.reference}-DICOM.zip`);
  assert.equal(file.type, 'application/zip');
  assert.equal(file.size, archive.bytes);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(await archive.blob.arrayBuffer()));
});

test('only the canonical published portal may open the email service or upload files', () => {
  for (const href of [
    'http://127.0.0.1:4174/synthetic-lge-portal/',
    'http://localhost:4174/synthetic-lge-portal/',
    'https://synthetic-lge-research-portal.silly-elk-6696.chatgpt.site/',
    'https://example.org/synthetic-lge-portal/',
    'http://guantianhuangg.github.io/synthetic-lge-portal/',
    'https://guantianhuangg.github.io/other-project/',
    'https://guantianhuangg.github.io/synthetic-lge-portal/nested/',
    'https://guantianhuangg.github.io/synthetic-lge-portal/nested/index.html',
    'https://guantianhuangg.github.io/synthetic-lge-portal/index.html/',
    'https://guantianhuangg.github.io/synthetic-lge-portal//',
    'https://guantianhuangg.github.io.evil.example/synthetic-lge-portal/',
    undefined,
  ]) {
    const mock = browser();
    mock.windowImpl.location = { href };
    const result = handoffDicomEmail(input(), mock);
    assert.equal(result.status, 'failed');
    assert.match(result.message, /preview/);
    assert.equal(mock.opened.length, 0);
    assert.equal(mock.submitted.length, 0);
  }
  for (const href of [
    'https://guantianhuangg.github.io/synthetic-lge-portal/',
    'https://guantianhuangg.github.io/synthetic-lge-portal',
    'https://guantianhuangg.github.io/synthetic-lge-portal/?source=link#apply',
    'https://guantianhuangg.github.io/synthetic-lge-portal/index.html',
    'https://guantianhuangg.github.io/synthetic-lge-portal/index.html?source=link#apply',
  ]) {
    const mock = browser();
    mock.windowImpl.location = { href };
    assert.equal(handoffDicomEmail(input(), mock).status, 'handoff');
    assert.equal(mock.submitted.length, 1);
  }
});

test('missing or invalid applicant metadata cannot open a tab or POST an attachment', () => {
  const invalidFields = [
    ['applicantEmail', undefined], ['applicantEmail', ''], ['applicantEmail', 'not-an-email'],
    ['applicantEmail', 'valid@example.org\r\nBcc:someone@example.org'],
    ['applicantEmail', 'valid@example.org\n'], ['applicantEmail', 'a@example.org,b@example.org'],
    ['applicantEmail', 'a@-example.org'], ['applicantEmail', '.a@example.org'],
    ['project', ''], ['sample', undefined], ['purpose', ''], ['phase', ''],
    ['project', 'P'.repeat(121)], ['sample', 'S'.repeat(81)], ['phase', 'P'.repeat(121)],
    ['purpose', 'P'.repeat(2001)], ['sample', 'ANON\u0000ID'],
  ];
  for (const [field, value] of invalidFields) {
    const mock = browser();
    assert.equal(handoffDicomEmail({ ...input(), [field]: value }, mock).status, 'failed');
    assert.equal(mock.opened.length, 0, `Invalid ${field} must not open a tab.`);
    assert.equal(mock.submitted.length, 0, `Invalid ${field} must not submit.`);
  }
});

test('invalid references, dates, archives, filenames and size limits never open a tab or post', () => {
  const badArchives = [
    null,
    { ...archive, blob: {} },
    { ...archive, blob: new Blob(['text/plain']) },
    { ...archive, filename: '../private.zip' },
    { ...archive, filename: 'another-reference-DICOM.zip' },
    { ...archive, bytes: archive.bytes + 1 },
    { ...archive, bytes: 0 },
    { ...archive, bytes: MAX_ATTACHMENT_BYTES + 1,
      blob: new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], { type: 'application/zip' }) },
    { ...archive, entries: [] },
    { ...archive, entries: archive.entries.map((entry, i) => i ? entry : { ...entry, name: 'patient-name.dcm' }) },
  ];
  const badInputs = [
    null,
    { ...input(), reference: 'not-generated' },
    { ...input(), createdAt: '2026-10-24' },
    { ...input(), createdAt: '2026-02-30T01:23:45.678Z' },
    ...badArchives.map(value => ({ ...input(), archive: value })),
  ];
  for (const badInput of badInputs) {
    const mock = browser();
    assert.equal(handoffDicomEmail(badInput, mock).status, 'failed');
    assert.equal(mock.opened.length, 0);
    assert.equal(mock.submitted.length, 0);
  }
});

test('popup blocking causes no POST and leaves the application intact', () => {
  const mock = browser({ blocked: true });
  const result = handoffDicomEmail(input(), mock);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /Allow pop-ups/);
  assert.equal(mock.submitted.length, 0);
  assert.equal(mock.nodes.find(node => node.tag === 'form').removed, true);
});

test('unsupported file assignment fails before any popup or POST', () => {
  for (const assignmentThrows of [false, true]) {
    const mock = browser({ assignmentThrows });
    if (!assignmentThrows) delete mock.windowImpl.DataTransfer;
    assert.equal(handoffDicomEmail(input(), mock).status, 'failed');
    assert.equal(mock.opened.length, 0);
    assert.equal(mock.submitted.length, 0);
  }
});

test('opener protection failure and native submission failure are not reported as handoffs', () => {
  for (const options of [{ openerThrows: true }, { submitThrows: true }]) {
    const mock = browser(options);
    assert.equal(handoffDicomEmail(input(), mock).status, 'failed');
    assert.equal(mock.submitted.length, 0);
    assert.equal(mock.popup.closed, true);
    assert.equal(mock.nodes.find(node => node.tag === 'form').removed, true);
  }
});

test('explicit later attempts get separate target names', () => {
  const first = browser(), second = browser();
  assert.equal(handoffDicomEmail(input(), first).status, 'handoff');
  assert.equal(handoffDicomEmail(input(), second).status, 'handoff');
  assert.notEqual(first.opened[0].target, second.opened[0].target);
});
