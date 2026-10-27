import { query, queryOne } from '../config/db.js';
import { byCatalogOrder, catalogEntry } from '../config/permissionCatalog.js';
import { badRequest, conflict, notFound } from '../utils/httpErrors.js';
import { getResource } from './resourceService.js';

const permissionColumns = `p.permission_id, p.resource_id, re.resource_name, p.action,
  re.resource_name || '.' || p.action AS key, p.description, p.created_at`;

export async function listPermissions() {
  const permissions = await query(
    `SELECT ${permissionColumns},
            (SELECT count(*) FROM acl a WHERE a.permission_id = p.permission_id) AS acl_count
       FROM permissions p JOIN resources re ON re.resource_id = p.resource_id
      ORDER BY re.resource_id`,
  );
  return permissions.sort((a, b) => a.resourceId - b.resourceId || byCatalogOrder(a, b));
}

export async function getPermission(permissionId, client) {
  const permission = await queryOne(
    `SELECT ${permissionColumns} FROM permissions p JOIN resources re ON re.resource_id = p.resource_id
      WHERE p.permission_id = $1`,
    [permissionId],
    client,
  );
  if (!permission) {
    throw notFound('ไม่พบ Permission นี้');
  }
  return permission;
}

/**
 * เลือก Resource + พิมพ์ action · เพิ่มได้เฉพาะ resource.action ที่ Code ผูกกับฟังก์ชันไว้แล้ว (permissionCatalog)
 * ทุก Role เริ่มที่ยังไม่ได้รับสิทธิ์จนกว่าจะติ๊กในหน้า ACL · ไม่กรอกคำอธิบายจะใช้คำอธิบายจากแคตตาล็อก
 */
export async function createPermission({ resourceId, action, description }) {
  const resource = await getResource(resourceId);
  const key = `${resource.resourceName}.${action}`;
  const entry = catalogEntry(key);
  if (!entry) {
    throw badRequest(
      `"${key}" ไม่ได้ใช้ในโค้ด`,
      'UNKNOWN_PERMISSION_KEY',
    );
  }
  try {
    const { permissionId } = await queryOne(
      'INSERT INTO permissions (resource_id, action, description) VALUES ($1, $2, $3) RETURNING permission_id',
      [resourceId, action, description || entry.description],
    );
    return getPermission(permissionId);
  } catch (error) {
    // UNIQUE (resource_id, action) กันซ้ำ รวมถึงสองคำขอพร้อมกัน
    if (error.code === '23505') {
      throw conflict(`มี Permission "${key}" อยู่แล้ว`, 'DUPLICATE_PERMISSION');
    }
    throw error;
  }
}

/** แก้ได้เฉพาะคำอธิบาย (ชื่อ resource.action ผูกกับ Code) */
export async function updatePermissionDescription(permissionId, description) {
  const before = await getPermission(permissionId);
  await query('UPDATE permissions SET description = $2 WHERE permission_id = $1', [permissionId, description]);
  return { before, after: { ...before, description } };
}

/** ลบได้เมื่อไม่มี Role ใดได้รับ (FK RESTRICT) ต้องถอนสิทธิ์ในหน้า ACL ก่อน ตามลำดับการลบในใบงาน */
export async function deletePermission(permissionId) {
  const permission = await getPermission(permissionId);
  const holders = await query(
    'SELECT ro.name FROM acl a JOIN roles ro ON ro.role_id = a.role_id WHERE a.permission_id = $1 ORDER BY ro.role_id',
    [permissionId],
  );
  if (holders.length > 0) {
    const roleNames = holders.map((holder) => holder.name).join(', ');
    throw conflict(
      `ลบไม่ได้: ${roleNames} ยังได้สิทธิ์นี้อยู่`,
      'PERMISSION_IN_USE',
    );
  }
  await query('DELETE FROM permissions WHERE permission_id = $1', [permissionId]);
  return permission;
}
