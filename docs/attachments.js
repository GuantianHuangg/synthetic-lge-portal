/**
 * Build a ZIP attachment locally without a dependency or network request.
 * DICOM bytes are copied unchanged: this module does NOT anonymize files or
 * inspect patient metadata. Only submit files already approved for this channel.
 * Original filenames are never included in the archive or its manifest.
 */
export const MAX_ATTACHMENT_BYTES = 10_000_000;

const ROLES = Object.freeze([
  { role: 'SAX', name: 'SAX.dcm' },
  { role: 'T1', name: 'T1_mapping.dcm' },
  { role: 'LGE', name: 'LGE_reference.dcm' },
]);
const REFERENCE_PATTERN = /^LGE-(?:DEMO-)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, number) => {
  let value = number;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    throw new TypeError(`${label} must contain exactly ${keys.join(', ')}.`);
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function attachmentTooLarge() {
  return new RangeError('The complete ZIP attachment must be 10 MB or smaller (10,000,000 bytes).');
}

function zipHeader(entry, central, offset = 0) {
  const name = encoder.encode(entry.name);
  const bytes = new Uint8Array((central ? 46 : 30) + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, central ? 0x02014b50 : 0x04034b50, true);
  if (central) view.setUint16(4, 20, true); // Version made by: ZIP 2.0, MS-DOS.
  const base = central ? 6 : 4;
  view.setUint16(base, 20, true); // Version needed.
  view.setUint16(base + 2, 0x0800, true); // UTF-8 names; no data descriptor.
  view.setUint16(base + 4, 0, true); // STORE: preserve original bytes.
  view.setUint16(base + 6, 0, true); // Fixed time; creation time is in manifest.
  view.setUint16(base + 8, 0x0021, true); // 1980-01-01, valid DOS date.
  view.setUint32(base + 10, entry.crc, true);
  view.setUint32(base + 14, entry.data.byteLength, true);
  view.setUint32(base + 18, entry.data.byteLength, true);
  view.setUint16(base + 22, name.length, true);
  if (central) view.setUint32(42, offset, true);
  bytes.set(name, central ? 46 : 30);
  return bytes;
}

/**
 * @param {{SAX: File, T1: File, LGE: File}} filesByRole Selected, prechecked files.
 * @param {{reference: string, createdAt: string}} metadata Generated reference/time.
 * @returns {Promise<{blob: Blob, filename: string, bytes: number, entries: Array<{name: string, bytes: number}>}>}
 * A closed manifest contains only generated reference/time and role/byte counts.
 * No application form fields or original filenames are copied into it.
 */
export async function createDicomArchive(filesByRole, metadata) {
  exactObject(filesByRole, ROLES.map(({ role }) => role), 'Files');
  exactObject(metadata, ['reference', 'createdAt'], 'Archive metadata');
  const { reference, createdAt } = metadata;
  if (typeof reference !== 'string' || !REFERENCE_PATTERN.test(reference)) {
    throw new TypeError('A generated application reference is required.');
  }
  if (typeof createdAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)
      || !Number.isFinite(Date.parse(createdAt))
      || new Date(createdAt).toISOString() !== createdAt) {
    throw new TypeError('A canonical UTC creation timestamp is required.');
  }

  const selected = ROLES.map(({ role, name }) => {
    const file = filesByRole[role];
    const size = file?.size;
    if (!file || !Number.isSafeInteger(size) || size <= 0
        || typeof file.arrayBuffer !== 'function') {
      throw new TypeError(`${role} must be a nonempty selected file.`);
    }
    return { role, name, file, size };
  });
  // Reject oversized objects before arrayBuffer() can allocate or read data.
  let payloadBytes = 0;
  for (const entry of selected) {
    if (entry.size > MAX_ATTACHMENT_BYTES - payloadBytes) throw attachmentTooLarge();
    payloadBytes += entry.size;
  }
  const manifest = encoder.encode(JSON.stringify({
    reference,
    createdAt,
    files: selected.map(({ role, size }) => ({ role, bytes: size })),
  }, null, 2) + '\n');
  const allNames = [...selected.map(({ name }) => name), 'manifest.json'];
  // Each entry has a local header, central header and two copies of its name.
  const zipBytes = payloadBytes + manifest.length + 22
    + allNames.reduce((total, name) => total + 76 + encoder.encode(name).length * 2, 0);
  if (zipBytes > MAX_ATTACHMENT_BYTES) throw attachmentTooLarge();

  const entries = [];
  for (const { name, file, size } of selected) {
    const buffer = await file.arrayBuffer();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== size) {
      throw new TypeError('A selected file changed or could not be read completely.');
    }
    const data = new Uint8Array(buffer);
    entries.push({ name, data, crc: crc32(data) });
  }
  entries.push({ name: 'manifest.json', data: manifest, crc: crc32(manifest) });

  const localParts = [];
  const centralParts = [];
  let localBytes = 0;
  for (const entry of entries) {
    const local = zipHeader(entry, false);
    centralParts.push(zipHeader(entry, true, localBytes));
    localParts.push(local, entry.data);
    localBytes += local.byteLength + entry.data.byteLength;
  }
  const centralBytes = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes, true);
  endView.setUint32(16, localBytes, true);
  const blob = new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  if (blob.size !== zipBytes || blob.size > MAX_ATTACHMENT_BYTES) throw attachmentTooLarge();
  return {
    blob,
    filename: `${reference}-DICOM.zip`,
    bytes: blob.size,
    entries: entries.map(({ name, data }) => ({ name, bytes: data.byteLength })),
  };
}
