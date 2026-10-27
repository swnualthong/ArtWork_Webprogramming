import { defaultAvatarPath, noPreviewImagePath } from '../../config/paths.js';
import * as artworkQueries from '../../services/artworkQueries.js';
import * as artworkService from '../../services/artworkService.js';
import * as engagementService from '../../services/engagementService.js';
import { sendStoredFile, sendStoredZip } from '../../services/fileDelivery.js';
import { findAvatarFile } from '../../services/profileService.js';
import { createBlurredPreview } from '../../services/thumbnailService.js';
import { notFound } from '../../utils/httpErrors.js';
import * as artworkOperations from '../shared/artworkOperations.js';
import * as engagementOperations from '../shared/engagementOperations.js';

function sendPublicAsset(res, filePath) {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(filePath, { cacheControl: false, etag: false, lastModified: false });
}

/** ภาพเบลอที่ Server สร้างให้ ใช้กับงานสมาชิกที่ผู้เรียกยังดาวน์โหลดไม่ได้ */
async function sendBlurredImage(res, storageKey) {
  const blurred = await createBlurredPreview(storageKey);
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'image/webp' });
  res.send(blurred);
}

export async function list(req, res) {
  res.json(await artworkQueries.listArtworks(req.validated.query));
}

export async function search(req, res) {
  const { q, type, page, pageSize } = req.validated.query;
  res.json(await artworkQueries.searchArtworks({ searchText: q, searchType: type, page, pageSize }));
}

export async function detail(req, res) {
  const { artworkId } = req.validated.params;
  const artwork = await artworkQueries.getArtworkDetail(artworkId);
  if (!artwork) {
    throw notFound('ไม่พบงานนี้');
  }
  const [comments, likedByMe, canDownload] = await Promise.all([
    engagementService.listComments(artworkId),
    engagementService.hasLiked(artworkId, req.actor.userId),
    artworkOperations.canDownloadArtwork(req.actor, artwork.visibility),
  ]);
  res.json({ artwork: { ...artwork, likedByMe, canDownload }, comments });
}

/**
 * ภาพบนการ์ด: thumbnail ของรูปปก ถ้าไม่มีใช้ภาพ No Preview Image (มีงานนี้อยู่ก็ตอบ 200 พร้อมภาพเสมอ)
 * งานสมาชิกที่ผู้เรียกยังดาวน์โหลดไม่ได้ ส่งภาพเบลอจาก Server
 */
export async function preview(req, res) {
  const { exists, visibility, file } = await artworkQueries.findPreviewFile(req.validated.params.artworkId);
  if (!exists) {
    throw notFound('ไม่พบงานนี้');
  }
  if (file) {
    try {
      if (await artworkOperations.canViewClearImage(req.actor, visibility)) {
        await sendStoredFile(res, file, { asAttachment: false });
      } else {
        await sendBlurredImage(res, file.storageKey);
      }
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // ไฟล์หายจากที่เก็บ ใช้ภาพ No Preview Image แทน
    }
  }
  sendPublicAsset(res, noPreviewImagePath);
}

/** รูปโปรไฟล์ของผู้ใช้ (แสดงข้างชื่อศิลปินและความคิดเห็น) ถ้าไม่มีใช้ภาพเริ่มต้น */
export async function userAvatar(req, res) {
  const avatarFile = await findAvatarFile(req.validated.params.userId);
  if (avatarFile) {
    try {
      await sendStoredFile(res, avatarFile, { asAttachment: false });
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  sendPublicAsset(res, defaultAvatarPath);
}

export async function addComment(req, res) {
  res.status(201).json({ comment: await engagementOperations.addComment(req, res) });
}

export async function deleteComment(req, res) {
  await engagementOperations.deleteComment(req, res);
  res.status(204).end();
}

export async function toggleLike(req, res) {
  res.json(await engagementOperations.toggleLike(req, res));
}

/** รูปหนึ่งรูปในภาพเลื่อนของหน้างาน: ดาวน์โหลดได้เห็นรูปจริง ยังไม่ได้เห็นรูปเบลอ */
export async function image(req, res) {
  const { artworkId, fileId } = req.validated.params;
  const imageFile = await artworkQueries.findArtworkImage(artworkId, fileId);
  if (!imageFile) {
    throw notFound('ไม่พบรูปนี้');
  }
  if (await artworkOperations.canViewClearImage(req.actor, imageFile.visibility)) {
    await sendStoredFile(res, imageFile, { asAttachment: false });
    return;
  }
  await sendBlurredImage(res, imageFile.storageKey);
}

/** ดาวน์โหลดงาน: รูปเดียวได้ไฟล์ตาม format เดิม หลายรูปได้ zip แล้วบันทึกลงคลังและ Log */
export async function download(req, res) {
  const { artworkId } = req.validated.params;
  const [title, images] = await Promise.all([
    artworkQueries.findArtworkTitle(artworkId),
    artworkQueries.listArtworkImages(artworkId),
  ]);
  if (title === null || images.length === 0) {
    throw notFound('ไม่พบงานนี้');
  }
  const isZip = images.length > 1;
  res.locals.auditEvent = {
    source: 'File',
    category: 'Download',
    resourceType: 'artwork',
    resourceId: artworkId,
    description: `ดาวน์โหลดงาน #${artworkId} (${images.length} ไฟล์${isZip ? ', zip' : ''})`,
  };
  if (!req.actor.isGuest) {
    await artworkService.recordDownload(req.actor.userId, artworkId);
  }
  if (!isZip) {
    await sendStoredFile(res, images[0], { asAttachment: true });
    return;
  }
  const zipBaseName = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim() || `artwork-${artworkId}`;
  await sendStoredZip(res, images, `${zipBaseName}.zip`);
}

export async function create(req, res) {
  res.status(201).json({ artwork: await artworkOperations.createArtwork(req, res) });
}

export async function update(req, res) {
  res.json({ artwork: await artworkOperations.updateArtwork(req, res) });
}

export async function destroy(req, res) {
  await artworkOperations.deleteArtwork(req, res);
  res.json({ ok: true });
}
