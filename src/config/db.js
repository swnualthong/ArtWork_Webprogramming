import pg from 'pg';
import { config } from './env.js';

// bigint (int8) คืนเป็น string โดยปริยาย; id และจำนวนในระบบนี้ต่ำกว่า 2^53 มาก จึงแปลงเป็น number
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

function toCamelCase(snakeName) {
  return snakeName.replace(/_([a-z0-9])/g, (_match, letter) => letter.toUpperCase());
}

function mapRow(row) {
  const mappedRow = {};
  for (const [columnName, value] of Object.entries(row)) {
    mappedRow[toCamelCase(columnName)] = value;
  }
  return mappedRow;
}

/** Parameterized query เท่านั้น; แปลงชื่อคอลัมน์ snake_case เป็น camelCase ก่อนส่งให้ส่วนอื่น */
export async function query(text, params = [], client = pool) {
  const result = await client.query(text, params);
  return result.rows.map(mapRow);
}

export async function queryOne(text, params = [], client = pool) {
  const rows = await query(text, params, client);
  return rows[0] ?? null;
}

/** รัน work ใน transaction เดียว: สำเร็จ COMMIT, มี error ROLLBACK แล้ว throw ต่อ (work รับ client ไปใช้กับ query) */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
