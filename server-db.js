import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

// This uses the secure DATABASE_URL from Railway, NOT the exposed extension URL
export const sql = neon(process.env.DATABASE_URL);