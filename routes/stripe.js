import express from 'express';
import Stripe from 'stripe';
import { query } from '../db.js';
import { authenticate } from './auth.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /api/stripe/checkout
router.post('/checkout', authenticate, async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.userId;

    // Get or create Stripe customer
    let customerId;
    const existingSub = await query('SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1', [userId]);
    
    if (existingSub.rows[0]?.stripe_customer_id) {
      customerId = existingSub.rows[0].stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({ email });
      customerId = customer.id;
      await query('UPDATE subscriptions SET stripe_customer_id = $1 WHERE user_id = $2', [customerId, userId]);
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL}/dashboard.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/sidepanel.html`,
      metadata: { userId }
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[Stripe] Checkout error:', err);
    res.status(500).json({ success: false, error: 'Checkout failed' });
  }
});

export default router;