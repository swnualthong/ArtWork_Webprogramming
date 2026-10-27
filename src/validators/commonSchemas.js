import { z } from 'zod';

// schema ใช้ร่วมกันทั้งฟอร์มเว็บ (ค่าเป็น string) และ JSON API จึง coerce ชนิดข้อมูลเสมอ

export const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const idParams = (...names) => z.object(Object.fromEntries(names.map((name) => [name, positiveId])));

export const paginationFields = (defaultPageSize) => ({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(defaultPageSize),
});

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'อีเมลมีรูปแบบไม่ถูกต้อง' }));

export const usernameField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, 'username ใช้ได้เฉพาะ a-z, 0-9, _ ยาว 3–20 ตัว');

// bcrypt ใช้ได้สูงสุด 72 bytes จึงนับเป็น byte ไม่ใช่จำนวนตัวอักษร
export const passwordField = z
  .string()
  .refine((value) => {
    const byteLength = Buffer.byteLength(value, 'utf8');
    return byteLength >= 8 && byteLength <= 72;
  }, 'รหัสผ่านต้องยาว 8–72 ไบต์');

/** checkbox / select ในฟอร์มส่งเป็น 'true' / 'false' / 'on'; JSON ส่งเป็น boolean */
export const booleanField = z.preprocess((value) => {
  if (value === 'true' || value === 'on') return true;
  if (value === 'false' || value === '') return false;
  return value;
}, z.boolean());

/** ช่องว่างในฟอร์ม = ไม่ได้กรอก */
export const emptyAsUndefined = (schema) => z.preprocess((value) => (value === '' ? undefined : value), schema);
