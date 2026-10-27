import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';

// ที่เก็บไฟล์บนดิสก์ นอก web root; ไม่มี express.static ชี้มาที่นี่ (PDF §9: ไฟล์จำกัดสิทธิ์ไม่มี URL สาธารณะ)
const filesDir = path.join(config.uploadDir, 'files');
const tempDir = path.join(config.uploadDir, 'tmp');
const storageKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function resolveStoragePath(storageKey) {
  // storage_key มาจาก Server เท่านั้น แต่ตรวจซ้ำเพื่อกัน path traversal
  if (!storageKeyPattern.test(storageKey)) {
    throw new Error('Invalid storage key');
  }
  return path.join(filesDir, storageKey);
}

export const storage = {
  tempDir,

  async init() {
    await fsp.mkdir(filesDir, { recursive: true });
    await fsp.mkdir(tempDir, { recursive: true });
  },

  /** ย้ายไฟล์ชั่วคราวที่ผ่านการตรวจแล้วเข้าที่เก็บ คืน storage_key (UUID v4 ไม่ชนกัน) */
  async saveFromTemp(tempPath) {
    const storageKey = randomUUID();
    await fsp.rename(tempPath, resolveStoragePath(storageKey));
    return storageKey;
  },

  async saveBuffer(buffer) {
    const storageKey = randomUUID();
    await fsp.writeFile(resolveStoragePath(storageKey), buffer, { flag: 'wx' });
    return storageKey;
  },

  /** เปิด stream สำหรับส่งไฟล์; ไฟล์หายจากดิสก์ = error code ENOENT */
  async openReadStream(storageKey) {
    const filePath = resolveStoragePath(storageKey);
    await fsp.access(filePath, fs.constants.R_OK);
    return fs.createReadStream(filePath);
  },

  async remove(storageKey) {
    await fsp.rm(resolveStoragePath(storageKey), { force: true });
  },

  async removeMany(storageKeys) {
    await Promise.all(storageKeys.map((storageKey) => this.remove(storageKey).catch(() => {})));
  },

  /** path บนดิสก์ สำหรับไลบรารีที่ต้องอ่านไฟล์เอง (sharp) */
  localPath(storageKey) {
    return resolveStoragePath(storageKey);
  },

  async clearAll() {
    await fsp.rm(config.uploadDir, { recursive: true, force: true });
    await this.init();
  },
};
