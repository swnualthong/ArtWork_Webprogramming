/**
 * npm run db:init: ตั้งต้นฐานข้อมูลที่ยังว่าง (container เรียกทุกครั้งที่เริ่ม)
 *
 * - ฐานมีตารางอยู่แล้ว: ข้าม ไม่แตะข้อมูลเดิม
 * - มีโฟลเดอร์ SeedData ครบ: โหลดข้อมูลสาธิต (schema + seed.sql + รูป)
 * - ไม่มี SeedData หรือไม่ครบ หรือสั่ง --base: schema พื้นฐาน (Role, Resource, Permission, ACL, แท็ก)
 *   + Admin คนแรกจาก ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD
 *
 * ล้างฐานแล้วโหลดข้อมูลสาธิตใหม่ใช้ npm run demo:reset
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { emailField, passwordField, usernameField } from '../src/validators/commonSchemas.js';
import {
  copySeedFiles,
  findSeedFiles,
  isInitialized,
  loadProjectEnv,
  loadSchemaAndBase,
  loadSchemaAndSeed,
  readSeedSql,
  uploadDir,
  withClient,
} from './lib/demoData.mjs';

const BCRYPT_COST = 12;

async function readAdminFromEnv() {
  const fields = [
    ['ADMIN_USERNAME', usernameField],
    ['ADMIN_EMAIL', emailField],
    ['ADMIN_PASSWORD', passwordField],
  ];
  const values = {};
  for (const [name, schema] of fields) {
    const result = schema.safeParse(process.env[name] ?? '');
    if (!result.success) {
      throw new Error(`${name} ไม่ถูกต้อง: ${result.error.issues[0].message}`);
    }
    values[name] = result.data;
  }
  return {
    username: values.ADMIN_USERNAME,
    email: values.ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(values.ADMIN_PASSWORD, BCRYPT_COST),
  };
}

/** ใช้ข้อมูลสาธิตได้เมื่อไม่ได้สั่ง --base และรูปใน SeedData ครบทุกไฟล์ */
async function demoFilesIfComplete(seedSql) {
  if (process.argv.includes('--base')) {
    return null;
  }
  const { files, missing } = await findSeedFiles(seedSql);
  if (missing.length === files.length) {
    console.log('db:init: ไม่พบ SeedData ใช้ schema พื้นฐาน');
    return null;
  }
  if (missing.length > 0) {
    console.warn(`db:init: SeedData ขาด ${missing.length} ไฟล์ (${missing.slice(0, 3).join(', ')}...) ใช้ schema พื้นฐานแทน`);
    return null;
  }
  return files;
}

loadProjectEnv();
const seedSql = await readSeedSql();

await withClient(process.env.DATABASE_URL, async (client) => {
  if (await isInitialized(client)) {
    console.log('db:init: ฐานมีตารางอยู่แล้ว ข้าม (ล้างแล้วโหลดข้อมูลสาธิตใหม่ใช้ npm run demo:reset)');
    return;
  }
  const demoFiles = await demoFilesIfComplete(seedSql);
  if (demoFiles) {
    await loadSchemaAndSeed(client, seedSql);
    await fs.mkdir(path.join(uploadDir(), 'tmp'), { recursive: true });
    await copySeedFiles(demoFiles);
    console.log(`db:init: โหลดข้อมูลสาธิตแล้ว (รูป ${demoFiles.length} ไฟล์) · บัญชีดูที่หัวไฟล์ db/seed.sql`);
    return;
  }
  const admin = await readAdminFromEnv();
  await loadSchemaAndBase(client, seedSql, admin);
  console.log(`db:init: สร้าง schema พื้นฐานแล้ว (Role, Resource, Permission, ACL) · Admin: ${admin.username} (${admin.email})`);
});
