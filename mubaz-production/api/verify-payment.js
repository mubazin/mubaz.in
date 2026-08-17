/**
 * POST /api/verify-payment
 *
 * Verifies a Razorpay payment signature SERVER-SIDE using HMAC-SHA256.
 * This is the ONLY gate that determines whether a payment is considered paid.
 * The frontend handler callback result is NEVER trusted alone.
 *
 * Request body:
 *   {
 *     razorpay_order_id,
 *     razorpay_payment_id,
 *     razorpay_signature,
 *     orderSummary: { ... }   // echoed back for confirmation display
 *   }
 *
 * Response:
 *   { verified: true,  orderId, paymentId, orderSummary }  — on success
 *   { verified: false, error }                              — on failure
 */
const crypto = require('crypto');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ verified: false, error: 'Method not allowed' });
  }

  try {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('[verify-payment] RAZORPAY_KEY_SECRET not set');
      return res.status(500).json({ verified: false, error: 'Payment gateway not configured on the server.' });
    }

    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderSummary,
    } = body;

    // ── Validate required fields ───────────────────────────────────────────
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        verified: false,
        error: 'Missing payment verification fields.',
      });
    }

    // ── HMAC-SHA256 signature verification ────────────────────────────────
    // Razorpay signs: `${orderId}|${paymentId}` with your Key Secret
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;

    const expectedSig = crypto
      .createHmac('sha256', keySecret)
      .update(payload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const expectedBuf = Buffer.from(expectedSig,                    'utf8');
    const givenBuf    = Buffer.from(String(razorpay_signature),      'utf8');

    const isValid =
      expectedBuf.length === givenBuf.length &&
      crypto.timingSafeEqual(expectedBuf, givenBuf);

    if (!isValid) {
      console.warn(`[verify-payment] Signature MISMATCH for order ${razorpay_order_id}`);
      return res.status(400).json({
        verified: false,
        error:    'Payment signature verification failed. If money was deducted, contact us with your Payment ID.',
      });
    }

    // ── Signature is authentic ────────────────────────────────────────────
    console.log(`[verify-payment] ✅ Payment VERIFIED — order:${razorpay_order_id} payment:${razorpay_payment_id}`);

    return res.status(200).json({
      verified:     true,
      orderId:      razorpay_order_id,
      paymentId:    razorpay_payment_id,
      orderSummary: orderSummary || null,   // echo back for confirmation page
    });

  } catch (err) {
    console.error('[verify-payment] Error:', err);
    return res.status(500).json({ verified: false, error: 'Verification failed. Please contact support.' });
  }
};
