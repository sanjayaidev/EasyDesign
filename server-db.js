import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection on startup
pool.on('connect', () => console.log('[DB] ✅ Connected to PostgreSQL'));
pool.on('error', (err) => console.error('[DB] ❌ Unexpected error on idle client', err));

// Tagged template function for SQL queries
// Returns the rows array directly (not the raw pg Result object), since every
// call site in routes/data.js treats the result as a plain array (.length, for...of, .map).
export async function sql(strings, ...values) {
  const query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? `$${i + 1}` : ''), '');
  const result = await pool.query(query, values);
  return result.rows;
}

export const query = (text, params) => pool.query(text, params);
export default pool;
