import { pool, query } from '../config/db.js';
import { escapeLikePattern } from '../utils/format.js';

function truncate(value, maxLength) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function describeActor(actor) {
  if (!actor || actor.isGuest) {
    return 'Guest';
  }
  return `${actor.email} (${actor.roleName})`;
}

/**
 * เขียน Log หนึ่งแถว: description ต้องประกอบจากฟิลด์ที่ whitelist โดยผู้เรียกเท่านั้น
 * (ห้ามส่ง password, hash, session id, token หรือ request body มา) · FR-LOG-04
 */
export async function writeLog(entry, client = pool) {
  await client.query(
    `INSERT INTO logs (level, source, category, actor_user_id, actor_label, resource_type, resource_id,
                       result, description, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.level,
      entry.source,
      entry.category,
      entry.actorUserId ?? null,
      truncate(entry.actorLabel, 300),
      truncate(entry.resourceType, 30),
      truncate(entry.resourceId, 64),
      entry.result,
      truncate(entry.description ?? '', 2000),
      truncate(entry.ipAddress, 45),
    ],
  );
}

/** เขียน Log โดยไม่ให้ความผิดพลาดของการเขียน Log ทำให้คำขอหลักล้มเหลว */
export function writeLogSafely(entry) {
  writeLog(entry).catch((error) => {
    console.error(`[audit] failed to write log ${entry.source}/${entry.category}: ${error.message}`);
  });
}

export async function listLogs(filters) {
  const conditions = [];
  const params = [];
  const addCondition = (sqlTemplate, value) => {
    params.push(value);
    conditions.push(sqlTemplate.replace('?', `$${params.length}`));
  };
  if (filters.from) addCondition('l.logged_at >= ?', filters.from);
  if (filters.to) addCondition('l.logged_at <= ?', filters.to);
  if (filters.level) addCondition('l.level = ?', filters.level);
  if (filters.source) addCondition('l.source = ?', filters.source);
  if (filters.category) addCondition('l.category = ?', filters.category);
  if (filters.email) addCondition(`l.actor_label ILIKE ? ESCAPE '\\'`, `%${escapeLikePattern(filters.email)}%`);

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [{ totalCount }] = await query(`SELECT count(*) AS total_count FROM logs l ${whereClause}`, params);
  const { page, pageSize } = filters;
  const offset = (page - 1) * pageSize;
  const items = await query(
    `SELECT l.log_id, l.logged_at, l.level, l.source, l.category, l.actor_user_id, l.actor_label,
            l.resource_type, l.resource_id, l.result, l.description, l.ip_address
       FROM logs l ${whereClause}
      ORDER BY l.logged_at DESC, l.log_id DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    params,
  );
  return { items, page, pageSize, total: totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) };
}
