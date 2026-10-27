import { config } from '../config/env.js';
import { query, queryOne, withTransaction } from '../config/db.js';
import { conflict, notFound } from '../utils/httpErrors.js';
import { storage } from './storage.js';

const dayMs = 24 * 60 * 60 * 1000;

/** BR-02: starts_at = max(now, ends_at ของสมาชิกที่ยังไม่หมด); ends_at = starts_at + 30 วัน */
export function calculateSubscriptionPeriod(now, currentEndsAt, periodDays = config.subscriptionPeriodDays) {
  const startsAt = currentEndsAt && currentEndsAt > now ? new Date(currentEndsAt) : new Date(now);
  const endsAt = new Date(startsAt.getTime() + periodDays * dayMs);
  return { startsAt, endsAt };
}

const subscriptionColumns = `
  s.subscription_id, s.user_id, s.status, s.requested_at, s.reviewed_at, s.review_note, s.starts_at, s.ends_at,
  (SELECT f.file_id FROM files f WHERE f.subscription_id = s.subscription_id AND f.kind = 'payment_slip') AS slip_file_id`;

/** วันหมดอายุของสมาชิกรอบที่ยังไม่หมด (null = ไม่มี) · ใช้ทั้งหน้าสมาชิกและตอนคำนวณรอบใหม่ */
async function findActiveUntil(userId, client) {
  const row = await queryOne(
    `SELECT max(ends_at) AS ends_at FROM subscriptions
      WHERE user_id = $1 AND status = 'approved' AND ends_at > now()`,
    [userId],
    client,
  );
  return row?.endsAt ?? null;
}

export async function getMySubscriptions(userId) {
  const items = await query(
    `SELECT ${subscriptionColumns} FROM subscriptions s WHERE s.user_id = $1 ORDER BY s.requested_at DESC`,
    [userId],
  );
  return {
    priceThb: config.subscriptionPriceThb,
    periodDays: config.subscriptionPeriodDays,
    activeUntil: await findActiveUntil(userId),
    hasPending: items.some((item) => item.status === 'pending'),
    items,
  };
}

const pendingExistsError = () => conflict('มีคำขอรอตรวจสอบอยู่แล้ว', 'PENDING_EXISTS');

/** FR-SUB-01/06: สร้างคำขอ pending + ไฟล์สลิปใน transaction เดียว; มี pending อยู่แล้ว → 409 */
export async function submitSubscription(userId, slipUpload) {
  const existingPending = await queryOne(
    `SELECT subscription_id FROM subscriptions WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );
  if (existingPending) {
    throw pendingExistsError();
  }
  const slipKey = await storage.saveFromTemp(slipUpload.tempPath);
  try {
    return await withTransaction(async (client) => {
      const [subscription] = await query(
        `INSERT INTO subscriptions (user_id) VALUES ($1) RETURNING subscription_id, status, requested_at`,
        [userId],
        client,
      );
      await client.query(
        `INSERT INTO files (kind, original_name, storage_key, mime_type, size_bytes, uploaded_by, subscription_id)
         VALUES ('payment_slip', $1, $2, $3, $4, $5, $6)`,
        [slipUpload.originalName, slipKey, slipUpload.mimeType, slipUpload.sizeBytes, userId, subscription.subscriptionId],
      );
      return subscription;
    });
  } catch (error) {
    await storage.remove(slipKey).catch(() => {});
    // คำขอ pending ซ้ำจากการส่งพร้อมกัน
    if (error.code === '23505') {
      throw pendingExistsError();
    }
    throw error;
  }
}

export async function findSubscriptionOwnerId(subscriptionId) {
  const row = await queryOne('SELECT user_id FROM subscriptions WHERE subscription_id = $1', [subscriptionId]);
  return row ? row.userId : null;
}

export async function findSlipFile(subscriptionId) {
  return queryOne(
    `SELECT file_id, original_name, storage_key, mime_type, size_bytes
       FROM files WHERE subscription_id = $1 AND kind = 'payment_slip'`,
    [subscriptionId],
  );
}

export async function listSubscriptionsForReview(status) {
  const whereClause = status === 'all' ? '' : 'WHERE s.status = $1';
  const ordering = status === 'pending' ? 's.requested_at ASC' : 's.requested_at DESC';
  return query(
    `SELECT ${subscriptionColumns}, u.email, u.display_name, reviewer.email AS reviewer_email
       FROM subscriptions s
       JOIN users u ON u.user_id = s.user_id
       LEFT JOIN users reviewer ON reviewer.user_id = s.reviewed_by
       ${whereClause}
      ORDER BY ${ordering}
      LIMIT 200`,
    status === 'all' ? [] : [status],
  );
}

async function lockPendingSubscription(client, subscriptionId) {
  const [subscription] = await query(
    `SELECT s.subscription_id, s.user_id, s.status, u.email, u.role_id, r.name AS role_name, r.is_system AS role_is_system
       FROM subscriptions s
       JOIN users u ON u.user_id = s.user_id
       JOIN roles r ON r.role_id = u.role_id
      WHERE s.subscription_id = $1
      FOR UPDATE OF s`,
    [subscriptionId],
    client,
  );
  if (!subscription) {
    throw notFound('ไม่พบคำขอนี้');
  }
  if (subscription.status !== 'pending') {
    throw conflict('คำขอนี้ถูกพิจารณาแล้ว', 'NOT_PENDING');
  }
  return subscription;
}

/** FR-SUB-03, BR-02/03: อนุมัติ + คำนวณรอบ + เปลี่ยน Member → Subscriber ใน transaction เดียว */
export async function approveSubscription(subscriptionId, reviewerUserId) {
  return withTransaction(async (client) => {
    const subscription = await lockPendingSubscription(client, subscriptionId);
    const currentEndsAt = await findActiveUntil(subscription.userId, client);
    const { startsAt, endsAt } = calculateSubscriptionPeriod(new Date(), currentEndsAt);
    await client.query(
      `UPDATE subscriptions
          SET status = 'approved', reviewed_by = $2, reviewed_at = now(), starts_at = $3, ends_at = $4
        WHERE subscription_id = $1`,
      [subscriptionId, reviewerUserId, startsAt, endsAt],
    );
    let roleChange = null;
    if (subscription.roleIsSystem && subscription.roleName === 'Member') {
      await client.query(
        `UPDATE users SET role_id = (SELECT role_id FROM roles WHERE is_system AND name = 'Subscriber'), updated_at = now()
          WHERE user_id = $1`,
        [subscription.userId],
      );
      roleChange = 'Member → Subscriber';
    }
    return { ...subscription, startsAt, endsAt, roleChange };
  });
}

export async function rejectSubscription(subscriptionId, reviewerUserId, reason) {
  return withTransaction(async (client) => {
    const subscription = await lockPendingSubscription(client, subscriptionId);
    await client.query(
      `UPDATE subscriptions SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
        WHERE subscription_id = $1`,
      [subscriptionId, reviewerUserId, reason],
    );
    return subscription;
  });
}
