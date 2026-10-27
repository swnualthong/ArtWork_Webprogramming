import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { payloadTooLarge, unsupportedMediaType } from '../utils/httpErrors.js';
import { allowedFileTypes, checkFileType, sanitizeOriginalName, signatureHeaderBytes } from '../services/fileTypes.js';
import { storage } from '../services/storage.js';

const diskStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, storage.tempDir),
  // ชื่อไฟล์ชั่วคราวสร้างโดย Server เสมอ ไม่ใช้ชื่อ/path จาก client
  filename: (_req, _file, callback) => callback(null, randomUUID()),
});

async function readHeader(filePath) {
  const fileHandle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(signatureHeaderBytes);
    const { bytesRead } = await fileHandle.read(buffer, 0, signatureHeaderBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

function formatMegabytes(byteCount) {
  return `${Math.round(byteCount / (1024 * 1024))} MB`;
}

async function inspectUpload(uploadedFile, kind) {
  const rules = allowedFileTypes[kind];
  const originalName = sanitizeOriginalName(uploadedFile.originalname);
  if (uploadedFile.size > rules.maxBytes) {
    throw payloadTooLarge(`${rules.label}มีขนาดใหญ่เกิน ${formatMegabytes(rules.maxBytes)}`);
  }
  if (uploadedFile.size === 0) {
    throw unsupportedMediaType(`${rules.label}เป็นไฟล์ว่าง`);
  }
  const typeCheck = checkFileType(kind, originalName, await readHeader(uploadedFile.path));
  if (!typeCheck.ok) {
    throw unsupportedMediaType(`${rules.label} "${originalName}" ไม่รองรับ: ${typeCheck.reason}`);
  }
  return {
    kind,
    tempPath: uploadedFile.path,
    originalName,
    sizeBytes: uploadedFile.size,
    mimeType: typeCheck.mimeType,
    format: typeCheck.format,
  };
}

function removeTempFiles(req) {
  const uploadedFiles = Object.values(req.files ?? {}).flat();
  for (const uploadedFile of uploadedFiles) {
    // ไฟล์ที่ย้ายเข้าที่เก็บแล้วจะไม่อยู่ที่ path เดิม จึงลบเฉพาะที่ค้าง
    fsp.rm(uploadedFile.path, { force: true }).catch(() => {});
  }
}

/**
 * รับ multipart แบบ stream: จำกัดขนาดระหว่าง stream (multer limits) แล้วตรวจขนาดตามชนิดและ magic bytes
 * fieldRules: [{ field: 'slip', kind: 'payment_slip' }] → req.uploads.slip เป็นไฟล์เดียว
 *             [{ field: 'images', kind: 'image', maxCount: 10 }] → req.uploads.images เป็น array
 * maxTotalBytes: ขนาดรวมทุกไฟล์ในคำขอ
 * ไฟล์ชั่วคราวที่ไม่ได้ย้ายเข้าที่เก็บถูกลบเมื่อ response จบเสมอ (FR-FILE-09)
 */
export function acceptUploads(fieldRules, { onRejected, maxTotalBytes } = {}) {
  const largestLimit = Math.max(...fieldRules.map((rule) => allowedFileTypes[rule.kind].maxBytes));
  const fileCount = fieldRules.reduce((sum, rule) => sum + (rule.maxCount ?? 1), 0);
  const parseMultipart = multer({
    storage: diskStorage,
    // browser ส่งชื่อไฟล์เป็น UTF-8 (เช่น ชื่อภาษาไทย) ไม่ใช่ latin1
    defParamCharset: 'utf8',
    limits: { fileSize: largestLimit, files: fileCount, fields: 30, fieldSize: 16 * 1024, parts: fileCount + 30 },
  }).fields(fieldRules.map((rule) => ({ name: rule.field, maxCount: rule.maxCount ?? 1 })));

  return function uploadParser(req, res, next) {
    res.on('close', () => removeTempFiles(req));
    parseMultipart(req, res, async (multerError) => {
      try {
        if (multerError) {
          throw multerError;
        }
        req.uploads = {};
        let totalBytes = 0;
        for (const rule of fieldRules) {
          const inspected = [];
          for (const uploadedFile of req.files?.[rule.field] ?? []) {
            inspected.push(await inspectUpload(uploadedFile, rule.kind));
            totalBytes += uploadedFile.size;
          }
          req.uploads[rule.field] = rule.maxCount ? inspected : inspected[0];
        }
        if (maxTotalBytes && totalBytes > maxTotalBytes) {
          throw payloadTooLarge(`ไฟล์รวมกันต้องไม่เกิน ${formatMegabytes(maxTotalBytes)}`);
        }
        next();
      } catch (error) {
        onRejected?.(req, res, error);
        next(error);
      }
    });
  };
}

/** ตั้ง auditEvent ตอนไฟล์ถูกปฏิเสธ เพื่อลง Log File/Upload ระดับ Warning */
export function markUploadRejected(resourceType, resourceIdParam) {
  return (req, res) => {
    res.locals.auditEvent = {
      source: 'File',
      category: 'Upload',
      resourceType,
      resourceId: resourceIdParam ? req.params[resourceIdParam] : null,
      description: `อัปโหลดไฟล์ถูกปฏิเสธ (${req.method} ${req.originalUrl.split('?')[0]})`,
    };
  };
}
