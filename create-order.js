/**
 * POST /api/create-order
 *
 * Creates a Razorpay order SERVER-SIDE. This is the only place the
 * RAZORPAY_KEY_SECRET is ever read — it never reaches the browser.
 *
 * Expects JSON body: { amount: <integer paise>, currency?: "INR", receipt?: string, notes?: object }
 * Returns:            { orderId, amount, currency, keyId }
 *
 * `keyId` (RAZORPAY_KEY_ID) is safe to return to the client — it is a
 * public identifier, not a secret. Razorpay Checkout requires it in the
 * browser to open the payment widget.
 */
const Razorpay = require('razorpay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error('Razorpay env vars missing: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET');
      return res.status(500).json({ error: 'Payment gateway is not configured on the server.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { amount, currency, receipt, notes } = body;

    const amountInPaise = Number(amount);
    if (!amountInPaise || !Number.isInteger(amountInPaise) || amountInPaise < 100) {
      return res.status(400).json({ error: 'A valid amount in paise (minimum 100 = ₹1) is required.' });
    }

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: currency || 'INR',
      receipt: (receipt || `mubaz_${Date.now()}`).toString().slice(0, 40),
      notes: notes && typeof notes === 'object' ? notes : {},
    });

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (err) {
    console.error('create-order error:', err);
    return res.status(500).json({ error: 'Unable to create Razorpay order.' });
  }
};
