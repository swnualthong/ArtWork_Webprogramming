import { pipeline } from 'node:stream/promises';
import { storage } from './storage.js';
import { planStoredZip, writeStoredZip } from './zipStream.js';

const sandboxCsp = "default-src 'none'; sandbox";

/**
 * ส่งไฟล์จากที่เก็บผ่าน route ของ Server เท่านั้น ไม่มี public URL (FR-FILE-05)
 * asAttachment: บังคับดาวน์โหลด + CSP sandbox กันสคริปต์ในไฟล์
 */
export async function sendStoredFile(res, file, { asAttachment }) {
  const fileStream = await storage.openReadStream(file.storageKey);
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': String(file.sizeBytes),
  });
  if (asAttachment) {
    res.attachment(file.originalName);
    res.set('Content-Security-Policy', sandboxCsp);
  }
  res.set('Content-Type', file.mimeType);
  await pipeline(fileStream, res);
}

/** files: [{ originalName, storageKey }] → ส่ง zip ชื่อ zipName ให้ดาวน์โหลด (ตัวสร้าง zip อยู่ใน zipStream.js) */
export async function sendStoredZip(res, files, zipName) {
  const plan = await planStoredZip(
    files.map((file) => ({ name: file.originalName, filePath: storage.localPath(file.storageKey) })),
  );
  res.attachment(zipName);
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': sandboxCsp,
    'Content-Type': 'application/zip',
    'Content-Length': String(plan.byteLength),
  });
  await writeStoredZip(res, plan);
}
