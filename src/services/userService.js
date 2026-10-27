import { query, queryOne, withTransaction } from '../config/db.js';
import { destroyUserSessions } from '../middleware/sessionLoader.js';
import { storage } from './storage.js';
import { conflict, notFound } from '../utils/httpErrors.js';
import { getRole } from './roleService.js';
import { escapeLikePattern } from '../utils/format.js';

const userColumns = `u.user_id, u.email, u.username, u.display_name, u.is_active, u.created_at, u.role_id, r.name AS role_name`;

/** หน้าผู้ใช้ของ Admin: กรองตาม Role (ไม่ระบุ = ทุก Role) และค้นด้วย username หรืออีเมล */
export async function listUsers({ roleId, user: searchText = '' }) {
  return query(
    `SELECT ${userColumns} FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE ($1::bigint IS NULL OR u.role_id = $1)
        AND ($2 = '' OR u.username ILIKE $3 ESCAPE '\\' OR u.email ILIKE $3 ESCAPE '\\')
      ORDER BY u.user_id LIMIT 200`,
    [roleId ?? null, searchText, `%${escapeLikePattern(searchText)}%`],
  );
}

async function lockUser(client, userId) {
  const [user] = await query(
    `SELECT ${userColumns}, r.is_super_user FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = $1 FOR UPDATE OF u`,
    [userId],
    client,
  );
  if (!user) {
    throw notFound('ไม่พบผู้ใช้นี้');
  }
  return user;
}

/** PDF §4.2: ป้องกันการเปลี่ยนแปลงที่ทำให้ไม่มี Admin (Super User ที่ใช้งานได้) เหลืออยู่ */
async function assertNotLastSuperUser(client, user, actionLabel) {
  if (!user.isSuperUser || !user.isActive) {
    return;
  }
  const otherSuperUsers = await query(
    `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE r.is_super_user AND u.is_active AND u.user_id <> $1
      FOR UPDATE OF u`,
    [user.userId],
    client,
  );
  if (otherSuperUsers.length === 0) {
    throw conflict(`${actionLabel}ไม่ได้: ต้องเหลือ Admin อย่างน้อย 1 คน`, 'LAST_SUPER_USER');
  }
}

/** เปลี่ยน Role ของผู้ใช้ และ/หรือ ระงับ-เปิดใช้งานบัญชี (มีผลใน request ถัดไปทันที) */
export async function updateUser(userId, { roleId, isActive }) {
  return withTransaction(async (client) => {
    const user = await lockUser(client, userId);
    const changes = [];
    let targetRole = null;
    if (roleId !== undefined && roleId !== user.roleId) {
      targetRole = await getRole(roleId, client);
      if (targetRole.isGuest) {
        throw conflict('กำหนด Role Guest ให้ผู้ใช้ไม่ได้', 'GUEST_ROLE_NOT_ASSIGNABLE');
      }
      if (!targetRole.isSuperUser) {
        await assertNotLastSuperUser(client, user, 'เปลี่ยน Role ');
      }
      changes.push(`Role ${user.roleName} → ${targetRole.name}`);
    }
    if (isActive !== undefined && isActive !== user.isActive) {
      if (!isActive) {
        await assertNotLastSuperUser(client, user, 'ระงับบัญชี');
      }
      changes.push(isActive ? 'เปิดใช้งานบัญชี' : 'ระงับบัญชี');
    }
    await client.query(
      `UPDATE users SET role_id = COALESCE($2, role_id), is_active = COALESCE($3, is_active), updated_at = now()
        WHERE user_id = $1`,
      [userId, targetRole?.roleId ?? null, isActive ?? null],
    );
    if (isActive === false) {
      await destroyUserSessions(userId, { client });
    }
    return { user, changes };
  });
}

export async function deleteUser(userId) {
  const { user, storageKeys } = await withTransaction(async (client) => {
    const lockedUser = await lockUser(client, userId);
    await assertNotLastSuperUser(client, lockedUser, 'ลบผู้ใช้');
    const { artworkCount } = await queryOne(
      'SELECT count(*) AS artwork_count FROM artworks WHERE artist_id = $1',
      [userId],
      client,
    );
    if (artworkCount > 0) {
      throw conflict(`ลบไม่ได้: ผู้ใช้นี้ยังมีงาน ${artworkCount} ชิ้น`, 'USER_HAS_ARTWORKS');
    }
    const ownedFiles = await query(
      `SELECT f.storage_key FROM files f
        WHERE f.user_id = $1 OR f.subscription_id IN (SELECT subscription_id FROM subscriptions WHERE user_id = $1)`,
      [userId],
      client,
    );
    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
    await destroyUserSessions(userId, { client });
    return { user: lockedUser, storageKeys: ownedFiles.map((file) => file.storageKey) };
  });
  await storage.removeMany(storageKeys);
  return user;
}

/** Admin ตั้งรหัสผ่านใหม่ให้ (ไม่มี forgot-password ทางอีเมล) และยกเลิก session ทั้งหมดของผู้ใช้นั้น */
export async function resetUserPassword(userId, passwordHash) {
  return withTransaction(async (client) => {
    const user = await lockUser(client, userId);
    await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE user_id = $1', [userId, passwordHash]);
    await destroyUserSessions(userId, { client });
    return user;
  });
}
