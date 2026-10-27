/**
 * Permission ทั้งหมดที่ Code ตรวจอยู่จริง (requirePermission / requireAnyPermission / assertPermission / hasPermission)
 * key = resource.action (resource_name จากตาราง resources + action จากตาราง permissions)
 * - หน้า Permission เพิ่มได้เฉพาะ key ในรายการนี้ ชื่ออื่นไม่ผูกกับฟังก์ชันใดจึงไม่มีผลป้องกัน (คำถามท้ายใบงานข้อ 5)
 * - requirePermission ไม่ยอมรับ key ที่ไม่อยู่ในรายการ (ระบบไม่ start) กันพิมพ์ key ผิดใน Code
 * - usedBy = ฟังก์ชันที่ key นี้คุม แสดงในหน้า Permission
 * การจัดการ ผู้ใช้ / Role / Resource / Permission / ACL เป็นของ Admin เท่านั้น (requireAdmin) จึงไม่มี key ในรายการนี้
 */
export const permissionCatalog = Object.freeze([
  {
    key: 'artwork.read',
    description: 'ดูงาน ค้นหา และหน้าโปรไฟล์ศิลปิน',
    usedBy: 'หน้าหลัก, ค้นหา, หน้างาน, ภาพการ์ด/ภาพเลื่อน',
  },
  { key: 'artwork.create', description: 'ลงงานใหม่พร้อมรูป', usedBy: 'ฟอร์มลงงาน, POST /api/artworks' },
  { key: 'artwork.update', description: 'แก้ไขงานและรูปของตน (OWN-1)', usedBy: 'แก้ไขงาน, PATCH /api/artworks/:id' },
  { key: 'artwork.delete', description: 'ลบงานของตน (OWN-1)', usedBy: 'ปุ่มลบงาน, DELETE /api/artworks/:id' },
  { key: 'artwork.like', description: 'กดถูกใจงาน (หลังดาวน์โหลด)', usedBy: 'ปุ่มถูกใจ' },
  {
    key: 'file.download',
    description: 'ดาวน์โหลดและดูภาพชัดของงานสมาชิก (งานฟรีแค่ login)',
    usedBy: 'ดาวน์โหลดงานสมาชิก, ภาพไม่เบลอ',
  },
  { key: 'comment.create', description: 'แสดงความคิดเห็น', usedBy: 'ฟอร์มคอมเมนต์' },
  { key: 'comment.delete', description: 'ลบความคิดเห็นของตน (OWN-5)', usedBy: 'ปุ่มลบคอมเมนต์ของตน' },
  { key: 'comment.moderate', description: 'ลบความคิดเห็นของทุกคน', usedBy: 'ปุ่มลบคอมเมนต์ของคนอื่น' },
  { key: 'subscription.read', description: 'ดูสถานะและคำขอสมาชิกของตน (OWN-2)', usedBy: 'หน้าสมาชิก, สลิปของตน' },
  { key: 'subscription.create', description: 'ส่งคำขอสมัครสมาชิกพร้อมสลิป', usedBy: 'ฟอร์มส่งสลิป' },
  { key: 'subscription.review', description: 'ดูคิวคำขอสมาชิกและสลิปของทุกคน', usedBy: 'หน้าคำขอสมาชิก (ศูนย์ควบคุม)' },
  { key: 'subscription.approve', description: 'อนุมัติ/ปฏิเสธคำขอสมาชิก', usedBy: 'ปุ่มอนุมัติ/ปฏิเสธ' },
  { key: 'library.read', description: 'ดูคลังงานที่ดาวน์โหลดของตน (OWN-3)', usedBy: 'เมนูคลัง' },
  { key: 'profile.read', description: 'ดูโปรไฟล์และข้อมูลบัญชีของตน (OWN-4)', usedBy: 'เมนูโปรไฟล์, หน้าแก้ไข' },
  {
    key: 'profile.update',
    description: 'แก้โปรไฟล์ รหัสผ่าน และรูปโปรไฟล์ของตน (OWN-4)',
    usedBy: 'บันทึกโปรไฟล์, เปลี่ยนรหัสผ่าน, รูปโปรไฟล์',
  },
  { key: 'log.read', description: 'ดูและกรอง Log', usedBy: 'หน้า Logs (ศูนย์ควบคุม), GET /api/admin/logs' },
]);

export const permissionKeys = new Set(permissionCatalog.map((permission) => permission.key));
const catalogIndex = new Map(permissionCatalog.map((permission, index) => [permission.key, { ...permission, index }]));

/** หน้าในศูนย์ควบคุมที่มอบให้ Role อื่นผ่าน ACL ได้ (นอกนั้น Admin เท่านั้น) */
export const adminAreaKeys = Object.freeze(['subscription.review', 'log.read']);

export function catalogEntry(permissionKey) {
  return catalogIndex.get(permissionKey);
}

export function splitKey(permissionKey) {
  const [resource, action = ''] = permissionKey.split('.');
  return { resource, action };
}

/** เรียง Permission ตามลำดับในแคตตาล็อก (read, create, update, delete, ...) · ที่ไม่อยู่ในรายการไปท้ายสุด */
export function byCatalogOrder(a, b) {
  const order = (key) => catalogIndex.get(key)?.index ?? permissionCatalog.length;
  return order(a.key) - order(b.key);
}
