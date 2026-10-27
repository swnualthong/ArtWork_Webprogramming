import { adminAreaKeys } from '../config/permissionCatalog.js';
import { getEffectivePermissions } from '../services/aclService.js';

/**
 * ข้อมูลที่ทุกหน้า EJS ใช้: ผู้ใช้ปัจจุบันกับสิทธิ์จริงที่คำนวณแล้ว
 * ใช้ซ่อน/แสดงเมนูและปุ่มเท่านั้น การป้องกันจริงอยู่ที่ guard ของแต่ละ route
 */
export async function viewContext(req, res, next) {
  const permissions = await getEffectivePermissions(req.actor);
  const can = (permissionKey) => req.actor.isSuperUser || permissions[permissionKey] === true;
  res.locals.me = {
    actor: req.actor,
    permissions,
    can,
    canControlCenter: adminAreaKeys.some((permissionKey) => can(permissionKey)),
  };
  res.locals.currentPath = req.path;
  next();
}
