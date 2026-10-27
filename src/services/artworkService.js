import { query, withTransaction } from '../config/db.js';
import { storage } from './storage.js';
import { artworkFileLimits } from './fileTypes.js';
import { createThumbnail } from './thumbnailService.js';
import { listArtworkImages } from './artworkQueries.js';
import { badRequest, payloadTooLarge } from '../utils/httpErrors.js';

// ส่วน "เขียน" ของงานศิลปะ: สร้าง แก้ไข ลบ บันทึกการดาวน์โหลด และจัดการไฟล์/thumbnail
// ส่วนอ่าน (รายการ ค้นหา รายละเอียด) อยู่ใน artworkQueries.js

export const visibilities = ['free', 'subscriber'];

/** แปลงข้อความแท็ก (คั่นด้วยเว้นวรรค, จุลภาค หรือ array) เป็นรายการตัวพิมพ์เล็ก ไม่ซ้ำ */
export function normalizeTags(rawTags) {
  if (rawTags === undefined || rawTags === null || rawTags === '') {
    return [];
  }
  const tagList = Array.isArray(rawTags) ? rawTags : String(rawTags).split(/[\s,]+/);
  const normalized = tagList.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
  return [...new Set(normalized)];
}

/** ดาวน์โหลดหนึ่งครั้ง = ทุกรูปของงาน → บันทึกลงคลังหนึ่งแถว */
export async function recordDownload(userId, artworkId) {
  await query('INSERT INTO downloads (user_id, artwork_id) VALUES ($1, $2)', [userId, artworkId]);
}

async function insertFileRow(
  client,
  { kind, originalName, storageKey, mimeType, sizeBytes, uploadedBy, artworkId, isCover = false },
) {
  const [fileRow] = await query(
    `INSERT INTO files (kind, original_name, storage_key, mime_type, size_bytes, uploaded_by, artwork_id, is_cover)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING file_id`,
    [kind, originalName, storageKey, mimeType, sizeBytes, uploadedBy, artworkId, isCover],
    client,
  );
  return fileRow.fileId;
}

async function replaceTags(client, artworkId, tags) {
  await client.query('DELETE FROM artwork_tags WHERE artwork_id = $1', [artworkId]);
  if (tags.length === 0) {
    return;
  }
  await client.query('INSERT INTO tags (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING', [tags]);
  await client.query(
    `INSERT INTO artwork_tags (artwork_id, tag_id) SELECT $1, tag_id FROM tags WHERE name = ANY($2::text[])`,
    [artworkId, tags],
  );
}

/**
 * สร้าง thumbnail ใหม่จากรูปปกปัจจุบันแล้วแทนที่อันเดิม (เรียกหลังเพิ่ม/ลบรูปหรือเปลี่ยนปก)
 * สร้างไม่สำเร็จไม่ทำให้งานล้มเหลว แต่คืนเหตุผลไว้ลง Log และการ์ดจะแสดง "No Preview Image"
 */
async function refreshThumbnail(artworkId, actorUserId) {
  const [cover] = await listArtworkImages(artworkId);
  let thumbnail = null;
  let failure = null;
  if (cover) {
    try {
      thumbnail = await createThumbnail(cover.storageKey);
    } catch (error) {
      failure = error.message;
    }
  }
  try {
    const obsoleteKeys = await withTransaction(async (client) => {
      const removed = await query(
        `DELETE FROM files WHERE artwork_id = $1 AND kind = 'thumbnail' RETURNING storage_key`,
        [artworkId],
        client,
      );
      if (thumbnail) {
        await insertFileRow(client, {
          kind: 'thumbnail',
          originalName: 'thumbnail.webp',
          storageKey: thumbnail.storageKey,
          mimeType: 'image/webp',
          sizeBytes: thumbnail.sizeBytes,
          uploadedBy: actorUserId,
          artworkId,
        });
      }
      return removed.map((row) => row.storageKey);
    });
    await storage.removeMany(obsoleteKeys);
  } catch (error) {
    if (thumbnail) await storage.removeMany([thumbnail.storageKey]);
    throw error;
  }
  return failure;
}

async function saveUploads(imageUploads, storedKeys) {
  for (const upload of imageUploads) {
    storedKeys.push(await storage.saveFromTemp(upload.tempPath));
  }
}

/**
 * FR-ART-01: ย้ายรูปทั้งหมดเข้าที่เก็บ แล้วเขียน artwork/tags/files ใน transaction เดียว จากนั้นสร้าง thumbnail ของปก
 * coverIndex = ลำดับของรูปที่เลือกเป็นปก (null = อัตโนมัติ) · DB ล้มเหลวจะลบไฟล์ที่เพิ่งเก็บออก
 */
export async function createArtwork({ artistId, title, description, visibility, tags, imageUploads, coverIndex = null }) {
  const storedKeys = [];
  let artworkId;
  try {
    await saveUploads(imageUploads, storedKeys);
    artworkId = await withTransaction(async (client) => {
      const [artwork] = await query(
        'INSERT INTO artworks (artist_id, title, description, visibility) VALUES ($1, $2, $3, $4) RETURNING artwork_id',
        [artistId, title, description, visibility],
        client,
      );
      await replaceTags(client, artwork.artworkId, tags);
      for (const [index, upload] of imageUploads.entries()) {
        await insertFileRow(client, {
          ...upload,
          kind: 'image',
          storageKey: storedKeys[index],
          uploadedBy: artistId,
          artworkId: artwork.artworkId,
          isCover: index === coverIndex,
        });
      }
      return artwork.artworkId;
    });
  } catch (error) {
    await storage.removeMany(storedKeys);
    throw error;
  }
  const thumbnailFailure = await refreshThumbnail(artworkId, artistId);
  return { artworkId, thumbnailFailure };
}

/** หลังแก้ไข งานต้องยังมีรูป 1–10 ไฟล์ และรวมไม่เกิน 100 MB */
function assertImageLimits(keptImages, imageUploads) {
  const count = keptImages.length + imageUploads.length;
  const totalBytes = [...keptImages, ...imageUploads].reduce((sum, file) => sum + Number(file.sizeBytes), 0);
  if (count === 0) {
    throw badRequest('งานต้องมีรูปอย่างน้อย 1 รูป', 'FILE_REQUIRED');
  }
  if (count > artworkFileLimits.maxFiles) {
    throw badRequest(`งานหนึ่งมีรูปได้ไม่เกิน ${artworkFileLimits.maxFiles} ไฟล์`, 'TOO_MANY_FILES');
  }
  if (totalBytes > artworkFileLimits.maxTotalBytes) {
    throw payloadTooLarge(`รูปของงานรวมกันต้องไม่เกิน ${artworkFileLimits.maxTotalBytes / (1024 * 1024)} MB`);
  }
}

/**
 * FR-ART-02: แก้ข้อมูล/แท็ก, เพิ่มรูป, ลบรูป, เปลี่ยนปก
 * cover: undefined = ไม่เปลี่ยน · 'auto' = รูปแรกตามชื่อ · { fileId } = รูปเดิม · { newIndex } = รูปที่เพิ่งอัปโหลด
 */
export async function updateArtwork({ artworkId, actorUserId, fields, imageUploads = [], removeFileIds = [], cover }) {
  const storedKeys = [];
  let obsoleteKeys;
  try {
    await saveUploads(imageUploads, storedKeys);
    obsoleteKeys = await withTransaction(async (client) => {
      await client.query(
        `UPDATE artworks
            SET title = COALESCE($2, title), description = COALESCE($3, description),
                visibility = COALESCE($4, visibility), updated_at = now()
          WHERE artwork_id = $1`,
        [artworkId, fields.title ?? null, fields.description ?? null, fields.visibility ?? null],
      );
      if (fields.tags !== undefined) {
        await replaceTags(client, artworkId, fields.tags);
      }
      const currentImages = await listArtworkImages(artworkId, client);
      const imagesToRemove = currentImages.filter((image) => removeFileIds.includes(Number(image.fileId)));
      if (imagesToRemove.length !== removeFileIds.length) {
        throw badRequest('รูปที่เลือกลบไม่ใช่รูปของงานนี้');
      }
      const keptImages = currentImages.filter((image) => !imagesToRemove.includes(image));
      assertImageLimits(keptImages, imageUploads);
      if (cover?.fileId && !keptImages.some((image) => Number(image.fileId) === cover.fileId)) {
        throw badRequest('รูปปกที่เลือกไม่ใช่รูปของงานนี้');
      }
      if (imagesToRemove.length > 0) {
        await client.query('DELETE FROM files WHERE file_id = ANY($1::bigint[])', [imagesToRemove.map((image) => image.fileId)]);
      }
      if (cover !== undefined) {
        await client.query('UPDATE files SET is_cover = false WHERE artwork_id = $1 AND is_cover', [artworkId]);
      }
      for (const [index, upload] of imageUploads.entries()) {
        await insertFileRow(client, {
          ...upload,
          kind: 'image',
          storageKey: storedKeys[index],
          uploadedBy: actorUserId,
          artworkId,
          isCover: cover?.newIndex === index,
        });
      }
      if (cover?.fileId) {
        await client.query('UPDATE files SET is_cover = true WHERE file_id = $1', [cover.fileId]);
      }
      return imagesToRemove.map((image) => image.storageKey);
    });
  } catch (error) {
    await storage.removeMany(storedKeys);
    throw error;
  }
  // ลบไฟล์เก่าหลัง commit เท่านั้น
  await storage.removeMany(obsoleteKeys);
  const filesChanged = imageUploads.length > 0 || removeFileIds.length > 0 || cover !== undefined;
  const thumbnailFailure = filesChanged ? await refreshThumbnail(artworkId, actorUserId) : null;
  return { thumbnailFailure, removedFileCount: obsoleteKeys.length };
}

/** FR-ART-03: ลบงาน + ไฟล์ + ประวัติดาวน์โหลด (cascade) แล้วลบไฟล์ออกจากที่เก็บ */
export async function deleteArtwork(artworkId) {
  const removedFiles = await withTransaction(async (client) => {
    const files = await query('SELECT kind, storage_key FROM files WHERE artwork_id = $1', [artworkId], client);
    await client.query('DELETE FROM artworks WHERE artwork_id = $1', [artworkId]);
    return files;
  });
  await storage.removeMany(removedFiles.map((file) => file.storageKey));
  return removedFiles;
}
