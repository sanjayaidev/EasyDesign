import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import stripeRoutes from './routes/stripe.js';
import dataRoutes from './routes/data.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow Chrome extensions, localhost, and your frontend
    if (
      !origin ||
      origin.startsWith('chrome-extension://') ||
      origin === process.env.FRONTEND_URL
    ) {
      return callback(null, true);
    }
    callback(null, true); // or false to block unknown origins
  },
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/data', dataRoutes);
// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Railway Auth Server is running' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[Server] 🚀 Running on port ${PORT}`);
  console.log(`[Server] 🛡️  DATABASE_URL is securely loaded from environment`);
});
