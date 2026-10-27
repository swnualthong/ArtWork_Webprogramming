import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';
import { query, queryOne } from '../config/db.js';
import { conflict } from '../utils/httpErrors.js';

// ใช้เทียบเวลาเมื่อไม่พบอีเมล เพื่อไม่ให้เวลาตอบต่างจากกรณีรหัสผิด
const dummyPasswordHash = bcrypt.hashSync('artwork-dummy-password', config.bcryptCost);

/** bcrypt สร้าง salt ใหม่ทุกครั้งและเก็บ salt ไว้ใน hash */
export function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptCost);
}

/** สมัครเอง = Role Member เสมอ (ไม่รับ role จาก client) · ศูนย์ควบคุมสร้างผู้ใช้ให้ส่ง roleId มาได้ */
export async function registerUser({ email, username, password, displayName, roleId = null }) {
  const duplicateUser = await queryOne(
    'SELECT email = $1 AS same_email FROM users WHERE email = $1 OR username = $2',
    [email, username],
  );
  if (duplicateUser) {
    throw duplicateUser.sameEmail
      ? conflict('อีเมลนี้ถูกใช้สมัครแล้ว', 'EMAIL_TAKEN')
      : conflict(`username "${username}" ถูกใช้แล้ว`, 'USERNAME_TAKEN');
  }
  const [createdUser] = await query(
    `INSERT INTO users (email, username, password_hash, display_name, role_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT role_id FROM roles WHERE is_system AND name = 'Member')))
     RETURNING user_id, email, username, display_name`,
    [email, username, await hashPassword(password), displayName, roleId],
  );
  return createdUser;
}

/**
 * ตรวจรหัสผ่านด้วย bcrypt.compare · login ได้ทั้งอีเมลและ username
 * คืน { outcome: 'success' | 'invalid' | 'suspended', user }
 */
export async function verifyCredentials(email, password) {
  const user = await queryOne(
    `SELECT u.user_id, u.email, u.password_hash, u.is_active, r.name AS role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.email = $1 OR u.username = $1`,
    [email],
  );
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? dummyPasswordHash);
  if (!user || !passwordMatches) {
    return { outcome: 'invalid', user: user ? { userId: user.userId, email: user.email } : null };
  }
  const publicUser = { userId: user.userId, email: user.email, roleName: user.roleName };
  return { outcome: user.isActive ? 'success' : 'suspended', user: publicUser };
}

export async function passwordMatchesCurrent(userId, password) {
  const user = await queryOne('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
  return bcrypt.compare(password, user.passwordHash);
}

export async function updatePassword(userId, newPassword) {
  const passwordHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE user_id = $1', [userId, passwordHash]);
}
