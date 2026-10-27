import { badRequest } from '../utils/httpErrors.js';

const fieldLabels = {
  email: 'อีเมล',
  password: 'รหัสผ่าน',
  currentPassword: 'รหัสผ่านเดิม',
  newPassword: 'รหัสผ่านใหม่',
  displayName: 'ชื่อที่แสดง',
  bio: 'คำแนะนำตัว',
  title: 'ชื่องาน',
  description: 'คำอธิบาย',
  tags: 'แท็ก',
  q: 'คำค้นหา',
  name: 'ชื่อ',
  key: 'Permission key',
  reason: 'เหตุผล',
  page: 'หน้า',
  pageSize: 'จำนวนต่อหน้า',
  granted: 'การให้สิทธิ์',
  roleId: 'Role',
};

function describeIssue(issue) {
  const fieldName = issue.path.find((part) => typeof part === 'string');
  const field = fieldLabels[fieldName] ?? fieldName ?? 'ข้อมูล';
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'array' ? `${field}น้อยเกินไป` : `${field}สั้นหรือน้อยเกินไป (ขั้นต่ำ ${issue.minimum})`;
    case 'too_big':
      return issue.origin === 'array' ? `${field}มีได้ไม่เกิน ${issue.maximum} รายการ` : `${field}ยาวหรือมากเกินไป (สูงสุด ${issue.maximum})`;
    case 'unrecognized_keys':
      return `มีช่องข้อมูลที่ไม่รู้จัก: ${issue.keys.join(', ')}`;
    case 'invalid_format':
      return issue.message && !issue.message.startsWith('Invalid') ? issue.message : `${field}มีรูปแบบไม่ถูกต้อง`;
    case 'invalid_type':
      return `${field}ไม่ถูกต้องหรือยังไม่ได้กรอก`;
    case 'invalid_value':
      return `${field}มีค่าที่ไม่รองรับ`;
    default:
      return issue.message;
  }
}

export function validationError(zodError) {
  return badRequest(describeIssue(zodError.issues[0]));
}

/** ตรวจด้วย schema แล้วคืนข้อมูลที่ผ่าน ไม่ผ่านให้ throw 400 (ใช้ใน controller ที่ render ฟอร์มเอง) */
export function parseOrThrow(schema, input) {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw validationError(parsed.error);
  }
  return parsed.data;
}

/** ตรวจ params / query / body ด้วย schema ฝั่ง Server ผลที่ผ่านแล้วอยู่ใน req.validated */
export function validateRequest(schemas) {
  return function requestValidator(req, _res, next) {
    req.validated ??= {};
    for (const part of ['params', 'query', 'body']) {
      if (schemas[part]) {
        req.validated[part] = parseOrThrow(schemas[part], req[part]);
      }
    }
    next();
  };
}
