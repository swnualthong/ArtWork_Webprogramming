import { z } from 'zod';
import { booleanField, emailField, emptyAsUndefined, passwordField, positiveId, usernameField } from './commonSchemas.js';

const roleName = z.string().trim().min(2).max(30);
const shortDescription = z.string().trim().max(200);

export const createRoleSchema = z.strictObject({ name: roleName, description: shortDescription.default('') });
export const updateRoleSchema = z.strictObject({ name: roleName.optional(), description: shortDescription.optional() });

// ชื่อ resource และ action: ตัวพิมพ์เล็กขึ้นต้น 2–20 ตัวอักษร (ตรงกับ CHECK ในตาราง)
const nameToken = (label) => z.string().trim().regex(/^[a-z][a-zA-Z]{1,19}$/, `${label} ต้องเป็นตัวอักษรอังกฤษ 2–20 ตัว ขึ้นต้นด้วยตัวพิมพ์เล็ก`);

export const createResourceSchema = z.strictObject({ resourceName: nameToken('ชื่อ Resource'), description: shortDescription.default('') });
// แก้ได้เฉพาะคำอธิบาย: ส่งชื่อมาจะถูกปฏิเสธ (strict)
export const updateResourceSchema = z.strictObject({ description: shortDescription });

export const createPermissionSchema = z.strictObject({
  resourceId: positiveId,
  action: nameToken('action'),
  description: shortDescription.default(''),
});
export const updatePermissionSchema = z.strictObject({ description: shortDescription });

// กำหนด (true) หรือยกเลิก (false) หนึ่งช่องของ Access Matrix
export const permissionGrantSchema = z.strictObject({ granted: booleanField });

export const userUpdateSchema = z
  .strictObject({ roleId: positiveId.optional(), isActive: booleanField.optional() })
  .refine((body) => body.roleId !== undefined || body.isActive !== undefined, 'ไม่มีข้อมูลที่จะแก้ไข');

export const passwordResetSchema = z.strictObject({ newPassword: passwordField });

export const createUserSchema = z.strictObject({
  username: usernameField,
  email: emailField,
  displayName: z.string().trim().min(2).max(40),
  password: passwordField,
  roleId: positiveId,
});

// หน้าผู้ใช้: กรองตาม Role และค้นด้วย username/อีเมล
export const userListQuery = z.strictObject({
  roleId: emptyAsUndefined(positiveId.optional()),
  user: z.string().trim().max(254).default(''),
});

export const reviewQuery = z.strictObject({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') });

export const rejectSchema = z.strictObject({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ปฏิเสธ').max(500) });

// ช่อง datetime-local ของฟอร์มไม่มีโซนเวลา → ตีความเป็นเวลาไทย (+07:00)
const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const optionalDate = emptyAsUndefined(z.preprocess(
  (value) => (typeof value === 'string' && localDateTimePattern.test(value) ? `${value}:00+07:00` : value),
  z.coerce.date().optional(),
));
const optionalText = (maxLength) => emptyAsUndefined(z.string().trim().max(maxLength).optional());

export const logPageSizes = [25, 50, 100];

export const logQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().refine((size) => logPageSizes.includes(size), 'ต้องเป็น 25, 50 หรือ 100').default(50),
  from: optionalDate,
  to: optionalDate,
  level: emptyAsUndefined(z.enum(['Information', 'Warning', 'Error']).optional()),
  source: optionalText(20),
  category: optionalText(30),
  email: optionalText(254),
});
