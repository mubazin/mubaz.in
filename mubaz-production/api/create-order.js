/**
 * POST /api/create-order
 *
 * Creates a Razorpay order SERVER-SIDE.
 *
 * Security model:
 * - RAZORPAY_KEY_SECRET never leaves the server.
 * - Amount is calculated SERVER-SIDE from a product catalog — the frontend
 *   sends item descriptors (productId, qty) and the server looks up the
 *   authoritative price. The client-supplied amount is IGNORED.
 * - Only RAZORPAY_KEY_ID (public identifier) is returned to the browser.
 *
 * Request body:
 *   {
 *     items: [{ productId, qty }],      // used for server-side price calc
 *     customerName:  string,
 *     customerPhone: string,
 *     customerEmail: string (optional),
 *     notes: object (optional)
 *   }
 *
 * Response:
 *   { orderId, amount, currency, keyId, totalRupees }
 */
const Razorpay = require('razorpay');

// ─── AUTHORITATIVE PRODUCT CATALOG (server-side source of truth) ─────────────
// Prices are defined HERE only. The frontend cannot override them.
// Add new products here as the store grows.
const PRODUCT_CATALOG = {
  // Acid Wash colours
  'acid-beige':          { name: 'Acid Wash Oversized T-Shirt (Beige)',          priceINR: 599 },
  'acid-black':          { name: 'Acid Wash Oversized T-Shirt (Black)',          priceINR: 599 },
  'acid-blue':           { name: 'Acid Wash Oversized T-Shirt (Blue)',           priceINR: 599 },
  'acid-maroon':         { name: 'Acid Wash Oversized T-Shirt (Maroon)',         priceINR: 599 },
  'acid-red':            { name: 'Acid Wash Oversized T-Shirt (Red)',            priceINR: 599 },
  'acid-white':          { name: 'Acid Wash Oversized T-Shirt (White)',          priceINR: 599 },
  'acid-white-brushing': { name: 'Acid Wash Oversized T-Shirt (White Brushing)', priceINR: 599 },
  // Progress Flame colours
  'pf-black':            { name: 'Progress Flame Oversized T-Shirt (Black)',     priceINR: 599 },
  'pf-white':            { name: 'Progress Flame Oversized T-Shirt (White)',     priceINR: 599 },
  'pf-red':              { name: 'Progress Flame Oversized T-Shirt (Red)',       priceINR: 599 },
};

const VALID_SIZES  = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const MAX_QTY      = 20;   // sanity cap per line item
const MIN_AMOUNT   = 100;  // Razorpay minimum: ₹1 in paise

// ─── CORS helper ─────────────────────────────────────────────────────────────
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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const keyId     = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error('[create-order] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set');
      return res.status(500).json({ error: 'Payment gateway not configured on the server.' });
    }

    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const { items, customerName, customerPhone, customerEmail, notes: extraNotes } = body;

    // ── Validate customer details ──────────────────────────────────────────
    if (!customerName || typeof customerName !== 'string' || !customerName.trim()) {
      return res.status(400).json({ error: 'Customer name is required.' });
    }
    if (!customerPhone || typeof customerPhone !== 'string') {
      return res.status(400).json({ error: 'Customer phone number is required.' });
    }
    const phoneClean = customerPhone.replace(/\D/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 15) {
      return res.status(400).json({ error: 'Please enter a valid phone number.' });
    }

    // ── Validate items & calculate total SERVER-SIDE ───────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided.' });
    }

    let totalPaise = 0;
    const lineItems = [];

    for (const item of items) {
      const { productId, qty, size } = item;

      if (!productId || typeof productId !== 'string') {
        return res.status(400).json({ error: `Invalid productId: ${productId}` });
      }
      const product = PRODUCT_CATALOG[productId];
      if (!product) {
        return res.status(400).json({ error: `Unknown product: ${productId}` });
      }

      const qtyNum = parseInt(qty, 10);
      if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > MAX_QTY) {
        return res.status(400).json({ error: `Invalid quantity ${qty} for ${productId}.` });
      }

      if (size && !VALID_SIZES.includes(size)) {
        return res.status(400).json({ error: `Invalid size ${size} for ${productId}.` });
      }

      const linePaise = product.priceINR * qtyNum * 100;
      totalPaise += linePaise;
      lineItems.push({
        name:   product.name,
        size:   size || '',
        qty:    qtyNum,
        paise:  linePaise,
        rupees: product.priceINR * qtyNum,
      });
    }

    if (totalPaise < MIN_AMOUNT) {
      return res.status(400).json({ error: 'Order total is too small.' });
    }

    // ── Create Razorpay order ──────────────────────────────────────────────
    const receipt = `mubaz_${Date.now()}`.slice(0, 40);

    const orderNotes = {
      customer_name:  customerName.trim().slice(0, 100),
      customer_phone: phoneClean,
      customer_email: (customerEmail || '').trim().slice(0, 100),
      items_summary:  lineItems.map(l => `${l.name} (${l.size}) x${l.qty}`).join('; ').slice(0, 500),
      ...(typeof extraNotes === 'object' && extraNotes ? extraNotes : {}),
    };

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    const order = await razorpay.orders.create({
      amount:   totalPaise,
      currency: 'INR',
      receipt,
      notes:    orderNotes,
    });

    console.log(`[create-order] Created order ${order.id} for ₹${totalPaise / 100} — ${customerName.trim()}`);

    return res.status(200).json({
      orderId:     order.id,
      amount:      order.amount,      // paise — passed directly to Razorpay Checkout
      currency:    order.currency,
      keyId,                           // public key — safe for browser
      totalRupees: totalPaise / 100,   // for display only
    });

  } catch (err) {
    console.error('[create-order] Error:', err);
    return res.status(500).json({ error: 'Unable to create payment order. Please try again.' });
  }
};
