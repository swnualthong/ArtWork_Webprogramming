/**
 * ตั้งต้นฐานข้อมูล ใช้ร่วมกันโดย npm run db:init และ npm run demo:reset
 * - ข้อมูลสาธิต = db/schema.sql + db/seed.sql + รูปจาก SeedData
 * - schema พื้นฐาน = db/schema.sql + "ส่วน 0" ของ seed.sql (Role, Resource, Permission, ACL, แท็ก) + Admin คนแรก
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** อ่าน .env ของโปรเจกต์ (ค่าที่ตั้งใน environment อยู่แล้วชนะ) */
export function loadProjectEnv() {
  try {
    process.loadEnvFile(path.join(projectRoot, '.env'));
  } catch {
    // ไม่มี .env ก็ได้ ถ้าตั้ง DATABASE_URL ผ่าน environment แล้ว (เช่นใน Docker)
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  }
}

export function seedDataDir() {
  return path.resolve(process.env.SEED_DATA_DIR ?? path.join(projectRoot, '..', 'SeedData'));
}

export function uploadDir() {
  return path.resolve(projectRoot, process.env.UPLOAD_DIR ?? './uploads');
}

export async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function isInitialized(client) {
  const result = await client.query("SELECT to_regclass('public.roles') IS NOT NULL AS initialized");
  return result.rows[0].initialized;
}

export async function readSeedSql() {
  return fs.readFile(path.join(projectRoot, 'db/seed.sql'), 'utf8');
}

async function readSchemaSql() {
  return fs.readFile(path.join(projectRoot, 'db/schema.sql'), 'utf8');
}

// บรรทัดไฟล์ใน seed.sql ส่วน 4: ('<storage_key uuid>', '<path ใน SeedData>', ...
const seedFilePattern = /^\s+\('([0-9a-f-]{36})', '([^']+)'/gm;

/** รูปที่ seed.sql อ้างถึง แยกเป็นไฟล์ที่มีจริงใน SeedData กับไฟล์ที่ขาด */
export async function findSeedFiles(seedSql) {
  const sourceDir = seedDataDir();
  const files = [...seedSql.matchAll(seedFilePattern)].map(([, storageKey, sourceName]) => ({
    storageKey,
    sourcePath: path.join(sourceDir, sourceName),
  }));
  const missing = [];
  for (const file of files) {
    await fs.access(file.sourcePath).catch(() => missing.push(path.relative(sourceDir, file.sourcePath)));
  }
  return { files, missing };
}

/** schema + seed.sql ทั้งไฟล์ใน transaction เดียว (seed.sql มี BEGIN / COMMIT ของตัวเอง ซ้อนได้แค่ warning) */
export async function loadSchemaAndSeed(client, seedSql) {
  await client.query('BEGIN');
  try {
    await client.query(await readSchemaSql());
    await client.query(seedSql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** ส่วน 0 ของ seed.sql (ตั้งแต่หัวข้อ "ส่วน 0" ถึงก่อน "ส่วน 1") */
function baseSectionOf(seedSql) {
  const start = seedSql.indexOf('-- ส่วน 0');
  const end = seedSql.indexOf('-- ส่วน 1');
  if (start < 0 || end < start) {
    throw new Error('หาหัวข้อ "-- ส่วน 0" / "-- ส่วน 1" ใน db/seed.sql ไม่พบ');
  }
  return seedSql.slice(start, end);
}

/** schema + ส่วน 0 ของ seed.sql + Admin คนแรก ใน transaction เดียว พังกลางทางฐานจะกลับเป็นว่าง */
export async function loadSchemaAndBase(client, seedSql, admin) {
  await client.query('BEGIN');
  try {
    await client.query(await readSchemaSql());
    await client.query(baseSectionOf(seedSql));
    await client.query(
      `INSERT INTO users (email, username, password_hash, display_name, role_id)
       SELECT $1, $2, $3, 'Administrator', role_id FROM roles WHERE is_super_user`,
      [admin.email, admin.username, admin.passwordHash],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** คัดลอกรูปเข้า <uploadDir>/files/<storage_key> (ชื่อไฟล์ไม่มีนามสกุลตามที่ระบบเก็บ) */
export async function copySeedFiles(files) {
  const filesDir = path.join(uploadDir(), 'files');
  await fs.mkdir(filesDir, { recursive: true });
  for (const file of files) {
    await fs.copyFile(file.sourcePath, path.join(filesDir, file.storageKey));
  }
}
