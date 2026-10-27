import { config } from '../config/env.js';
import { queryOne } from '../config/db.js';
import { writeLog } from '../services/logService.js';
import { destroySession } from './sessionLoader.js';

const guestActor = Object.freeze({
  userId: null,
  email: null,
  username: null,
  displayName: null,
  roleId: null,
  roleName: 'Guest',
  isSuperUser: false,
  isGuest: true,
});

const actorQuery = `
  SELECT u.user_id, u.email, u.username, u.display_name, u.is_active, u.role_id,
         r.name AS role_name, r.is_super_user,
         (r.is_system AND r.name = 'Subscriber') AS is_subscriber_role,
         EXISTS (
           SELECT 1 FROM subscriptions s
            WHERE s.user_id = u.user_id AND s.status = 'approved' AND s.ends_at > now()
         ) AS has_active_subscription
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
   WHERE u.user_id = $1`;

/** BR-04: Subscriber ที่ไม่เหลือสมาชิก approved จะถูกลดเป็น Member ตรวจตอนมี request เข้ามา ไม่ใช้ cron */
async function expireSubscriber(userRow, ipAddress) {
  const downgradedUser = await queryOne(
    `UPDATE users
        SET role_id = (SELECT role_id FROM roles WHERE is_system AND name = 'Member'), updated_at = now()
      WHERE user_id = $1 AND role_id = $2
      RETURNING user_id`,
    [userRow.userId, userRow.roleId],
  );
  if (downgradedUser) {
    await writeLog({
      level: 'Information',
      source: 'Subscription',
      category: 'Expire',
      actorUserId: null,
      actorLabel: 'system',
      resourceType: 'user',
      resourceId: userRow.userId,
      result: 'success',
      description: `สมาชิกของ ${userRow.email} หมดอายุ (cutoff): Subscriber → Member`,
      ipAddress,
    });
  }
  return queryOne(actorQuery, [userRow.userId]);
}

/**
 * ระบุตัวผู้เรียกของทุก request: อ่าน user และ role จาก DB ใหม่ทุกครั้ง แล้วใส่ใน req.actor
 * ไม่มี session = Guest · บัญชีถูกระงับ/ลบ หรือ session เกินอายุ = ทำลาย session แล้วเป็น Guest (FR-AUTH-07)
 */
export async function attachActor(req, res, next) {
  req.actor = guestActor;
  const userId = req.session?.userId;
  if (!userId) {
    return next();
  }
  const sessionAgeMs = Date.now() - (req.session.loginAt ?? 0);
  const isSessionExpired = sessionAgeMs > config.sessionMaxAgeMs;
  let userRow = isSessionExpired ? null : await queryOne(actorQuery, [userId]);
  if (!userRow || !userRow.isActive) {
    await destroySession(req, res);
    return next();
  }
  if (userRow.isSubscriberRole && !userRow.hasActiveSubscription) {
    userRow = await expireSubscriber(userRow, req.ip);
  }
  req.actor = Object.freeze({
    userId: userRow.userId,
    email: userRow.email,
    username: userRow.username,
    displayName: userRow.displayName,
    roleId: userRow.roleId,
    roleName: userRow.roleName,
    isSuperUser: userRow.isSuperUser,
    isGuest: false,
  });
  return next();
}
