// ใช้ทั้งใน Server และใน EJS view (ผ่าน app.locals)

/** เวลาเก็บเป็น UTC แสดงผลเป็น Asia/Bangkok รูปแบบ YYYY-MM-DD HH:mm:ss */
export function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

export function formatBytes(byteCount) {
  const bytes = Number(byteCount);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** escape ตัวอักษรพิเศษของ LIKE/ILIKE (\ % _) ใช้คู่กับ ESCAPE '\' */
export function escapeLikePattern(text) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** อนุญาตเฉพาะ path ภายในเว็บ (กัน open redirect) */
export function safeLocalPath(value, fallback = '/app/home') {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) {
    return value;
  }
  return fallback;
}
