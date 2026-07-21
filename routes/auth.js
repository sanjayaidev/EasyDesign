import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to verify JWT
export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'AUTH_REQUIRED' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token_expired' });
    }
};

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, passwordHash, name || 'User']
    );

    const user = newUser.rows[0];
    
    // Initialize free tier usage
    const now = new Date();
    await query(
      'INSERT INTO usage (user_id, month, year, posts_used, posts_limit) VALUES ($1, $2, $3, 0, 10)',
      [user.id, now.getMonth() + 1, now.getFullYear()]
    );

    // Initialize subscription record
    await query(
      'INSERT INTO subscriptions (user_id, tier, status) VALUES ($1, $2, $3)',
      [user.id, 'free', 'inactive']
    );

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({ 
      success: true, 
      token, 
      email: user.email, 
      name: user.name,
      plan: 'free'
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email]);
    
    if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user.rows[0].id, email: user.rows[0].email }, JWT_SECRET, { expiresIn: '30d' });
    
    // Get user's current plan
    const sub = await query('SELECT tier FROM subscriptions WHERE user_id = $1', [user.rows[0].id]);
    const plan = sub.rows[0]?.tier || 'free';

    res.json({ success: true, token, email: user.rows[0].email, plan });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/verify
router.get('/verify', authenticate, async (req, res) => {
  try {
    const sub = await query('SELECT tier, status FROM subscriptions WHERE user_id = $1', [req.user.userId]);
    const plan = sub.rows[0]?.status === 'active' ? (sub.rows[0].tier || 'premium') : 'free';
    
    res.json({ authed: true, email: req.user.email, plan });
  } catch (err) {
    res.status(500).json({ authed: false, reason: 'server_error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const [subRes, usageRes] = await Promise.all([
      query('SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = $1', [req.user.userId]),
      query('SELECT posts_used, posts_limit FROM usage WHERE user_id = $1 AND month = $2 AND year = $3', [req.user.userId, month, year])
    ]);

    const sub = subRes.rows[0] || {};
    const usage = usageRes.rows[0] || { posts_used: 0, posts_limit: 10 };

    res.json({
      success: true,
      result: {
        subscription: {
          active: sub.status === 'active',
          tier: sub.tier || 'free',
          expires: sub.current_period_end
        },
        usage: {
          used: usage.posts_used,
          limit: usage.posts_limit
        }
      }
    });
  } catch (err) {
    console.error('[Auth] Me error:', err);
    res.status(500).json({ success: false, error: 'Failed to get user details' });
  }
});

export default router;