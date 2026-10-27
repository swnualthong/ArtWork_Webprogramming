import express from 'express';
import { publicDir, viewsDir } from './config/paths.js';
import { config } from './config/env.js';
import { attachActor } from './middleware/attachActor.js';
import { auditLogger } from './middleware/auditLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandlers.js';
import { flashMessages } from './middleware/flash.js';
import { originCheck } from './middleware/originCheck.js';
import { sessionLoader } from './middleware/sessionLoader.js';
import { createAdminApiRouter } from './routes/adminApiRoutes.js';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createApiRouter } from './routes/apiRoutes.js';
import { createWebRouter } from './routes/webRoutes.js';
import { formatBytes, formatDateTime } from './utils/format.js';

/**
 * ลำดับ middleware ของทุกคำขอ:
 * body parser → sessionLoader → attachActor (+ flash) → originCheck
 * → guard ของแต่ละ route → validateRequest → controller → notFound / errorHandler
 * auditLogger ติดตั้งก่อนสุดเพื่อให้เห็นทุก response แต่เขียน Log หลัง response จบ
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', viewsDir);
  app.set('view cache', config.isProduction);
  Object.assign(app.locals, { formatDateTime, formatBytes });

  app.use(auditLogger);
  // ไฟล์ของหน้าเว็บเท่านั้น (CSS / JS / ภาพ) ไม่ใช่ที่เก็บไฟล์อัปโหลด
  app.use('/static', express.static(publicDir, { index: false, fallthrough: false }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 200 }));
  app.use(sessionLoader());
  app.use(attachActor);
  app.use(flashMessages);
  app.use(originCheck);

  // /api/admin ต้องมาก่อน /api ไม่งั้นถูก router ของผู้ใช้ทั่วไปรับไปก่อน
  app.use('/api/admin', createAdminApiRouter());
  app.use('/api', createApiRouter(), notFoundHandler);
  app.use('/admin', createAdminRouter(), notFoundHandler);
  app.use(createWebRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
