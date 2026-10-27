import { denyAccess } from './guards.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(headerValue) {
  try {
    return headerValue ? new URL(headerValue).host : null;
  } catch {
    return null;
  }
}

// คำขอที่เปลี่ยนข้อมูลต้องมาจากหน้าเว็บของระบบเอง (กัน CSRF คู่กับ SameSite=Lax)
export function originCheck(req, res, next) {
  if (safeMethods.has(req.method)) {
    return next();
  }
  const sourceHost = hostOf(req.get('origin')) ?? hostOf(req.get('referer'));
  if (sourceHost && sourceHost === req.get('host')) {
    return next();
  }
  const error = denyAccess(req, res, 'same-origin (Origin/Referer)', 403);
  error.code = 'ORIGIN_MISMATCH';
  error.message = 'คำขอนี้ไม่ได้มาจากหน้าเว็บของระบบ';
  throw error;
}
