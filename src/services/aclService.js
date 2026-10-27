import { query, queryOne, withTransaction } from '../config/db.js';
import { splitKey } from '../config/permissionCatalog.js';
import { forbidden } from '../utils/httpErrors.js';
import { getPermission, listPermissions } from './permissionService.js';
import { listResources } from './resourceService.js';
import { getRole, listRoles } from './roleService.js';

// ACL แบบใบงาน: แถวใน acl = Role ได้ Permission (resource + action) · ไม่มีแถว = ไม่ได้ (default deny)
// สิทธิ์ของผู้ใช้ = แถวของ Role ตัวเองเท่านั้น · ผู้ที่ยังไม่ login (roleId = null) ใช้แถวของ Role Guest

/** Role ของผู้เรียก: roleId หรือ Guest เมื่อยังไม่ login (ใช้เป็นเงื่อนไขใน SQL) */
const actorRoleSql = 'COALESCE($1::bigint, (SELECT role_id FROM roles WHERE is_guest))';

/** ชื่อเต็มของ Permission (resource.action) สำหรับ SELECT */
export const permissionKeySql = `re.resource_name || '.' || p.action`;

/**
 * Role นี้มีสิทธิ์ resource.action ไหม · อ่านจาก PostgreSQL ทุกครั้ง (ไม่ cache) จึงมีผลทันทีโดยไม่ restart
 * ไม่พบ Permission = ไม่มีสิทธิ์ (fail-closed) · SQL เดียวกับ POST /submit ในใบงาน
 */
export async function hasPermission(roleId, permissionKey) {
  const { resource, action } = splitKey(permissionKey);
  const row = await queryOne(
    `SELECT 1 AS granted FROM acl a
       JOIN permissions p ON p.permission_id = a.permission_id
       JOIN resources re ON re.resource_id = p.resource_id
      WHERE a.role_id = ${actorRoleSql} AND re.resource_name = $2 AND p.action = $3`,
    [roleId, resource, action],
  );
  return Boolean(row);
}

/** มีอย่างน้อยหนึ่ง key ในรายการไหม (ใช้กับด่านเข้าศูนย์ควบคุม) */
export async function hasAnyPermission(roleId, permissionKeys) {
  const row = await queryOne(
    `SELECT 1 AS granted FROM acl a
       JOIN permissions p ON p.permission_id = a.permission_id
       JOIN resources re ON re.resource_id = p.resource_id
      WHERE a.role_id = ${actorRoleSql} AND ${permissionKeySql} = ANY($2::text[])
      LIMIT 1`,
    [roleId, permissionKeys],
  );
  return Boolean(row);
}

/** สิทธิ์ทุก Permission ของผู้เรียก { key: true/false } (ใช้ซ่อน/แสดงเมนูเท่านั้น ไม่ใช่การป้องกัน) */
export async function getEffectivePermissions(actor) {
  const rows = await query(
    `SELECT ${permissionKeySql} AS key,
            EXISTS (SELECT 1 FROM acl a WHERE a.permission_id = p.permission_id AND a.role_id = ${actorRoleSql}) AS granted
       FROM permissions p JOIN resources re ON re.resource_id = p.resource_id`,
    [actor.roleId],
  );
  return Object.fromEntries(rows.map((row) => [row.key, actor.isSuperUser || row.granted]));
}

/** รายการ ACL แบบตารางในใบงาน (JOIN ชื่อแทน ID): acl_id · Role · resource · action · granted_at */
export function listAclRows() {
  return query(
    `SELECT a.acl_id, a.role_id, ro.name AS role_name, a.permission_id, re.resource_name, p.action,
            ${permissionKeySql} AS key, a.granted_at
       FROM acl a
       JOIN roles ro ON ro.role_id = a.role_id
       JOIN permissions p ON p.permission_id = a.permission_id
       JOIN resources re ON re.resource_id = p.resource_id
      ORDER BY a.acl_id`,
  );
}

/**
 * Access Matrix: แถว = Permission (จัดกลุ่มตาม Resource) · คอลัมน์ = Role · ช่อง = มีแถวใน acl ไหม
 * อ่านตามคอลัมน์ = Role นี้ทำอะไรได้บ้าง · อ่านตามแถว = ใครทำสิ่งนี้ได้บ้าง
 */
export async function getAclMatrix() {
  const [roles, resources, permissions, aclRows] = await Promise.all([
    listRoles(),
    listResources(),
    listPermissions(),
    listAclRows(),
  ]);
  const grantedPairs = new Set(aclRows.map((row) => `${row.roleId}_${row.permissionId}`));
  const groups = resources
    .map((resource) => ({
      resource,
      permissions: permissions.filter((permission) => permission.resourceId === resource.resourceId),
    }))
    .filter((group) => group.permissions.length > 0);
  return {
    roles,
    groups,
    rows: aclRows,
    isGranted: (role, permission) => role.isSuperUser || grantedPairs.has(`${role.roleId}_${permission.permissionId}`),
  };
}

/**
 * กำหนด (granted = true → INSERT) หรือยกเลิก (false → DELETE) หนึ่งช่องของ Matrix
 * changed = false เมื่อสถานะเดิมเป็นแบบที่ขออยู่แล้ว (ผู้เรียกไม่ต้องลง Log ว่ามีการเปลี่ยน)
 */
export async function setPermissionGrant(roleId, permissionId, granted) {
  return withTransaction(async (client) => {
    const role = await getRole(roleId, client);
    if (role.isSuperUser) {
      throw forbidden('แก้สิทธิ์ของ Admin ไม่ได้', 'LOCKED_ROLE');
    }
    const permission = await getPermission(permissionId, client);
    const grantSql = 'INSERT INTO acl (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING';
    const revokeSql = 'DELETE FROM acl WHERE role_id = $1 AND permission_id = $2';
    const result = await client.query(granted ? grantSql : revokeSql, [roleId, permissionId]);
    const changed = result.rowCount > 0;
    return { role, permission, wasGranted: changed ? !granted : granted, granted, changed };
  });
}
