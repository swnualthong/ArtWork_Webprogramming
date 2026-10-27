import { query, queryOne } from '../config/db.js';
import { conflict, notFound } from '../utils/httpErrors.js';

// ทรัพยากร (Object ใน Access Matrix) เช่น artwork, comment · Permission แต่ละตัวอ้างอิง resource_id

const resourceColumns = 'r.resource_id, r.resource_name, r.description';

export function listResources() {
  return query(
    `SELECT ${resourceColumns},
            (SELECT count(*) FROM permissions p WHERE p.resource_id = r.resource_id) AS permission_count
       FROM resources r ORDER BY r.resource_id`,
  );
}

export async function getResource(resourceId, client) {
  const resource = await queryOne(`SELECT ${resourceColumns} FROM resources r WHERE r.resource_id = $1`, [resourceId], client);
  if (!resource) {
    throw notFound('ไม่พบ Resource นี้');
  }
  return resource;
}

export async function createResource({ resourceName, description }) {
  try {
    return await queryOne(
      'INSERT INTO resources (resource_name, description) VALUES ($1, $2) RETURNING resource_id, resource_name, description',
      [resourceName, description],
    );
  } catch (error) {
    if (error.code === '23505') {
      throw conflict(`มี Resource "${resourceName}" อยู่แล้ว`, 'DUPLICATE_RESOURCE');
    }
    throw error;
  }
}

/** แก้ได้เฉพาะคำอธิบาย (ชื่อ resource เป็นส่วนหนึ่งของ key ที่ Code ตรวจ) */
export async function updateResourceDescription(resourceId, description) {
  const before = await getResource(resourceId);
  await query('UPDATE resources SET description = $2 WHERE resource_id = $1', [resourceId, description]);
  return { before, after: { ...before, description } };
}

/** ลบได้เมื่อไม่มี Permission อ้างอิง (FK RESTRICT) */
export async function deleteResource(resourceId) {
  const resource = await getResource(resourceId);
  const { permissionCount } = await queryOne(
    'SELECT count(*) AS permission_count FROM permissions WHERE resource_id = $1',
    [resourceId],
  );
  if (permissionCount > 0) {
    throw conflict(
      `ลบไม่ได้: ยังมี Permission ${permissionCount} รายการ`,
      'RESOURCE_IN_USE',
    );
  }
  await query('DELETE FROM resources WHERE resource_id = $1', [resourceId]);
  return resource;
}
