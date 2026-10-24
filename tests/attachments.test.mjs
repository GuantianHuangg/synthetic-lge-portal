import test from 'node:test';
import assert from 'node:assert/strict';
import { createDicomArchive, MAX_ATTACHMENT_BYTES } from '../docs/attachments.js';

const metadata = {
  reference: 'LGE-DEMO-12345678-1234-4234-8234-1234567890ab',
  createdAt: '2026-10-24T01:23:45.678Z',
};
const originalBytes = {
  SAX: Uint8Array.from({ length: 4097 }, (_, i) => i % 256),
  T1: new TextEncoder().encode('DICM\u0000synthetic T1 bytes\u00ff'),
  LGE: new Uint8Array([0, 255, 128, 42, 10, 13, 0]),
};
const files = () => Object.fromEntries(Object.entries(originalBytes).map(([role, bytes]) => [
  role, new File([bytes], 'DO_NOT_COPY_ORIGINAL_PATIENT_FILENAME.dcm'),
]));

// An independent, bit-at-a-time CRC calculation (no implementation lookup table).
function checkCrc(bytes) {
  let remainder = -1;
  for (const byte of bytes) {
    remainder ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      remainder = (remainder >>> 1) ^ (remainder & 1 ? 0xedb88320 : 0);
    }
  }
  return (remainder ^ -1) >>> 0;
}

// Read the central directory and independently locate/verify every local entry.
function readStoredZip(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  assert.equal(buffer.readUInt16LE(end + 4), 0);
  assert.equal(buffer.readUInt16LE(end + 6), 0);
  assert.equal(buffer.readUInt16LE(end + 8), buffer.readUInt16LE(end + 10));
  assert.equal(buffer.readUInt16LE(end + 20), 0);
  const count = buffer.readUInt16LE(end + 10);
  const directoryLength = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  assert.equal(directoryOffset + directoryLength, end);
  const result = new Map();
  let position = directoryOffset;
  let nextLocal = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(position), 0x02014b50);
    assert.equal(buffer.readUInt16LE(position + 8), 0x0800);
    assert.equal(buffer.readUInt16LE(position + 10), 0);
    const crc = buffer.readUInt32LE(position + 16);
    const compressed = buffer.readUInt32LE(position + 20);
    const size = buffer.readUInt32LE(position + 24);
    assert.equal(compressed, size);
    const nameLength = buffer.readUInt16LE(position + 28);
    assert.equal(buffer.readUInt16LE(position + 30), 0);
    assert.equal(buffer.readUInt16LE(position + 32), 0);
    const localOffset = buffer.readUInt32LE(position + 42);
    assert.equal(localOffset, nextLocal);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
    assert.equal(buffer.readUInt16LE(localOffset + 6), 0x0800);
    assert.equal(buffer.readUInt16LE(localOffset + 8), 0);
    assert.equal(buffer.readUInt32LE(localOffset + 14), crc);
    assert.equal(buffer.readUInt32LE(localOffset + 18), compressed);
    assert.equal(buffer.readUInt32LE(localOffset + 22), size);
    assert.equal(buffer.readUInt16LE(localOffset + 26), nameLength);
    assert.equal(buffer.readUInt16LE(localOffset + 28), 0);
    assert.equal(buffer.subarray(localOffset + 30, localOffset + 30 + nameLength).toString('utf8'), name);
    const payloadOffset = localOffset + 30 + nameLength;
    const payload = buffer.subarray(payloadOffset, payloadOffset + size);
    assert.equal(payload.length, size);
    assert.equal(checkCrc(payload), crc);
    assert.equal(result.has(name), false);
    result.set(name, payload);
    position += 46 + nameLength;
    nextLocal = payloadOffset + size;
  }
  assert.equal(position, end);
  assert.equal(nextLocal, directoryOffset);
  return result;
}

test('ZIP central/local records, byte identity, CRC and closed manifest are correct', async () => {
  const archive = await createDicomArchive(files(), metadata);
  assert.equal(archive.filename, `${metadata.reference}-DICOM.zip`);
  assert.equal(archive.blob.type, 'application/zip');
  const buffer = Buffer.from(await archive.blob.arrayBuffer());
  assert.equal(archive.bytes, buffer.length);
  const contents = readStoredZip(buffer);
  assert.deepEqual([...contents.keys()], ['SAX.dcm', 'T1_mapping.dcm', 'LGE_reference.dcm', 'manifest.json']);
  assert.deepEqual(contents.get('SAX.dcm'), Buffer.from(originalBytes.SAX));
  assert.deepEqual(contents.get('T1_mapping.dcm'), Buffer.from(originalBytes.T1));
  assert.deepEqual(contents.get('LGE_reference.dcm'), Buffer.from(originalBytes.LGE));
  const manifest = JSON.parse(contents.get('manifest.json'));
  assert.deepEqual(manifest, {
    ...metadata,
    files: Object.entries(originalBytes).map(([role, bytes]) => ({ role, bytes: bytes.length })),
  });
  assert.equal(buffer.includes(Buffer.from('DO_NOT_COPY_ORIGINAL_PATIENT_FILENAME')), false);
  assert.deepEqual(archive.entries, [...contents].map(([name, bytes]) => ({ name, bytes: bytes.length })));
});

test('oversized input and ZIP-overhead overflow fail before any file is read', async () => {
  let reads = 0;
  const fakeFile = size => ({ name: 'ignored.dcm', size, arrayBuffer() { reads++; throw Error('Must not read'); } });
  for (const firstSize of [MAX_ATTACHMENT_BYTES + 1, MAX_ATTACHMENT_BYTES - 2]) {
    await assert.rejects(createDicomArchive({
      SAX: fakeFile(firstSize), T1: fakeFile(1), LGE: fakeFile(1),
    }, metadata), /10 MB/);
  }
  assert.equal(reads, 0);
});

test('reject missing, extra, or accessor roles without reading any file', async () => {
  await assert.rejects(createDicomArchive({ SAX: files().SAX, T1: files().T1 }, metadata), /exactly/);
  await assert.rejects(createDicomArchive({ ...files(), VGE: files().LGE }, metadata), /exactly/);
  const selected = files();
  Object.defineProperty(selected, 'SAX', { get() { throw Error('Getter must not run'); } });
  await assert.rejects(createDicomArchive(selected, metadata), /exactly/);
});

test('reject invalid generated metadata and changed or empty files', async () => {
  for (const invalid of [
    { ...metadata, reference: '../private' },
    { ...metadata, createdAt: '2026-02-30T01:23:45.678Z' },
    { ...metadata, createdAt: '2026-10-24' },
    { ...metadata, patientName: 'unwanted' },
  ]) await assert.rejects(createDicomArchive(files(), invalid), TypeError);
  await assert.rejects(createDicomArchive({ ...files(), T1: new File([], 'empty.dcm') }, metadata), /nonempty/);
  await assert.rejects(createDicomArchive({
    ...files(), T1: { size: 2, arrayBuffer: async () => new ArrayBuffer(1) },
  }, metadata), /changed|completely/);
});

test('archive output is reproducible for the same bytes and metadata', async () => {
  const first = await createDicomArchive(files(), metadata);
  const second = await createDicomArchive(files(), metadata);
  assert.deepEqual(Buffer.from(await first.blob.arrayBuffer()), Buffer.from(await second.blob.arrayBuffer()));
});
