import { query, queryOne } from '../config/db.js';

// ความคิดเห็น (text เท่านั้น) และการกดถูกใจของงาน

export function listComments(artworkId) {
  return query(
    `SELECT c.comment_id, c.body, c.created_at, c.user_id, u.display_name AS author_name
       FROM comments c JOIN users u ON u.user_id = c.user_id
      WHERE c.artwork_id = $1
      ORDER BY c.created_at ASC, c.comment_id ASC
      LIMIT 200`,
    [artworkId],
  );
}

export async function addComment(artworkId, userId, body) {
  const [comment] = await query(
    'INSERT INTO comments (artwork_id, user_id, body) VALUES ($1, $2, $3) RETURNING comment_id, created_at',
    [artworkId, userId, body],
  );
  return comment;
}

/** ใช้กับ guard OWN-5: เจ้าของความคิดเห็น และงานที่ความคิดเห็นอยู่ */
export function findComment(commentId) {
  return queryOne('SELECT comment_id, artwork_id, user_id FROM comments WHERE comment_id = $1', [commentId]);
}

export async function deleteComment(commentId) {
  await query('DELETE FROM comments WHERE comment_id = $1', [commentId]);
}

/** เคยดาวน์โหลดไฟล์ต้นฉบับของงานนี้หรือยัง (เงื่อนไขของการกดถูกใจ) */
export async function hasDownloaded(artworkId, userId) {
  if (!userId) {
    return false;
  }
  const row = await queryOne(
    'SELECT 1 AS downloaded FROM downloads WHERE artwork_id = $1 AND user_id = $2 LIMIT 1',
    [artworkId, userId],
  );
  return Boolean(row);
}

export async function hasLiked(artworkId, userId) {
  if (!userId) {
    return false;
  }
  const row = await queryOne('SELECT 1 AS liked FROM artwork_likes WHERE artwork_id = $1 AND user_id = $2', [artworkId, userId]);
  return Boolean(row);
}

/** กดซ้ำ = ยกเลิกถูกใจ; คืนสถานะใหม่และยอดรวม */
export async function toggleLike(artworkId, userId) {
  const removed = await queryOne(
    'DELETE FROM artwork_likes WHERE artwork_id = $1 AND user_id = $2 RETURNING artwork_id',
    [artworkId, userId],
  );
  if (!removed) {
    await query('INSERT INTO artwork_likes (artwork_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [artworkId, userId]);
  }
  const { likeCount } = await queryOne(
    'SELECT count(*)::int AS like_count FROM artwork_likes WHERE artwork_id = $1',
    [artworkId],
  );
  return { liked: !removed, likeCount };
}
