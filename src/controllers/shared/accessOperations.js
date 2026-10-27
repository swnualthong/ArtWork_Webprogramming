import * as aclService from '../../services/aclService.js';
import { hashPassword, registerUser } from '../../services/authService.js';
import * as permissionService from '../../services/permissionService.js';
import * as resourceService from '../../services/resourceService.js';
import * as roleService from '../../services/roleService.js';
import * as userService from '../../services/userService.js';

// งานจัดการผู้ใช้ / Role / Resource / Permission / ACL ที่หน้าเว็บกับ API เรียกร่วมกัน (Admin เท่านั้น ตรวจที่ chains.js)
// ทุกงานตั้ง res.locals.auditEvent ให้ลง Log พร้อมรายละเอียดก่อนและหลังแก้

function setAdminEvent(res, category, resourceType, resourceId, description) {
  res.locals.auditEvent = { source: 'Admin', category, resourceType, resourceId, description };
}

// Role

export async function createRole(req, res) {
  const role = await roleService.createRole(req.validated.body);
  setAdminEvent(res, 'RoleCreate', 'role', role.roleId, `สร้าง Role "${role.name}" (ยังไม่มีแถวใน ACL = ไม่ได้รับสิทธิ์ใด)`);
  return role;
}

export async function updateRole(req, res) {
  const { roleId } = req.validated.params;
  res.locals.auditEvent.resourceId = roleId;
  const { before, after } = await roleService.updateRole(roleId, req.validated.body);
  const changes = [];
  if (before.name !== after.name) changes.push(`ชื่อ "${before.name}" → "${after.name}"`);
  if (before.description !== after.description) changes.push('คำอธิบาย');
  res.locals.auditEvent.description = `แก้ไข Role "${after.name}": ${changes.join(', ') || 'ไม่มีการเปลี่ยนแปลง'}`;
  return after;
}

export async function deleteRole(req, res) {
  const { roleId } = req.validated.params;
  res.locals.auditEvent.resourceId = roleId;
  // แถวใน acl ของ Role นี้ถูกลบตาม (ON DELETE CASCADE)
  const role = await roleService.deleteRole(roleId);
  res.locals.auditEvent.description = `ลบ Role "${role.name}"`;
  return role;
}

// Resource

export async function createResource(req, res) {
  const resource = await resourceService.createResource(req.validated.body);
  setAdminEvent(res, 'ResourceCreate', 'resource', resource.resourceId, `สร้าง Resource "${resource.resourceName}"`);
  return resource;
}

export async function updateResource(req, res) {
  const { resourceId } = req.validated.params;
  res.locals.auditEvent.resourceId = resourceId;
  const { after } = await resourceService.updateResourceDescription(resourceId, req.validated.body.description);
  res.locals.auditEvent.description = `แก้คำอธิบาย Resource "${after.resourceName}"`;
  return after;
}

export async function deleteResource(req, res) {
  const { resourceId } = req.validated.params;
  res.locals.auditEvent.resourceId = resourceId;
  const resource = await resourceService.deleteResource(resourceId);
  res.locals.auditEvent.description = `ลบ Resource "${resource.resourceName}"`;
  return resource;
}

// Permission

export async function createPermission(req, res) {
  const permission = await permissionService.createPermission(req.validated.body);
  setAdminEvent(res, 'PermissionCreate', 'permission', permission.permissionId, `สร้าง Permission "${permission.key}"`);
  return permission;
}

export async function updatePermission(req, res) {
  const { permissionId } = req.validated.params;
  res.locals.auditEvent.resourceId = permissionId;
  const { after } = await permissionService.updatePermissionDescription(permissionId, req.validated.body.description);
  res.locals.auditEvent.description = `แก้คำอธิบาย Permission "${after.key}"`;
  return after;
}

export async function deletePermission(req, res) {
  const { permissionId } = req.validated.params;
  res.locals.auditEvent.resourceId = permissionId;
  const permission = await permissionService.deletePermission(permissionId);
  res.locals.auditEvent.description = `ลบ Permission "${permission.key}"`;
  return permission;
}

// ACL

const grantLabel = (granted) => (granted ? 'ได้รับ' : 'ไม่ได้รับ');

export function describeAclChange(change) {
  return `${change.role.name} · ${change.permission.key}: ${grantLabel(change.wasGranted)} → ${grantLabel(change.granted)}`;
}

/** ติ๊ก/เอาติ๊กออก 1 ช่องของ Access Matrix = เพิ่ม/ลบ 1 แถวใน acl มีผลใน request ถัดไปโดยไม่ restart */
export async function setPermissionGrant(req, res) {
  const { roleId, permissionId } = req.validated.params;
  const change = await aclService.setPermissionGrant(roleId, permissionId, req.validated.body.granted);
  res.locals.auditEvent.resourceId = roleId;
  res.locals.auditEvent.description = describeAclChange(change);
  // สถานะเดิมเป็นแบบที่ขออยู่แล้ว (เช่น กดซ้ำ) ไม่นับเป็นการเปลี่ยนสิทธิ์
  res.locals.skipAudit = !change.changed;
  return change;
}

// ผู้ใช้

/** สร้างผู้ใช้ใหม่เข้า Role ที่เลือก (ไม่ใช่ Guest) */
export async function createUser(req, res) {
  const { roleId, ...account } = req.validated.body;
  const role = await roleService.getRole(roleId);
  roleService.assertNotGuestRole(role);
  const user = await registerUser({ ...account, roleId });
  setAdminEvent(res, 'UserCreate', 'user', user.userId, `สร้างผู้ใช้ @${user.username} (${user.email}) ใน Role ${role.name}`);
  return { ...user, roleId, roleName: role.name };
}

export async function updateUser(req, res) {
  const { userId } = req.validated.params;
  res.locals.auditEvent.resourceId = userId;
  const { user, changes } = await userService.updateUser(userId, req.validated.body);
  res.locals.auditEvent.description = `${user.username} (${user.email}): ${changes.join(', ') || 'ไม่มีการเปลี่ยนแปลง'}`;
  return { user, changes };
}

export async function deleteUser(req, res) {
  const { userId } = req.validated.params;
  res.locals.auditEvent.resourceId = userId;
  const user = await userService.deleteUser(userId);
  res.locals.auditEvent.description = `ลบผู้ใช้ ${user.email} (${user.roleName})`;
  return user;
}

/** ไม่บันทึกรหัสผ่านหรือ hash ลง Log */
export async function resetUserPassword(req, res) {
  const { userId } = req.validated.params;
  res.locals.auditEvent.resourceId = userId;
  const user = await userService.resetUserPassword(userId, await hashPassword(req.validated.body.newPassword));
  res.locals.auditEvent.description = `ตั้งรหัสผ่านใหม่ให้ ${user.email} และยกเลิก session ทั้งหมดของผู้ใช้นี้`;
  return user;
}
