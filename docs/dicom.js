/**
 * Local-only DICOM precheck for a research workflow demo.
 * inspectDicom(File) -> Promise<{ok, filename, bytes, fields, checks, issues}>.
 * ok means no detected structural failure, NOT research/model acceptance.
 * No networking, storage, image rendering, de-identification, or inference.
 * Only whitelisted numeric/controlled fields leave the parser. Instance,
 * study, series and frame-of-reference UIDs and patient tags are never returned.
 * Standard class/transfer-syntax UIDs are mapped to names before returning.
 * Browser parsing runs in a disposable worker with an 8-second timeout.
 *
 * Sources verified 2026-10-23:
 * https://github.com/cornerstonejs/dicomParser (MIT; vendored npm 1.8.21)
 * https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.6.html
 * https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.2.html
 * https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_8.html
 */
import dicomParser from './vendor/dicomParser.js';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PARSE_MS = 8000;
const SYNTAX_NAMES = {
  '1.2.840.10008.1.2': 'Implicit VR Little Endian',
  '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
  '1.2.840.10008.1.2.2': 'Explicit VR Big Endian (retired)',
  '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline',
  '1.2.840.10008.1.2.4.51': 'JPEG Extended',
  '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless, first-order prediction',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-lossless',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.5': 'RLE Lossless',
};
const SOP_NAMES = {
  '1.2.840.10008.5.1.4.1.1.4': 'MR Image Storage',
  '1.2.840.10008.5.1.4.1.1.4.1': 'Enhanced MR Image Storage',
  '1.2.840.10008.5.1.4.1.1.4.2': 'MR Spectroscopy Storage',
  '1.2.840.10008.5.1.4.1.1.4.3': 'Enhanced MR Color Image Storage',
  '1.2.840.10008.5.1.4.1.1.4.4': 'Legacy Converted Enhanced MR Image Storage',
  '1.2.840.10008.5.1.4.1.1.30': 'Parametric Map Storage',
  '1.2.840.10008.5.1.4.1.1.7': 'Secondary Capture Image Storage',
};
const NATIVE_SYNTAXES = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2']);

function newResult(filename = '', bytes = 0) {
  return {
    ok: false,
    filename: String(filename).slice(0, 240),
    bytes,
    fields: {
      rows: null, columns: null, frames: null, pixelSpacing: null,
      sliceThickness: null, spacingBetweenSlices: null, position: null,
      orientation: null, modality: null, transferSyntax: null,
      photometric: null, bitsAllocated: null, sopClass: null,
      hasPixelData: false, t1Type: 'Unverified — confirm sequence, scaling and units',
    },
    checks: [], issues: [],
  };
}
function add(result, label, status, detail) {
  result.checks.push({ label, status, detail });
  if (status === 'fail' || status === 'review') result.issues.push(detail);
}
function finish(result) {
  result.ok = !result.checks.some(check => check.status === 'fail');
  return result;
}
function fail(filename, bytes, label, detail) {
  const result = newResult(filename, bytes);
  add(result, label, 'fail', detail);
  return result;
}
function numericList(dataSet, tag, count) {
  const raw = dataSet.string(tag);
  if (!raw || raw.length > 256) return null;
  const tokens = raw.split('\\');
  if (tokens.length !== count || tokens.some(value => !value.trim())) return null;
  const values = tokens.map(Number);
  return values.every(Number.isFinite) ? values : null;
}
function scalar(dataSet, tag) {
  return numericList(dataSet, tag, 1)?.[0] ?? null;
}
function uint16(dataSet, tag) {
  const element = dataSet.elements[tag];
  return element?.length === 2 ? dataSet.uint16(tag) : null;
}
function controlledString(dataSet, tag, allowed) {
  const value = dataSet.string(tag);
  return allowed.includes(value) ? value : value ? 'Other / unrecognized' : null;
}

function encapsulatedStructure(bytes, offset) {
  // Validate item boundaries only; never claim that a compressed frame decodes.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = offset;
  let items = 0;
  let payload = 0;
  while (cursor + 8 <= bytes.length && items < 100000) {
    const group = view.getUint16(cursor, true);
    const tag = view.getUint16(cursor + 2, true);
    const length = view.getUint32(cursor + 4, true);
    cursor += 8;
    if (group !== 0xfffe) return false;
    if (tag === 0xe0dd) return length === 0 && items >= 2 && payload > 0;
    if (tag !== 0xe000 || length === 0xffffffff || length % 2 || cursor + length > bytes.length) return false;
    if (items === 0 && length % 4 !== 0) return false; // Basic Offset Table.
    if (items > 0) payload += length;
    items += 1;
    cursor += length;
  }
  return false;
}

function inspectBytes(buffer, filename) {
  const bytes = new Uint8Array(buffer);
  const result = newResult(filename, bytes.length);
  if (bytes.length > MAX_BYTES) return fail(filename, bytes.length, 'File size', 'File exceeds the 50 MiB local demo limit.');
  if (bytes.length < 132 || String.fromCharCode(...bytes.subarray(128, 132)) !== 'DICM') {
    return fail(filename, bytes.length, 'DICOM container', 'No DICOM Part 10 marker was found. Raw DICOM datasets are not supported by this demo; export a Part 10 file.');
  }
  try {
    const header = dicomParser.readPart10Header(bytes);
    const syntax = header.string('x00020010');
    result.fields.transferSyntax = SYNTAX_NAMES[syntax] || (syntax ? 'Unrecognized transfer syntax' : null);
    if (!syntax) return fail(filename, bytes.length, 'Transfer syntax', 'The required transfer syntax is missing from the file metadata.');
    if (syntax === '1.2.840.10008.1.2.1.99') {
      add(result, 'Transfer syntax', 'fail', 'Deflated datasets are outside this bounded demo parser. Export an uncompressed Part 10 copy for local inspection.');
      return result;
    }
    const native = NATIVE_SYNTAXES.has(syntax);
    const compressed = syntax.startsWith('1.2.840.10008.1.2.4.') || syntax === '1.2.840.10008.1.2.5';
    if (!native && !compressed) {
      add(result, 'Transfer syntax', 'fail', 'This transfer syntax is not supported by the local demo parser.');
      return result;
    }
    const dataSet = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
    add(result, 'DICOM container', 'pass', 'Part 10 metadata parsed. This is a structural precheck, not full DICOM conformance validation.');
    const fields = result.fields;
    fields.rows = uint16(dataSet, 'x00280010');
    fields.columns = uint16(dataSet, 'x00280011');
    const hasFrameTag = Boolean(dataSet.elements.x00280008);
    const rawFrames = hasFrameTag ? dataSet.string('x00280008') : null;
    fields.frames = hasFrameTag ? (/^\+?\d+$/.test(rawFrames || '') ? Number(rawFrames) : null) : 1;
    fields.pixelSpacing = numericList(dataSet, 'x00280030', 2);
    fields.sliceThickness = scalar(dataSet, 'x00180050');
    fields.spacingBetweenSlices = scalar(dataSet, 'x00180088');
    fields.position = numericList(dataSet, 'x00200032', 3);
    fields.orientation = numericList(dataSet, 'x00200037', 6);
    fields.modality = controlledString(dataSet, 'x00080060', ['MR', 'CT', 'US', 'OT', 'PT', 'NM', 'SC']);
    fields.photometric = controlledString(dataSet, 'x00280004', ['MONOCHROME1', 'MONOCHROME2', 'RGB', 'PALETTE COLOR', 'YBR_FULL', 'YBR_FULL_422', 'YBR_ICT', 'YBR_RCT']);
    fields.bitsAllocated = uint16(dataSet, 'x00280100');
    const sopClass = dataSet.string('x00080016');
    fields.sopClass = SOP_NAMES[sopClass] || (sopClass ? 'Other / unrecognized storage class' : null);
    add(result, 'Image dimensions', fields.rows > 0 && fields.columns > 0 ? 'pass' : 'fail', fields.rows > 0 && fields.columns > 0 ? `${fields.rows} × ${fields.columns} pixels. Model-specific acceptance ranges are not configured.` : 'Rows or columns are missing or invalid.');
    if (!Number.isSafeInteger(fields.frames) || fields.frames < 1) {
      add(result, 'Frame count', 'fail', 'Number of Frames must be a positive integer when present.');
    } else if (fields.frames > 1) {
      add(result, 'Frame count', 'review', `${fields.frames} frames are present. One file is not one image; frame, cardiac phase and anatomical level require review.`);
    } else {
      add(result, 'Frame count', 'pass', hasFrameTag ? 'One frame is declared. Anatomical pairing still requires review.' : 'No Number of Frames attribute; treated as a conventional single-frame object for this structural check.');
    }
    add(result, 'Modality', fields.modality === 'MR' ? 'pass' : 'review', fields.modality === 'MR' ? 'MR modality is declared; SAX, T1 and LGE roles are not verified by this tag.' : 'MR modality was not confirmed. Review the selected file and acquisition type.');
    add(result, 'Pixel spacing', fields.pixelSpacing?.every(value => value > 0) ? 'pass' : 'review', fields.pixelSpacing?.every(value => value > 0) ? `Declared in-plane spacing: ${fields.pixelSpacing.join(' × ')} mm. No model threshold is applied.` : 'Top-level pixel spacing is missing or invalid. Enhanced objects may store geometry in functional groups.');
    add(result, 'Slice thickness', fields.sliceThickness > 0 ? 'pass' : 'review', fields.sliceThickness > 0 ? `Declared nominal thickness: ${fields.sliceThickness} mm. Model compatibility requires review.` : 'Top-level nominal slice thickness could not be confirmed.');
    add(result, 'Slice spacing', 'unknown', 'Actual inter-slice spacing and missing slices cannot be verified from this selected object alone; a declared spacing field is not independent verification.');
    add(result, 'Plane geometry', fields.position && fields.orientation ? 'review' : 'unknown', fields.position && fields.orientation ? 'Top-level position and orientation were read. Cross-modality anatomical pairing and any motion require manual review.' : 'Top-level position/orientation are incomplete. Per-frame functional-group geometry is not interpreted in this demo.');

    const integerPixel = dataSet.elements.x7fe00010;
    const floatPixel = dataSet.elements.x7fe00008;
    const doublePixel = dataSet.elements.x7fe00009;
    const pixelElement = integerPixel || floatPixel || doublePixel;
    fields.hasPixelData = Boolean(pixelElement);
    const samples = uint16(dataSet, 'x00280002');
    if (!pixelElement) {
      add(result, 'Pixel payload', 'fail', 'No supported Pixel Data element was found.');
    } else if ([integerPixel, floatPixel, doublePixel].filter(Boolean).length !== 1) {
      add(result, 'Pixel payload', 'fail', 'Conflicting Pixel Data elements were found.');
    } else if (compressed) {
      const valid = integerPixel && pixelElement.hadUndefinedLength && encapsulatedStructure(bytes, pixelElement.dataOffset);
      add(result, 'Pixel payload', valid ? 'review' : 'fail', valid ? 'Encapsulated pixel item boundaries are readable. Compressed image decoding and pixel quality are not tested in this demo.' : 'Compressed pixel data item boundaries are missing, truncated or unsupported.');
    } else if (pixelElement.hadUndefinedLength || pixelElement.dataOffset + pixelElement.length > bytes.length) {
      add(result, 'Pixel payload', 'fail', 'Native pixel data is undefined-length or extends beyond the file.');
    } else {
      const bits = fields.bitsAllocated;
      const dimensionsValid = fields.rows > 0 && fields.columns > 0 && Number.isSafeInteger(fields.frames) && fields.frames > 0;
      const bitsValid = Number.isInteger(bits) && (bits === 1 || (bits > 0 && bits % 8 === 0));
      const samplesValid = Number.isInteger(samples) && samples > 0;
      const floatValid = (!floatPixel || bits === 32) && (!doublePixel || bits === 64);
      if (!dimensionsValid || !bitsValid || !samplesValid || !floatValid) {
        add(result, 'Pixel payload', 'fail', 'Dimensions, frame count, samples per pixel or allocated bits do not describe a valid native payload.');
      } else if (samples !== 1 || !['MONOCHROME1', 'MONOCHROME2'].includes(fields.photometric)) {
        add(result, 'Pixel payload', 'review', 'Native color or non-monochrome pixel layouts are outside this MRI demo length check.');
      } else {
        const requiredBytes = Math.ceil(fields.rows * fields.columns * fields.frames * samples * bits / 8);
        const paddedBytes = requiredBytes + requiredBytes % 2;
        const valid = Number.isSafeInteger(paddedBytes) && pixelElement.length === paddedBytes;
        add(result, 'Pixel payload', valid ? 'pass' : 'fail', valid ? 'Native monochrome payload length matches its dimensions and frame count. Pixel values, scaling and image quality are not assessed.' : 'Native monochrome payload length does not match the declared dimensions and frame count.');
      }
    }
    if (dataSet.warnings?.length) add(result, 'Parser warnings', 'review', 'The parser reported a structural warning. Review or re-export the object before use.');
    add(result, 'T1 type and units', 'review', 'Sequence type, intensity scaling and quantitative units require the acquisition protocol and model input specification. They are not inferred from the filename.');
    add(result, 'Visual quality and de-identification', 'review', 'Motion, artifacts, heart coverage, burned-in identifiers and complete de-identification are not assessed by this metadata precheck.');
    return finish(result);
  } catch {
    // Never display parser exceptions: they can contain raw data or identifiers.
    add(result, 'DICOM parsing', 'fail', 'The metadata could not be safely parsed. The file may be truncated, malformed or outside this demo parser’s supported format.');
    return result;
  }
}

export async function inspectDicom(file) {
  const filename = file?.name || 'Selected DICOM';
  const size = Number(file?.size) || 0;
  if (!file || typeof file.arrayBuffer !== 'function') return fail(filename, size, 'File access', 'Select a local DICOM file.');
  if (size > MAX_BYTES) return fail(filename, size, 'File size', 'File exceeds the 50 MiB local demo limit.');
  if (size < 132) return fail(filename, size, 'File size', 'File is too small to contain a DICOM Part 10 header.');
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return fail(filename, size, 'File access', 'The selected file could not be read locally.');
  }
  if (buffer.byteLength > MAX_BYTES) return fail(filename, buffer.byteLength, 'File size', 'File exceeds the 50 MiB local demo limit.');
  // Node is used only for synthetic fixture tests. Real browser files use a worker.
  if (typeof window === 'undefined' && typeof WorkerGlobalScope === 'undefined') return inspectBytes(buffer, filename);
  if (typeof Worker === 'undefined') return fail(filename, size, 'Local parser', 'This browser does not support the bounded local parser. Use a current browser.');
  return new Promise(resolve => {
    let worker;
    let timer;
    const complete = result => { clearTimeout(timer); worker?.terminate(); resolve(result); };
    try {
      worker = new Worker(new URL(import.meta.url), { type: 'module' });
      timer = setTimeout(() => complete(fail(filename, size, 'Local parser', 'The local precheck exceeded its time limit. No data was uploaded.')), MAX_PARSE_MS);
      worker.onmessage = event => complete(event.data);
      worker.onerror = () => complete(fail(filename, size, 'Local parser', 'The local parser could not run. No data was uploaded.'));
      worker.postMessage({ buffer, filename }, [buffer]);
    } catch {
      complete(fail(filename, size, 'Local parser', 'The local parser could not start. No data was uploaded.'));
    }
  });
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = event => {
    const { buffer, filename } = event.data || {};
    if (!(buffer instanceof ArrayBuffer)) return;
    globalThis.postMessage(inspectBytes(buffer, filename));
  };
}
