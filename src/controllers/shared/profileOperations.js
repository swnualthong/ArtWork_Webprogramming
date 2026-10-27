import { destroyUserSessions } from '../../middleware/sessionLoader.js';
import * as authService from '../../services/authService.js';
import * as profileService from '../../services/profileService.js';
import { badRequest } from '../../utils/httpErrors.js';

export async function updateProfile(req, res) {
  const profile = await profileService.updateProfile(req.actor.userId, req.validated.body);
  res.locals.auditEvent.resourceId = req.actor.userId;
  res.locals.auditEvent.description = `แก้ไขโปรไฟล์: ${Object.keys(req.validated.body).join(', ')}`;
  return profile;
}

/** ต้องใส่รหัสเดิม (ตรวจด้วย bcrypt.compare); สำเร็จแล้วยกเลิก session อื่นของผู้ใช้ */
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.validated.body;
  res.locals.auditEvent.resourceId = req.actor.userId;
  if (!(await authService.passwordMatchesCurrent(req.actor.userId, currentPassword))) {
    throw badRequest('รหัสผ่านเดิมไม่ถูกต้อง', 'INVALID_CURRENT_PASSWORD');
  }
  await authService.updatePassword(req.actor.userId, newPassword);
  await destroyUserSessions(req.actor.userId, { exceptSessionId: req.sessionID });
  res.locals.auditEvent.description = 'เปลี่ยนรหัสผ่านสำเร็จ (ยกเลิก session อื่นแล้ว)';
}

export async function replaceAvatar(req, res) {
  const avatarUpload = req.uploads.avatar;
  if (!avatarUpload) {
    throw badRequest('กรุณาเลือกรูปโปรไฟล์', 'FILE_REQUIRED');
  }
  await profileService.replaceAvatar(req.actor.userId, avatarUpload);
  res.locals.auditEvent.resourceId = req.actor.userId;
  res.locals.auditEvent.description = `เปลี่ยนรูปโปรไฟล์เป็น "${avatarUpload.originalName}"`;
}
