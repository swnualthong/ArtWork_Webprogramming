import path from 'node:path';

try {
  // Node 24: โหลด .env ได้เองโดยไม่ต้องใช้แพ็กเกจ dotenv
  process.loadEnvFile();
} catch {
  // ไม่มี .env ก็ได้ ถ้าตั้งค่าผ่าน environment ของเครื่องแล้ว
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}; copy .env.example to .env and fill it in`);
  }
  return value;
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requireEnv('DATABASE_URL'),
  sessionSecret: requireEnv('SESSION_SECRET'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? './uploads'),
  subscriptionPriceThb: Number(process.env.SUBSCRIPTION_PRICE_THB ?? 99),
  subscriptionPeriodDays: 30,
  // bcrypt cost ≥ 10 ตาม FR-AUTH-02
  bcryptCost: 12,
  sessionMaxAgeMs: 8 * 60 * 60 * 1000,
});
