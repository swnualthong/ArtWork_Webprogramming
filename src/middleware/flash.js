// ข้อความผลลัพธ์ครั้งเดียวหลัง redirect (POST → 303 → GET) เก็บใน session ของผู้ที่ login แล้ว

export function setFlash(req, type, text) {
  if (req.session?.userId) {
    req.session.flash = { type, text };
  }
}

export function flashMessages(req, res, next) {
  res.locals.flash = req.session?.flash ?? null;
  if (req.session?.flash) {
    delete req.session.flash;
  }
  next();
}
