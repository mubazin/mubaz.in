/**
 * POST /api/verify-payment
 *
 * Verifies a Razorpay payment SERVER-SIDE using HMAC-SHA256 over
 * `${razorpay_order_id}|${razorpay_payment_id}` signed with RAZORPAY_KEY_SECRET.
 *
 * The frontend's "payment succeeded" callback is NEVER trusted on its own —
 * an order is only ever treated as paid if this endpoint returns verified:true.
 *
 * Expects JSON body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Returns:            { verified: boolean, orderId?, paymentId?, error? }
 */
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ verified: false, error: 'Method not allowed' });
  }

  try {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('Razorpay env var missing: RAZORPAY_KEY_SECRET');
      return res.status(500).json({ verified: false, error: 'Payment gateway is not configured on the server.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ verified: false, error: 'Missing payment verification fields.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const givenBuf = Buffer.from(String(razorpay_signature), 'utf8');

    const isValid =
      expectedBuf.length === givenBuf.length &&
      crypto.timingSafeEqual(expectedBuf, givenBuf);

    if (!isValid) {
      console.warn('Razorpay signature mismatch for order', razorpay_order_id);
      return res.status(400).json({ verified: false, error: 'Invalid payment signature.' });
    }

    // Signature confirmed authentic — this is the only point at which
    // the payment may be treated as successfully completed.
    return res.status(200).json({
      verified: true,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
    });
  } catch (err) {
    console.error('verify-payment error:', err);
    return res.status(500).json({ verified: false, error: 'Verification failed.' });
  }
};
