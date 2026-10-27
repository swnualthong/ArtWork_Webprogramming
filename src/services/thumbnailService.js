import sharp from 'sharp';
import { storage } from './storage.js';

// ไม่เก็บ cache ภาพในหน่วยความจำ เพื่อคุม memory ตอนย่อภาพใหญ่ (NFR-PERF-04)
sharp.cache(false);

const maxThumbnailEdge = 480;
// เพดานจำนวนพิกเซลกัน pixel bomb (ภาพเกินนี้ไม่สร้าง thumbnail แต่ไม่ทำให้อัปโหลดล้มเหลว)
const maxInputPixels = 60_000_000;

/** อ่านรูปจากที่เก็บ หมุนตาม EXIF และย่อให้ด้านยาวสุดไม่เกิน maxThumbnailEdge (ไม่ขยายรูปเล็ก) */
function resizedForPreview(storageKey) {
  return sharp(storage.localPath(storageKey), { limitInputPixels: maxInputPixels, pages: 1 })
    .rotate()
    .resize(maxThumbnailEdge, maxThumbnailEdge, { fit: 'inside', withoutEnlargement: true });
}

/**
 * สร้าง thumbnail WebP (ด้านยาวสุด ≤ 480 px, GIF ใช้เฟรมแรก) จากไฟล์ต้นฉบับที่อยู่ในที่เก็บแล้ว
 * คืน { storageKey, sizeBytes } หรือ throw ถ้าสร้างไม่สำเร็จ
 */
export async function createThumbnail(originalStorageKey) {
  const thumbnailBuffer = await resizedForPreview(originalStorageKey).webp({ quality: 80 }).toBuffer();
  const storageKey = await storage.saveBuffer(thumbnailBuffer);
  return { storageKey, sizeBytes: thumbnailBuffer.length };
}

/**
 * ภาพ Preview แบบเบลอ (สร้างตอนส่ง ไม่เก็บลงดิสก์) สำหรับผู้ที่ยังดาวน์โหลดงานสมาชิกไม่ได้
 * เบลอที่ Server จึงเปิด URL ของภาพตรง ๆ ก็ไม่ได้ภาพชัด
 */
export function createBlurredPreview(storageKey) {
  return resizedForPreview(storageKey).blur(18).webp({ quality: 60 }).toBuffer();
}
