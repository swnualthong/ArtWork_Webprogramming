import { assertPermission, denyAccess } from '../../middleware/guards.js';
import { hasPermission } from '../../services/aclService.js';
import * as artworkQueries from '../../services/artworkQueries.js';
import * as artworkService from '../../services/artworkService.js';
import { badRequest, notFound } from '../../utils/httpErrors.js';

function fileEvent(category, artworkId, description) {
  return { source: 'File', category, resourceType: 'artwork', resourceId: artworkId, description };
}

function thumbnailWarning(artworkId, reason) {
  return { ...fileEvent('Thumbnail', artworkId, `สร้าง thumbnail ไม่สำเร็จ ใช้ "No Preview Image" แทน: ${reason}`), level: 'Warning', result: 'failure' };
}

/** guard OWN-1: ใช้ร่วมกับ requireOwnerOrSuperUser */
export async function loadArtworkOwner(req) {
  const ownerUserId = await artworkQueries.findArtworkOwnerId(req.validated.params.artworkId);
  if (ownerUserId === null) {
    throw notFound('ไม่พบงานนี้');
  }
  return ownerUserId;
}

/**
 * ผู้เรียกดาวน์โหลดรูปของงานนี้ได้ไหม
 * free = login แล้วก็พอ · subscriber = ต้องมี file.download (Admin ผ่านเสมอ)
 */
export async function canDownloadArtwork(actor, visibility) {
  if (actor.isGuest) {
    return false;
  }
  if (visibility === 'free' || actor.isSuperUser) {
    return true;
  }
  return hasPermission(actor.roleId, 'file.download');
}

/** ดูภาพชัดได้ไหม: งานฟรีทุกคนเห็นชัด (รวม Guest) · งานสมาชิกต้องดาวน์โหลดได้ ไม่งั้นได้ภาพเบลอ */
export async function canViewClearImage(actor, visibility) {
  return visibility === 'free' || canDownloadArtwork(actor, visibility);
}

/** guard ของการดาวน์โหลด: Guest → 401, งานสมาชิกที่ไม่มี file.download → 403 (ลง Log Access/Denied) */
export async function requireDownloadAccess(req, res, next) {
  const visibility = await artworkQueries.findArtworkVisibility(req.validated.params.artworkId);
  if (!visibility) {
    throw notFound('ไม่พบงานนี้');
  }
  if (req.actor.isGuest) {
    throw denyAccess(req, res, 'login');
  }
  if (visibility === 'subscriber') {
    await assertPermission(req, res, 'file.download');
  }
  next();
}

function describeFiles(uploads) {
  return uploads.map((upload) => `"${upload.originalName}" (${upload.mimeType}, ${upload.sizeBytes} bytes)`).join(', ');
}

/** ค่าปกจากฟอร์ม → undefined (ไม่เปลี่ยน) | 'auto' | { fileId } | { newIndex } */
function parseCover(cover, newUploadCount) {
  if (cover === undefined) return undefined;
  if (cover === '') return 'auto';
  const number = Number(cover.slice(1));
  if (cover.startsWith('n')) {
    if (number >= newUploadCount) {
      throw badRequest('รูปปกที่เลือกไม่อยู่ในไฟล์ที่อัปโหลด');
    }
    return { newIndex: number };
  }
  return { fileId: number };
}

/** สร้างงาน + รูป 1–10 ไฟล์ ใน transaction เดียว; ลง Log Artwork/Create + File/Upload */
export async function createArtwork(req, res) {
  const imageUploads = req.uploads.images;
  if (imageUploads.length === 0) {
    throw badRequest('กรุณาแนบรูปงานอย่างน้อย 1 รูป', 'FILE_REQUIRED');
  }
  const { title, description, visibility, tags, cover: rawCover } = req.validated.body;
  const cover = parseCover(rawCover, imageUploads.length);
  if (cover?.fileId) {
    throw badRequest('งานใหม่เลือกปกได้จากรูปที่อัปโหลดเท่านั้น');
  }
  const result = await artworkService.createArtwork({
    artistId: req.actor.userId,
    title,
    description,
    visibility,
    tags,
    imageUploads,
    coverIndex: cover?.newIndex ?? null,
  });
  const { artworkId } = result;
  res.locals.auditEvent = { source: 'Artwork', category: 'Create', resourceType: 'artwork', resourceId: artworkId, description: `สร้างงาน #${artworkId} "${title}"` };
  res.locals.extraAuditEvents = [fileEvent('Upload', artworkId, `อัปโหลด ${imageUploads.length} รูป: ${describeFiles(imageUploads)}`)];
  if (result.thumbnailFailure) {
    res.locals.extraAuditEvents.push(thumbnailWarning(artworkId, result.thumbnailFailure));
  }
  return artworkQueries.getArtworkDetail(artworkId);
}

/** แก้ข้อมูล/แท็ก, เพิ่ม/ลบรูป, เปลี่ยนปก (artwork.update ครอบการแก้รูปของงานด้วย ตรวจที่ chain แล้ว) */
export async function updateArtwork(req, res) {
  const { artworkId } = req.validated.params;
  const { removeFiles: removeFileIds = [], cover: rawCover, ...fields } = req.validated.body;
  const imageUploads = req.uploads?.images ?? [];
  const cover = parseCover(rawCover, imageUploads.length);
  const result = await artworkService.updateArtwork({ artworkId, actorUserId: req.actor.userId, fields, imageUploads, removeFileIds, cover });
  const changedParts = [
    ...Object.keys(fields),
    imageUploads.length > 0 && `เพิ่ม ${imageUploads.length} รูป`,
    removeFileIds.length > 0 && `ลบ ${removeFileIds.length} รูป`,
    cover !== undefined && 'ปก',
  ].filter(Boolean);
  res.locals.auditEvent = { source: 'Artwork', category: 'Update', resourceType: 'artwork', resourceId: artworkId, description: `แก้ไขงาน #${artworkId}: ${changedParts.join(', ') || 'ไม่มีการเปลี่ยนแปลง'}` };
  res.locals.extraAuditEvents = [];
  if (imageUploads.length > 0) {
    res.locals.extraAuditEvents.push(fileEvent('Upload', artworkId, `เพิ่มรูป: ${describeFiles(imageUploads)}`));
  }
  if (removeFileIds.length > 0) {
    res.locals.extraAuditEvents.push(fileEvent('Delete', artworkId, `ลบรูป ${removeFileIds.length} ไฟล์ของงาน`));
  }
  if (result.thumbnailFailure) {
    res.locals.extraAuditEvents.push(thumbnailWarning(artworkId, result.thumbnailFailure));
  }
  return artworkQueries.getArtworkDetail(artworkId);
}

export async function deleteArtwork(req, res) {
  const { artworkId } = req.validated.params;
  const removedFiles = await artworkService.deleteArtwork(artworkId);
  res.locals.auditEvent = { source: 'Artwork', category: 'Delete', resourceType: 'artwork', resourceId: artworkId, description: `ลบงาน #${artworkId}` };
  res.locals.extraAuditEvents = [fileEvent('Delete', artworkId, `ลบไฟล์ของงาน #${artworkId}: ${removedFiles.map((file) => file.kind).join(', ')}`)];
}
