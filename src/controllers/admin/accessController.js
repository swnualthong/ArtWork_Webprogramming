import { previousPagePath } from '../../middleware/errorHandlers.js';
import { setFlash } from '../../middleware/flash.js';
import { getAclMatrix } from '../../services/aclService.js';
import { listRoles } from '../../services/roleService.js';
import { listUsers } from '../../services/userService.js';
import * as accessOperations from '../shared/accessOperations.js';

// ศูนย์ควบคุมของ Admin มี 2 หน้า: ผู้ใช้ กับ ACL (Matrix และจัดการ Role อยู่หน้าเดียวกัน)
// Resource / Permission ไม่มีฟอร์มบนหน้าเว็บแล้ว (จัดการผ่าน /api/admin ได้) handler POST ด้านล่างยังเก็บไว้ตาม route ของใบงาน
// สิทธิ์ของแต่ละ route ตรวจที่ chains.js ใน controller นี้ไม่ตรวจซ้ำ

const aclPagePath = '/admin/acl';
const rolesSectionPath = () => `${aclPagePath}#roles`;
const permissionsSectionPath = () => `${aclPagePath}#permissions`;

/** /admin ไปหน้าแรกที่ผู้เรียกเข้าได้: Admin ไปหน้าผู้ใช้ Role อื่นที่ได้สิทธิ์ผ่าน ACL ไปคำขอสมาชิกหรือ Logs */
export function home(_req, res) {
  const { me } = res.locals;
  const landingPage = [
    [me.actor.isSuperUser, '/admin/users'],
    [me.can('subscription.review'), '/admin/subscriptions'],
    [me.can('log.read'), '/admin/logs'],
  ].find(([isAllowed]) => isAllowed);
  res.redirect(landingPage ? landingPage[1] : '/app/home');
}

export async function showUsers(req, res) {
  const filters = req.validated.query;
  const [users, roles] = await Promise.all([listUsers(filters), listRoles()]);
  res.render('admin/users', {
    activeTab: 'users',
    filters,
    users,
    roles,
    assignableRoles: roles.filter((role) => !role.isGuest),
  });
}

/** หน้า ACL หน้าเดียว: Access Matrix (แถว = Permission, คอลัมน์ = Role) อยู่ด้านบน ด้านล่างเป็นส่วนจัดการ Role ที่พับไว้ */
export async function showAcl(_req, res) {
  res.render('admin/acl', { activeTab: 'acl', ...(await getAclMatrix()) });
}

/** สร้าง handler ของฟอร์ม: ทำงาน แล้วตั้งข้อความผล แล้วกลับหน้าเดิม (หรือหน้าที่กำหนด) */
function formAction(operation, describeSuccess, redirectTo = (req) => previousPagePath(req, aclPagePath)) {
  return async function handleAdminForm(req, res) {
    const result = await operation(req, res);
    setFlash(req, 'success', describeSuccess(result, req));
    res.redirect(303, redirectTo(req, result));
  };
}

export const createRole = formAction(
  accessOperations.createRole,
  () => 'Role created',
  () => aclPagePath,
);
export const updateRole = formAction(accessOperations.updateRole, () => 'Saved', rolesSectionPath);
export const deleteRole = formAction(accessOperations.deleteRole, () => 'Deleted', rolesSectionPath);

export const createResource = formAction(accessOperations.createResource, () => 'Resource created', permissionsSectionPath);
export const updateResource = formAction(accessOperations.updateResource, () => 'Saved', permissionsSectionPath);
export const deleteResource = formAction(accessOperations.deleteResource, () => 'Deleted', permissionsSectionPath);

export const createPermission = formAction(
  accessOperations.createPermission,
  () => 'Permission created',
  permissionsSectionPath,
);
export const updatePermission = formAction(accessOperations.updatePermission, () => 'Saved', permissionsSectionPath);
export const deletePermission = formAction(accessOperations.deletePermission, () => 'Deleted', permissionsSectionPath);

export const setPermissionGrant = formAction(
  accessOperations.setPermissionGrant,
  (change) => (change.changed ? 'Saved' : 'No changes'),
  // กลับไปที่แถวเดิมของ Matrix จะได้ไม่ต้องเลื่อนหาใหม่
  (_req, change) => `${aclPagePath}#permission-${change.permission.permissionId}`,
);

export const createUser = formAction(accessOperations.createUser, () => 'User created');
export const updateUser = formAction(accessOperations.updateUser, ({ changes }) => (changes.length > 0 ? 'Saved' : 'No changes'));
export const deleteUser = formAction(accessOperations.deleteUser, () => 'Deleted');
export const resetUserPassword = formAction(
  accessOperations.resetUserPassword,
  () => 'Password reset',
);
