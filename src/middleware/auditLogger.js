import { describeActor, writeLogSafely } from '../services/logService.js';

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const sourceByPathPrefix = [
  ['/api/auth', 'Auth'],
  ['/api/admin', 'Admin'],
  ['/admin', 'Admin'],
  ['/api/artworks', 'Artwork'],
  ['/app/artworks', 'Artwork'],
  ['/app/comments', 'Artwork'],
  ['/api/comments', 'Artwork'],
  ['/api/subscriptions', 'Subscription'],
  ['/app/subscriptions', 'Subscription'],
  ['/api/profile', 'Profile'],
  ['/app/profile', 'Profile'],
  ['/login', 'Auth'],
  ['/register', 'Auth'],
  ['/logout', 'Auth'],
];

function guessSource(path) {
  const match = sourceByPathPrefix.find(([prefix]) => path.startsWith(prefix));
  return match ? match[1] : 'System';
}

/** กำหนดเหตุการณ์ของ route ไว้ล่วงหน้า (ใช้เมื่อคำขอล้มเหลวก่อนถึง handler เช่น ไฟล์ถูกปฏิเสธ) */
export function auditAs(event) {
  return function setAuditEvent(_req, res, next) {
    res.locals.auditEvent = { ...event };
    next();
  };
}

function deniedEntry(baseEntry, requestLine, denied) {
  return {
    ...baseEntry,
    level: 'Warning',
    source: 'Access',
    category: 'Denied',
    result: 'denied',
    resourceType: denied.resourceType ?? baseEntry.resourceType,
    resourceId: denied.resourceId ?? baseEntry.resourceId,
    description: `${requestLine} ถูกปฏิเสธ (${denied.status}) ต้องการ ${denied.requirement}`,
  };
}

function serverErrorEntry(baseEntry, requestLine, status, errorCode) {
  return {
    ...baseEntry,
    level: 'Error',
    source: 'System',
    category: 'Error',
    result: 'failure',
    description: `${requestLine} → ${status} ${errorCode ?? ''}`.trim(),
  };
}

// event ที่ route กำหนดไว้ (auditAs หรือ handler ตั้งเอง) → รายการหลัก + รายการเสริม (เช่น File/Upload)
function eventEntries(baseEntry, requestLine, event, status, res) {
  const succeeded = status < 400;
  const failureNote = `${event.description ?? requestLine} ล้มเหลว: ${res.locals.errorMessage ?? ''} (${status})`;
  const mainEntry = {
    ...baseEntry,
    level: succeeded ? (event.level ?? 'Information') : 'Warning',
    source: event.source,
    category: event.category,
    result: succeeded ? 'success' : 'failure',
    description: succeeded ? (event.description ?? requestLine) : failureNote,
  };
  if (!succeeded) {
    return [mainEntry];
  }
  const extraEntries = (res.locals.extraAuditEvents ?? []).map((extra) => ({ ...baseEntry, result: 'success', level: 'Information', ...extra }));
  return [mainEntry, ...extraEntries];
}

function buildEntries(req, res) {
  if (res.locals.skipAudit) {
    return [];
  }
  // ฟอร์มเว็บที่ล้มเหลวตอบเป็น redirect 303 แต่ต้องลง Log ด้วยสถานะจริง (เช่น 409 / 415)
  const status = res.locals.failureStatus ?? res.statusCode;
  const event = res.locals.auditEvent;
  const requestLine = `${req.method} ${req.originalUrl.split('?')[0]}`;
  const baseEntry = {
    actorUserId: event?.actorUserId !== undefined ? event.actorUserId : (req.actor?.userId ?? null),
    actorLabel: event?.actorLabel ?? (req.actor ? describeActor(req.actor) : 'unknown'),
    resourceType: event?.resourceType ?? null,
    resourceId: event?.resourceId ?? null,
    ipAddress: req.ip,
  };

  if (res.locals.denied) {
    return [deniedEntry(baseEntry, requestLine, res.locals.denied)];
  }
  if (status >= 500) {
    return [serverErrorEntry(baseEntry, requestLine, status, res.locals.errorCode)];
  }
  if (event?.final) {
    return [{ ...baseEntry, level: event.level, source: event.source, category: event.category, result: event.result, description: event.description ?? '' }];
  }
  if (event) {
    return eventEntries(baseEntry, requestLine, event, status, res);
  }
  if (status === 401 || status === 403) {
    return [{ ...baseEntry, level: 'Warning', source: 'Access', category: 'Denied', result: 'denied', description: `${requestLine} ถูกปฏิเสธ (${status})` }];
  }
  if (mutatingMethods.has(req.method)) {
    const succeeded = status < 400;
    return [{
      ...baseEntry,
      level: succeeded ? 'Information' : 'Warning',
      source: guessSource(req.originalUrl),
      category: 'Request',
      result: succeeded ? 'success' : 'failure',
      description: `${requestLine} → ${status} ${res.locals.errorMessage ?? ''}`.trim(),
    }];
  }
  return [];
}

/**
 * ติดตั้งก่อน middleware อื่นเพื่อให้เห็นทุก response แต่เขียน Log หลัง response จบ (event 'finish')
 * บันทึก: ทุกคำขอที่เปลี่ยนข้อมูล, การดาวน์โหลด, ทุก 401/403 และทุก 5xx (FR-LOG-02) · GET ปกติไม่บันทึก
 */
export function auditLogger(req, res, next) {
  res.on('finish', () => {
    for (const entry of buildEntries(req, res)) {
      writeLogSafely(entry);
    }
  });
  next();
}
