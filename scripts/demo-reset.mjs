/**
 * npm run demo:reset: ล้างฐานข้อมูลและไฟล์ที่อัปโหลด แล้วโหลดข้อมูลสาธิตใหม่ทั้งหมด (ใช้ก่อนนำเสนอแต่ละรอบ)
 *
 * 1. ตรวจว่ารูปใน SeedData ครบก่อน ถ้าไม่ครบจะหยุดโดยไม่แตะฐานข้อมูล
 * 2. DROP SCHEMA public แล้วรัน db/schema.sql + db/seed.sql (ตาราง session หายด้วย ทุกคนต้อง login ใหม่)
 * 3. ล้าง uploads/files และ uploads/tmp แล้วคัดลอกรูปตาม seed.sql
 *
 * ใช้ฐานจาก DATABASE_URL ใน .env · ไม่ทำงานเมื่อ NODE_ENV=production · ไม่ต้อง restart Server (ระบบไม่ cache สิทธิ์)
 * ตั้งต้นฐานว่างโดยไม่ลบข้อมูลใช้ npm run db:init
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  copySeedFiles,
  findSeedFiles,
  loadProjectEnv,
  loadSchemaAndSeed,
  readSeedSql,
  seedDataDir,
  uploadDir,
  withClient,
} from './lib/demoData.mjs';

loadProjectEnv();
if (process.env.NODE_ENV === 'production') {
  console.error('demo:reset: ปฏิเสธเพราะ NODE_ENV=production (สคริปต์นี้ลบข้อมูลทั้งหมด)');
  process.exit(1);
}

const databaseUrl = new URL(process.env.DATABASE_URL);
const databaseName = databaseUrl.pathname.slice(1);
console.log(
  `demo:reset: ฐาน "${databaseName}" ที่ ${databaseUrl.hostname}:${databaseUrl.port || 5432} · ไฟล์ ${uploadDir()}`,
);

const seedSql = await readSeedSql();
const { files: seedFiles, missing } = await findSeedFiles(seedSql);
if (missing.length > 0) {
  throw new Error(`SeedData (${seedDataDir()}) ขาดไฟล์ ${missing.length} ไฟล์: ${missing.join(', ')}`);
}
console.log(`demo:reset: SeedData ครบ ${seedFiles.length} ไฟล์ (${seedDataDir()})`);

const summary = await withClient(process.env.DATABASE_URL, async (client) => {
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await loadSchemaAndSeed(client, seedSql);
  const counts = await client.query(`SELECT
      (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM artworks) AS artworks,
      (SELECT count(*) FROM files) AS files, (SELECT count(*) FROM permissions) AS permissions,
      (SELECT count(*) FROM logs) AS logs`);
  const accounts = await client.query(`SELECT u.username, r.name AS role
    FROM users u JOIN roles r ON r.role_id = u.role_id
    ORDER BY r.role_id DESC, u.username`);
  return { counts: counts.rows[0], accounts: accounts.rows };
});

for (const folder of ['files', 'tmp']) {
  await fs.rm(path.join(uploadDir(), folder), { recursive: true, force: true });
}
await fs.mkdir(path.join(uploadDir(), 'tmp'), { recursive: true });
await copySeedFiles(seedFiles);

const { counts, accounts } = summary;
console.log(
  `demo:reset: เสร็จ · ผู้ใช้ ${counts.users} · งาน ${counts.artworks} · ไฟล์ ${counts.files}`
  + ` · Permission ${counts.permissions} · Log ${counts.logs}`,
);
const accountList = accounts.map((account) => `${account.username} (${account.role})`).join(', ');
console.log(`บัญชี (รหัสผ่านดูที่หัวไฟล์ db/seed.sql): ${accountList}`);
