import { denyAccess } from '../../middleware/guards.js';
import { hasPermission } from '../../services/aclService.js';
import * as engagementService from '../../services/engagementService.js';
import { forbidden, notFound } from '../../utils/httpErrors.js';

// ความคิดเห็นและการกดถูกใจ ใช้ร่วมกันระหว่างหน้าเว็บและ JSON API

/** ลบความคิดเห็นได้ถ้า: Super User · มี comment.moderate · หรือเป็นเจ้าของ (OWN-5) และมี comment.delete */
export async function canDeleteComment(actor, commentUserId) {
  if (actor.isGuest) {
    return false;
  }
  if (actor.isSuperUser || (await hasPermission(actor.roleId, 'comment.moderate'))) {
    return true;
  }
  return commentUserId === actor.userId && hasPermission(actor.roleId, 'comment.delete');
}

export async function requireCommentDeleteAccess(req, res, next) {
  const comment = await engagementService.findComment(req.validated.params.commentId);
  if (!comment) {
    throw notFound('ไม่พบความคิดเห็นนี้');
  }
  if (!(await canDeleteComment(req.actor, comment.userId))) {
    throw denyAccess(req, res, 'OWN-5 (เจ้าของความคิดเห็น) + comment.delete | comment.moderate');
  }
  req.comment = comment;
  next();
}

/** กดถูกใจได้เมื่อเคยดาวน์โหลดไฟล์ต้นฉบับของงานนี้แล้ว */
async function assertDownloadedBefore(artworkId, userId) {
  if (!(await engagementService.hasDownloaded(artworkId, userId))) {
    throw forbidden('ต้องดาวน์โหลดงานนี้ก่อนจึงกดถูกใจได้', 'DOWNLOAD_REQUIRED');
  }
}

export async function addComment(req, res) {
  const { artworkId } = req.validated.params;
  const comment = await engagementService.addComment(artworkId, req.actor.userId, req.validated.body.body);
  res.locals.auditEvent = {
    source: 'Artwork',
    category: 'Comment',
    resourceType: 'artwork',
    resourceId: artworkId,
    description: `แสดงความคิดเห็น #${comment.commentId} ในงาน #${artworkId}`,
  };
  return comment;
}

export async function deleteComment(req, res) {
  const { commentId, artworkId, userId } = req.comment;
  await engagementService.deleteComment(commentId);
  const byOwner = userId === req.actor.userId;
  res.locals.auditEvent = {
    source: 'Artwork',
    category: 'CommentDelete',
    resourceType: 'artwork',
    resourceId: artworkId,
    description: `ลบความคิดเห็น #${commentId} ในงาน #${artworkId}${byOwner ? '' : ' (โดยผู้ตรวจความคิดเห็น)'}`,
  };
  return { artworkId };
}

export async function toggleLike(req, res) {
  const { artworkId } = req.validated.params;
  await assertDownloadedBefore(artworkId, req.actor.userId);
  const result = await engagementService.toggleLike(artworkId, req.actor.userId);
  res.locals.auditEvent = {
    source: 'Artwork',
    category: result.liked ? 'Like' : 'Unlike',
    resourceType: 'artwork',
    resourceId: artworkId,
    description: `${result.liked ? 'กดถูกใจ' : 'ยกเลิกถูกใจ'}งาน #${artworkId}`,
  };
  return result;
}
