// ชนิดไฟล์ที่อนุญาตทั้งหมดอยู่ที่นี่ที่เดียว (allowedFileTypes) แก้ได้โดยไม่แตะ logic
const megabyte = 1024 * 1024;

// รับเฉพาะรูปที่ระบบสร้าง Preview ให้อัตโนมัติได้
export const allowedFileTypes = Object.freeze({
  image: { label: 'รูปงาน', maxBytes: 100 * megabyte, extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
  payment_slip: { label: 'สลิปการโอน', maxBytes: 5 * megabyte, extensions: ['jpg', 'jpeg', 'png', 'webp'] },
  avatar: { label: 'รูปโปรไฟล์', maxBytes: 2 * megabyte, extensions: ['jpg', 'jpeg', 'png', 'webp'] },
});

// งานหนึ่งชิ้นมีได้หลายรูป: รวมไม่เกิน 10 ไฟล์ / 100 MB
export const artworkFileLimits = Object.freeze({ maxFiles: 10, maxTotalBytes: 100 * megabyte });

// นามสกุล → รูปแบบ (signature) ที่ยอมรับ
const formatsByExtension = {
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  png: ['png'],
  gif: ['gif'],
  webp: ['webp'],
};

const mimeTypeByExtension = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

// จำนวน byte แรกที่อ่านเพื่อตรวจ signature
export const signatureHeaderBytes = 4096;

function startsWithBytes(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byteValue, index) => buffer[offset + index] === byteValue);
}

function asciiAt(buffer, start, end) {
  return buffer.subarray(start, end).toString('latin1');
}

/** ตรวจรูปแบบไฟล์จาก magic bytes (ไม่ดูนามสกุลหรือ Content-Type จาก client) */
export function detectFormat(header) {
  if (startsWithBytes(header, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWithBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  const gifHeader = asciiAt(header, 0, 6);
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'gif';
  if (asciiAt(header, 0, 4) === 'RIFF' && asciiAt(header, 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function getExtension(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * ตรวจว่าไฟล์ใช้กับชนิดนี้ได้: นามสกุลต้องอยู่ใน whitelist และ signature ต้องตรงกับนามสกุล
 * คืน { ok, reason, extension, format, mimeType }
 */
export function checkFileType(kind, fileName, header) {
  const rules = allowedFileTypes[kind];
  const extension = getExtension(fileName);
  if (!rules.extensions.includes(extension)) {
    return { ok: false, reason: `${rules.label}รองรับเฉพาะ ${rules.extensions.join(', ')}` };
  }
  const format = detectFormat(header);
  if (!format || !formatsByExtension[extension].includes(format)) {
    return { ok: false, reason: `เนื้อไฟล์ไม่ตรงกับนามสกุล .${extension}` };
  }
  return { ok: true, extension, format, mimeType: mimeTypeByExtension[extension] };
}

/** ทำความสะอาดชื่อไฟล์เดิม: ตัด path, control character และจำกัดความยาว (ใช้เป็น metadata เท่านั้น) */
export function sanitizeOriginalName(rawName) {
  const baseName = String(rawName ?? '').split(/[/\\]/).pop();
  // eslint-disable-next-line no-control-regex
  const cleaned = baseName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return 'file';
  }
  if (cleaned.length <= 255) {
    return cleaned;
  }
  const extension = getExtension(cleaned);
  const suffix = extension && extension.length < 20 ? `.${extension}` : '';
  return cleaned.slice(0, 255 - suffix.length) + suffix;
}
