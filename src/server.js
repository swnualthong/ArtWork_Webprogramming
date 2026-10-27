import { createApp } from './app.js';
import { config } from './config/env.js';
import { pool } from './config/db.js';
import { storage } from './services/storage.js';

try {
  await pool.query('SELECT 1');
} catch (error) {
  console.error(`ไม่สามารถเชื่อมต่อ PostgreSQL ได้ (${error.message}) ให้ตรวจ DATABASE_URL และรัน docker compose up -d`);
  process.exit(1);
}
await storage.init();

const app = createApp();
app.listen(config.port, () => {
  console.log(`Artwork พร้อมใช้งานที่ http://localhost:${config.port}  (Node ${process.version}, pid ${process.pid}, ${config.nodeEnv})`);
});
