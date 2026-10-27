import { query, queryOne, withTransaction } from '../config/db.js';
import { storage } from './storage.js';

export async function getProfile(userId) {
  return queryOne(
    `SELECT u.user_id, u.email, u.username, u.display_name, u.bio, u.created_at, r.name AS role_name,
            EXISTS (SELECT 1 FROM files f WHERE f.user_id = u.user_id AND f.kind = 'avatar') AS has_avatar
       FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [userId],
  );
}

/** โปรไฟล์ที่คนอื่นเห็น: ไม่มีอีเมล ไม่มี Role · ยอดรวมของงานทั้งหมด */
export async function getPublicProfile(userId) {
  return queryOne(
    `SELECT u.user_id, u.username, u.display_name, u.bio, u.created_at,
            u.role_id, r.name AS role_name, r.is_super_user,
            (SELECT count(*)::int FROM artworks a WHERE a.artist_id = u.user_id) AS artwork_count,
            (SELECT count(*)::int FROM artwork_likes l JOIN artworks a ON a.artwork_id = l.artwork_id
              WHERE a.artist_id = u.user_id) AS like_count
       FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = $1 AND u.is_active`,
    [userId],
  );
}

export async function updateProfile(userId, { displayName, bio }) {
  return queryOne(
    `UPDATE users SET display_name = COALESCE($2, display_name), bio = COALESCE($3, bio), updated_at = now()
      WHERE user_id = $1 RETURNING user_id, email, display_name, bio`,
    [userId, displayName ?? null, bio ?? null],
  );
}

export async function findAvatarFile(userId) {
  return queryOne(
    `SELECT original_name, storage_key, mime_type, size_bytes FROM files WHERE user_id = $1 AND kind = 'avatar'`,
    [userId],
  );
}

/** แทนที่รูปโปรไฟล์: เขียนแถวใหม่ใน transaction แล้วลบไฟล์เก่าหลัง commit */
export async function replaceAvatar(userId, avatarUpload) {
  const avatarKey = await storage.saveFromTemp(avatarUpload.tempPath);
  let previousKeys;
  try {
    previousKeys = await withTransaction(async (client) => {
      const removed = await query(
        `DELETE FROM files WHERE user_id = $1 AND kind = 'avatar' RETURNING storage_key`,
        [userId],
        client,
      );
      await client.query(
        `INSERT INTO files (kind, original_name, storage_key, mime_type, size_bytes, uploaded_by, user_id)
         VALUES ('avatar', $1, $2, $3, $4, $5, $5)`,
        [avatarUpload.originalName, avatarKey, avatarUpload.mimeType, avatarUpload.sizeBytes, userId],
      );
      return removed.map((row) => row.storageKey);
    });
  } catch (error) {
    await storage.remove(avatarKey);
    throw error;
  }
  await storage.removeMany(previousKeys);
}

/** คลัง: งานที่เคยดาวน์โหลด ไม่ซ้ำ ล่าสุดก่อน (OWN-3: เฉพาะของผู้เรียก) */
export async function listLibrary(userId) {
  return query(
    `SELECT a.artwork_id, a.title, a.visibility, a.artist_id, u.display_name AS artist_name,
            max(d.downloaded_at) AS last_downloaded_at, count(*) AS download_count
       FROM downloads d
       JOIN artworks a ON a.artwork_id = d.artwork_id
       JOIN users u ON u.user_id = a.artist_id
      WHERE d.user_id = $1
      GROUP BY a.artwork_id, a.title, a.visibility, a.artist_id, u.display_name
      ORDER BY last_downloaded_at DESC`,
    [userId],
  );
}
