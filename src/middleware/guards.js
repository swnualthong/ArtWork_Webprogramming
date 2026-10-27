import { adminAreaKeys, permissionKeys } from '../config/permissionCatalog.js';
import { HttpError } from '../utils/httpErrors.js';
import { hasAnyPermission, hasPermission } from '../services/aclService.js';

const resourceParamNames = [
  ['artworkId', 'artwork'],
  ['subscriptionId', 'subscription'],
  ['userId', 'user'],
  ['roleId', 'role'],
  ['permissionId', 'permission'],
  ['resourceId', 'resource'],
  ['commentId', 'comment'],
];

function resourceFromParams(params = {}) {
  for (const [paramName, resourceType] of resourceParamNames) {
    if (params[paramName] !== undefined) {
      return { resourceType, resourceId: String(params[paramName]).slice(0, 64) };
    }
  }
  return { resourceType: null, resourceId: null };
}

/**
 * สร้าง error ปฏิเสธสิทธิ์ และตั้ง res.locals.denied ให้ auditLogger บันทึก Access/Denied
 * Guest ได้ 401 (ต้อง login) · ผู้ที่ login แล้วได้ 403 (FR-ACL-07)
 */
export function denyAccess(req, res, requirement, forcedStatus) {
  const status = forcedStatus ?? (req.actor?.isGuest ? 401 : 403);
  res.locals.denied = { status, requirement, ...resourceFromParams(req.params) };
  if (status === 401) {
    return new HttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
  }
  return new HttpError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์เข้าถึง');
}

export function requireAuth(req, res, next) {
  if (req.actor.isGuest) {
    throw denyAccess(req, res, 'login');
  }
  next();
}

/** กันพิมพ์ key ผิดใน Code: key ต้องอยู่ใน permissionCatalog ไม่งั้นระบบไม่ start */
function assertCatalogKey(permissionKey) {
  if (!permissionKeys.has(permissionKey)) {
    throw new Error(`Permission key "${permissionKey}" is not in src/config/permissionCatalog.js`);
  }
}

/** ตรวจสิทธิ์จาก PostgreSQL ทุก request: ผ่านเมื่อ Role ของผู้เรียกมีแถวใน acl ส่วน Admin ผ่านเสมอ */
export function requirePermission(permissionKey) {
  assertCatalogKey(permissionKey);
  return async function permissionGuard(req, res, next) {
    if (req.actor.isSuperUser || (await hasPermission(req.actor.roleId, permissionKey))) {
      return next();
    }
    throw denyAccess(req, res, permissionKey);
  };
}

/** ผ่านเมื่อ Role มีสิทธิ์อย่างน้อยหนึ่ง key */
export function requireAnyPermission(permissionKeyList) {
  permissionKeyList.forEach(assertCatalogKey);
  const requirement = permissionKeyList.join(' | ');
  return async function anyPermissionGuard(req, res, next) {
    if (req.actor.isSuperUser || (await hasAnyPermission(req.actor.roleId, permissionKeyList))) {
      return next();
    }
    throw denyAccess(req, res, requirement);
  };
}

/**
 * ทางเข้าศูนย์ควบคุม (/admin, /api/admin): Admin หรือ Role ที่ได้หน้าใดหน้าหนึ่งผ่าน ACL (คำขอสมาชิก, Logs)
 * แต่ละ route ยังตรวจสิทธิ์ของตัวเองอีกชั้น
 */
export const requireAdminArea = requireAnyPermission(adminAreaKeys);

/**
 * จัดการผู้ใช้ / Role / Resource / Permission / ACL: Admin เท่านั้น ไม่ดูตาราง acl
 * (ตรงกับ requireAdmin ในใบงาน · Admin คือ Role ที่ is_super_user)
 */
export function requireAdmin(req, res, next) {
  if (!req.actor.isSuperUser) {
    throw denyAccess(req, res, 'admin');
  }
  next();
}

/**
 * Owner rule (OWN-1..5): loadOwnerUserId คืน user_id ของเจ้าของ (throw 404 ถ้าไม่พบรายการ)
 * ผ่านเมื่อผู้เรียกเป็นเจ้าของ หรือเป็น Super User
 */
export function requireOwnerOrSuperUser(loadOwnerUserId, ownerRule) {
  return async function ownerGuard(req, res, next) {
    const ownerUserId = await loadOwnerUserId(req);
    if (req.actor.isSuperUser || (!req.actor.isGuest && ownerUserId === req.actor.userId)) {
      return next();
    }
    throw denyAccess(req, res, ownerRule);
  };
}

/** ตรวจสิทธิ์ใน handler เมื่อเงื่อนไขขึ้นกับข้อมูลของ request เช่น งานนี้เป็นงานสมาชิกหรือไม่ */
export async function assertPermission(req, res, permissionKey) {
  assertCatalogKey(permissionKey);
  if (req.actor.isSuperUser || (await hasPermission(req.actor.roleId, permissionKey))) {
    return;
  }
  throw denyAccess(req, res, permissionKey);
}
