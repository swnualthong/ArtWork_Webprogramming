import { z } from 'zod';
import { emailField, passwordField, usernameField } from './commonSchemas.js';

export const registerSchema = z.strictObject({
  email: emailField,
  username: usernameField,
  password: passwordField,
  displayName: z.string().trim().min(2).max(40),
});

// ช่อง email รับได้ทั้งอีเมลและ username
export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(1024),
  next: z.string().max(500).optional(),
});

// strict: roleId / isActive / passwordHash ถูกปฏิเสธ (กัน mass assignment)
export const profileUpdateSchema = z
  .strictObject({
    displayName: z.string().trim().min(2).max(40).optional(),
    bio: z.string().trim().max(300).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'ไม่มีข้อมูลที่จะแก้ไข');

export const passwordChangeSchema = z.strictObject({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordField,
});
