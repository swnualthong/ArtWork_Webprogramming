import multer from 'multer';
import { HttpError, notFound } from '../utils/httpErrors.js';
import { setFlash } from './flash.js';

const pgErrorMapping = {
  23505: [409, 'DUPLICATE', 'ข้อมูลนี้มีอยู่แล้วในระบบ'],
  23503: [409, 'REFERENCED', 'ข้อมูลนี้ยังถูกใช้งานอยู่'],
  23514: [400, 'VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง'],
  '22P02': [400, 'VALIDATION_ERROR', 'รูปแบบข้อมูลไม่ถูกต้อง'],
  22001: [400, 'VALIDATION_ERROR', 'ข้อมูลยาวเกินกำหนด'],
};

const multerErrorMapping = {
  LIMIT_FILE_SIZE: [413, 'FILE_TOO_LARGE', 'ไฟล์มีขนาดใหญ่เกินกำหนด'],
  LIMIT_FILE_COUNT: [400, 'TOO_MANY_FILES', 'แนบไฟล์เกินจำนวนที่กำหนด'],
  LIMIT_UNEXPECTED_FILE: [400, 'UNEXPECTED_FILE', 'มีไฟล์แนบในช่องที่ไม่รองรับ'],
  LIMIT_FIELD_COUNT: [400, 'TOO_MANY_FIELDS', 'มีช่องข้อมูลมากเกินไป'],
  LIMIT_PART_COUNT: [400, 'TOO_MANY_FIELDS', 'มีช่องข้อมูลมากเกินไป'],
  LIMIT_FIELD_VALUE: [400, 'FIELD_TOO_LONG', 'ข้อมูลในฟอร์มยาวเกินกำหนด'],
};

// ฟอร์มเว็บที่ล้มเหลวด้วยสถานะเหล่านี้ให้กลับหน้าเดิมพร้อมข้อความ แทนการขึ้นหน้า error
const formErrorStatuses = new Set([400, 404, 409, 413, 415]);

const pageTitles = { 400: 'Bad request', 403: 'Forbidden', 404: 'Not found', 413: 'File too large', 415: 'Unsupported file', 500: 'Server error' };

function normalizeError(error) {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof multer.MulterError) {
    const [status, code, message] = multerErrorMapping[error.code] ?? [400, 'UPLOAD_ERROR', 'ไม่สามารถรับไฟล์ได้'];
    return new HttpError(status, code, message);
  }
  if (error?.type === 'entity.parse.failed') {
    return new HttpError(400, 'INVALID_JSON', 'รูปแบบ JSON ไม่ถูกต้อง');
  }
  if (error?.type === 'entity.too.large') {
    return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลที่ส่งมีขนาดใหญ่เกินกำหนด');
  }
  if (error?.code === 'ENOENT') {
    return notFound('ไม่พบไฟล์ในที่เก็บ');
  }
  // error 4xx จากไลบรารี เช่น express.static ไม่พบไฟล์ (404) หรือ path มี ".." (403) ตอบเป็น 404
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    return [403, 404].includes(error.status) ? notFound() : new HttpError(error.status, 'BAD_REQUEST', 'คำขอไม่ถูกต้อง');
  }
  const pgMapping = pgErrorMapping[error?.code];
  if (pgMapping) {
    return new HttpError(...pgMapping);
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
}

/** หน้าเว็บ หรือ browser ที่เปิด API ตรง ๆ ได้ HTML ที่เหลือได้ JSON */
function prefersHtml(req) {
  if (!req.path.startsWith('/api/')) {
    return true;
  }
  return req.accepts(['json', 'html']) === 'html';
}

/** path ของหน้าที่ส่งฟอร์มมา (จาก Referer) ใช้เฉพาะเมื่อเป็นเว็บเดียวกัน ไม่งั้นใช้ fallback */
export function previousPagePath(req, fallback = '/app/home') {
  try {
    const referer = new URL(req.get('referer'));
    return referer.host === req.get('host') ? `${referer.pathname}${referer.search}` : fallback;
  } catch {
    return fallback;
  }
}

function renderErrorPage(res, status, message) {
  const title = pageTitles[status] ?? 'Error';
  res.status(status).render('errors/error', { status, title, message }, (renderError, html) => {
    if (renderError) {
      res.type('text').send(`${status} ${title}: ${message}`);
      return;
    }
    res.send(html);
  });
}

export function notFoundHandler(req, _res, next) {
  next(notFound(req.path.startsWith('/api/') ? 'ไม่พบ API ที่ต้องการ' : 'ไม่พบหน้าที่ต้องการ'));
}

/**
 * จุดรวม error ของทั้งระบบ: รูปแบบเดียวกันเสมอ ไม่แสดง stack trace หรือข้อความ SQL
 * ฟอร์มเว็บที่ล้มเหลวกลับหน้าเดิมพร้อม flash (log ยังบันทึกสถานะจริง) · 401 ของหน้าเว็บไปหน้า login · API ได้ JSON
 */
export function errorHandler(error, req, res, _next) {
  // response เริ่มส่งไปแล้ว เช่น ผู้ใช้ยกเลิกการดาวน์โหลดกลางทาง
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const httpError = normalizeError(error);
  if (httpError.status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, error);
  }
  res.locals.errorCode = httpError.code;
  res.locals.errorMessage = httpError.message;
  const isApiRequest = req.path.startsWith('/api/');

  if (!isApiRequest && req.method === 'POST' && formErrorStatuses.has(httpError.status) && req.session?.userId) {
    setFlash(req, 'error', httpError.message);
    res.locals.failureStatus = httpError.status;
    res.redirect(303, previousPagePath(req));
    return;
  }
  if (prefersHtml(req)) {
    if (httpError.status === 401) {
      const returnPath = req.method === 'GET' ? req.originalUrl : previousPagePath(req);
      res.redirect(`/login?next=${encodeURIComponent(returnPath)}`);
      return;
    }
    renderErrorPage(res, httpError.status, httpError.message);
    return;
  }
  res.status(httpError.status).json({ error: { code: httpError.code, message: httpError.message } });
}
