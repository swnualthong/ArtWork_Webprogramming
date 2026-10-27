import { query, queryOne } from '../config/db.js';
import { conflict, forbidden, notFound } from '../utils/httpErrors.js';

export async function listRoles() {
  // คอลัมน์ของ Access Matrix: Guest ซ้ายสุด · Role อื่นตามลำดับที่สร้าง · Admin ขวาสุด
  return query(
    `SELECT r.role_id, r.name, r.description, r.is_system, r.is_super_user, r.is_guest, r.created_at,
            (SELECT count(*) FROM users u WHERE u.role_id = r.role_id) AS member_count
       FROM roles r
      ORDER BY r.is_guest DESC, r.is_super_user, r.role_id`,
  );
}

export async function getRole(roleId, client) {
  const role = await queryOne(
    `SELECT role_id, name, description, is_system, is_super_user, is_guest FROM roles WHERE role_id = $1`,
    [roleId],
    client,
  );
  if (!role) {
    throw notFound('ไม่พบ Role นี้');
  }
  return role;
}

/** Role Guest (ผู้ที่ยังไม่ login) แก้ชื่อ/ลบผ่านเว็บไม่ได้ และกำหนดให้ผู้ใช้ไม่ได้ */
export function assertNotGuestRole(role) {
  if (role.isGuest) {
    throw forbidden('แก้ไขหรือลบ Role Guest ไม่ได้', 'LOCKED_ROLE');
  }
}

export async function createRole({ name, description }) {
  const sameName = await queryOne('SELECT role_id FROM roles WHERE lower(name) = lower($1)', [name]);
  if (sameName) {
    throw conflict(`มี Role ชื่อ "${name}" อยู่แล้ว`, 'DUPLICATE_ROLE');
  }
  // Role ใหม่ยังไม่มีแถวใน acl = ไม่ได้รับ Permission ใด (default deny) จนกว่าจะติ๊กในหน้า ACL
  return queryOne(
    `INSERT INTO roles (name, description) VALUES ($1, $2)
     RETURNING role_id, name, description, is_system, is_super_user, is_guest`,
    [name, description],
  );
}

export async function updateRole(roleId, { name, description }) {
  const role = await getRole(roleId);
  assertNotGuestRole(role);
  const isRenaming = name !== undefined && name !== role.name;
  if (isRenaming) {
    if (role.isSystem) {
      throw conflict('Role ระบบเปลี่ยนชื่อไม่ได้', 'SYSTEM_ROLE');
    }
    const sameName = await queryOne(
      'SELECT role_id FROM roles WHERE lower(name) = lower($1) AND role_id <> $2',
      [name, roleId],
    );
    if (sameName) {
      throw conflict(`มี Role ชื่อ "${name}" อยู่แล้ว`, 'DUPLICATE_ROLE');
    }
  }
  const updated = await queryOne(
    `UPDATE roles SET name = COALESCE($2, name), description = COALESCE($3, description)
      WHERE role_id = $1
     RETURNING role_id, name, description, is_system, is_super_user, is_guest`,
    [roleId, name ?? null, description ?? null],
  );
  return { before: role, after: updated };
}

/** PDF §4.2: ป้องกันการลบ Role ที่ยังมีผู้ใช้ (ตรวจใน Code และ FK RESTRICT ใน DB อีกชั้น) */
export async function deleteRole(roleId) {
  const role = await getRole(roleId);
  assertNotGuestRole(role);
  if (role.isSystem) {
    throw conflict('Role ระบบลบไม่ได้', 'SYSTEM_ROLE');
  }
  const { memberCount } = await queryOne('SELECT count(*) AS member_count FROM users WHERE role_id = $1', [roleId]);
  if (memberCount > 0) {
    throw conflict(`ลบไม่ได้: Role "${role.name}" ยังมีผู้ใช้ ${memberCount} คน`, 'ROLE_IN_USE');
  }
  await query('DELETE FROM roles WHERE role_id = $1', [roleId]);
  return role;
}
