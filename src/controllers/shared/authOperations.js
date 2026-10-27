import { destroySession, regenerateSession, saveSession } from '../../middleware/sessionLoader.js';
import * as authService from '../../services/authService.js';
import { HttpError } from '../../utils/httpErrors.js';

// การทำงานที่ใช้ร่วมกันระหว่างหน้าเว็บ (EJS) และ JSON API: ตั้ง res.locals.auditEvent แล้วคืนผล

export const invalidCredentialsMessage = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';

function failedLoginEvent(email, user, reason) {
  return {
    final: true,
    level: 'Warning',
    source: 'Auth',
    category: 'Login',
    result: 'failure',
    actorUserId: user?.userId ?? null,
    actorLabel: email,
    resourceType: 'user',
    resourceId: user?.userId ?? null,
    description: `เข้าสู่ระบบล้มเหลว: ${reason}`,
  };
}

export async function register(req, res, input) {
  const createdUser = await authService.registerUser(input);
  res.locals.auditEvent = {
    source: 'Auth',
    category: 'Register',
    actorUserId: createdUser.userId,
    actorLabel: `${createdUser.email} (Member)`,
    resourceType: 'user',
    resourceId: createdUser.userId,
    description: `สมัครบัญชีใหม่ ${createdUser.email}`,
  };
  return createdUser;
}

/** ตรวจรหัสด้วย bcrypt.compare แล้วออก session id ใหม่ (กัน session fixation); ข้อความผิดเหมือนกันทุกกรณี */
export async function login(req, res, { email, password }) {
  const { outcome, user } = await authService.verifyCredentials(email, password);
  if (outcome === 'invalid') {
    res.locals.auditEvent = failedLoginEvent(email, user, user ? 'รหัสผ่านไม่ถูกต้อง' : 'ไม่พบบัญชีนี้');
    throw new HttpError(401, 'INVALID_CREDENTIALS', invalidCredentialsMessage);
  }
  if (outcome === 'suspended') {
    res.locals.auditEvent = failedLoginEvent(email, user, 'บัญชีถูกระงับ');
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'บัญชีนี้ถูกระงับ');
  }
  await regenerateSession(req);
  req.session.userId = user.userId;
  req.session.loginAt = Date.now();
  await saveSession(req);
  res.locals.auditEvent = {
    source: 'Auth',
    category: 'Login',
    actorUserId: user.userId,
    actorLabel: `${user.email} (${user.roleName})`,
    resourceType: 'user',
    resourceId: user.userId,
    description: 'เข้าสู่ระบบสำเร็จ',
  };
  return user;
}

/** ลบแถว session ใน DB + ล้าง cookie: cookie เดิมใช้ต่อไม่ได้ */
export async function logout(req, res) {
  res.locals.auditEvent = { source: 'Auth', category: 'Logout', resourceType: 'user', resourceId: req.actor.userId, description: 'ออกจากระบบ' };
  await destroySession(req, res);
}
