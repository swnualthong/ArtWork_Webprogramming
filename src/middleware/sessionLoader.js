import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { config } from '../config/env.js';
import { pool } from '../config/db.js';

export const sessionCookieName = 'artwork.sid';

const PgSessionStore = connectPgSimple(session);

// session เก็บฝั่ง Server ใน PostgreSQL ในนั้นมีแค่ userId กับเวลาที่ login
export function sessionLoader() {
  return session({
    name: sessionCookieName,
    store: new PgSessionStore({
      pool,
      tableName: 'session',
      createTableIfMissing: false,
      pruneSessionInterval: 15 * 60,
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: config.sessionMaxAgeMs,
    },
  });
}

export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

export function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

export function destroySession(req, res) {
  res.clearCookie(sessionCookieName);
  if (!req.session) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

/** ยกเลิก session ทั้งหมดของผู้ใช้ (ระงับบัญชี / Admin ตั้งรหัสใหม่ / เปลี่ยนรหัสผ่าน) */
export async function destroyUserSessions(userId, { exceptSessionId = null, client = pool } = {}) {
  await client.query(
    `DELETE FROM session WHERE sess->>'userId' = $1 AND ($2::text IS NULL OR sid <> $2)`,
    [String(userId), exceptSessionId],
  );
}
