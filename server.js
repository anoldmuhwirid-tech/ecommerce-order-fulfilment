// Module Dependencies
require("dotenv").config(); // Task 4: load secrets from .env (never hardcoded)
const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const { body, param, query } = require("express-validator");

const db = require("./src/db");
const { signSession, clearSession, requireAdmin, validate } = require("./src/security");
const api = require("./src/externalApis");

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is not set. Copy .env.example to .env and set it.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";
app.set("trust proxy", 1); // needed behind Render/Railway proxies (secure cookies, rate limit IPs)

// ===================== Security middleware (Task 3) =====================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https:"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "https:", "data:"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
});
app.use("/api", apiLimiter);

// Error helpers: never leak internal details (SQL errors etc.) in production
const handleError = (res, err, msg = "Server error", status = 500) => {
  if (err) console.error(err);
  const code = err?.status || status;
  let message = err?.message || msg;
  if (code >= 500 && code !== 502 && isProd) message = "Server error"; // hide SQL/internal details
  res.status(code).json({ error: message });
};
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => handleError(res, err));

// Reusable validators
const idParam = param("id").isInt({ min: 1 }).withMessage("id must be a positive integer").toInt();
const productRules = [
  body("name").trim().isLength({ min: 1, max: 100 }).withMessage("name is required (max 100 chars)").escape(),
  body("category").trim().isLength({ min: 1, max: 50 }).withMessage("category is required (max 50 chars)").escape(),
  body("price").isFloat({ min: 0, max: 99999999.99 }).withMessage("price must be a number >= 0").toFloat(),
  body("stock").isInt({ min: 0 }).withMessage("stock must be an integer >= 0").toInt(),
  body("image_url").optional({ values: "falsy" }).trim().isLength({ max: 255 }).withMessage("image_url too long"),
];
const ORDER_STATUSES = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];

// ===================== Authentication =====================
app.post(
  "/api/login",
  loginLimiter,
  [
    body("username").trim().isLength({ min: 1, max: 50 }).withMessage("username required"),
    body("password").isString().isLength({ min: 1, max: 100 }).withMessage("password required"),
  ],
  validate,
  wrap(async (req, res) => {
    const { username, password } = req.body;
    // Parameterised query (SQL injection prevention)
    const [rows] = await db.query("SELECT id, username, password, role FROM users WHERE username = ?", [username]);
    const user = rows[0];
    // Compare against a dummy hash when user is missing so timing doesn't reveal valid usernames
    const hash = user?.password || "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi";
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) return handleError(res, null, "Invalid login credentials.", 401);
    signSession(res, user);
    res.json({ message: "Login successful", user: { id: user.id, username: user.username, role: user.role } });
  })
);

app.post("/api/logout", (req, res) => {
  clearSession(res);
  res.json({ message: "Logged out" });
});

app.get("/api/me", requireAdmin, (req, res) => res.json({ user: req.user }));

// ===================== Products (CRUD) =====================
app.get(
  "/api/products",
  wrap(async (req, res) => {
    const [rows] = await db.query("SELECT * FROM products ORDER BY id DESC");
    res.json(rows);
  })
);

// External API #1: currency conversion, e.g. GET /api/products/1?currency=USD
app.get(
  "/api/products/:id",
  [idParam, query("currency").optional().isAlpha().isLength({ min: 3, max: 3 }).withMessage("currency must be a 3-letter code")],
  validate,
  wrap(async (req, res) => {
    const [rows] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
    if (!rows.length) return handleError(res, null, "Product not found.", 404);
    const product = rows[0];
    if (req.query.currency) {
      const converted = await api.convertPrice(product.price, req.query.currency);
      if (!converted) return handleError(res, null, "Unsupported currency code.", 400);
      product.converted_price = converted;
    }
    res.json(product);
  })
);

app.post(
  "/api/products",
  requireAdmin,
  productRules,
  validate,
  wrap(async (req, res) => {
    const { name, category, price, stock } = req.body;
    const image = req.body.image_url?.trim() || "default.jpg";
    const [r] = await db.query(
      "INSERT INTO products (name, category, price, stock, image_url) VALUES (?, ?, ?, ?, ?)",
      [name, category, price, stock, image]
    );
    res.status(201).json({ message: "Product created", id: r.insertId });
  })
);

app.put(
  "/api/products/:id",
  requireAdmin,
  [idParam, ...productRules],
  validate,
  wrap(async (req, res) => {
    const { name, category, price, stock } = req.body;
    const image = req.body.image_url?.trim() || "default.jpg";
    const [r] = await db.query(
      "UPDATE products SET name=?, category=?, price=?, stock=?, image_url=? WHERE id=?",
      [name, category, price, stock, image, req.params.id]
    );
    if (!r.affectedRows) return handleError(res, null, "Product not found.", 404);
    res.json({ message: "Product updated" });
  })
);

app.delete(
  "/api/products/:id",
  requireAdmin,
  [idParam],
  validate,
  wrap(async (req, res) => {
    const [r] = await db.query("DELETE FROM products WHERE id=?", [req.params.id]);
    if (!r.affectedRows) return handleError(res, null, "Product not found.", 404);
    res.json({ message: "Product deleted" });
  })
);

// ===================== External API gateway endpoints =====================
// External API #1: exchange rate lookup, e.g. /api/rates?amount=100&to=USD
app.get(
  "/api/rates",
  [
    query("to").isAlpha().isLength({ min: 3, max: 3 }).withMessage("to must be a 3-letter currency code"),
    query("amount").optional().isFloat({ min: 0 }).toFloat(),
  ],
  validate,
  wrap(async (req, res) => {
    const result = await api.convertPrice(req.query.amount ?? 1, req.query.to);
    if (!result) return handleError(res, null, "Unsupported currency code.", 400);
    res.json(result);
  })
);

// External API #2: postcode validation, e.g. /api/postcode/50450?country=MY
app.get(
  "/api/postcode/:code",
  [
    param("code").matches(/^[A-Za-z0-9 -]{3,10}$/).withMessage("invalid postcode format"),
    query("country").optional().isAlpha().isLength({ min: 2, max: 2 }),
  ],
  validate,
  wrap(async (req, res) => {
    const result = await api.lookupPostcode(req.params.code, req.query.country);
    res.status(result.valid ? 200 : 404).json(result);
  })
);

// ===================== Orders (transactional) =====================
// Shared by order placement and status updates. MUST be called inside a transaction.
async function changeStatus(conn, orderId, newStatus, changedBy) {
  const [rows] = await conn.query("SELECT id, status FROM orders WHERE id = ? FOR UPDATE", [orderId]);
  if (!rows.length) return { error: "Order not found.", code: 404 };
  const oldStatus = rows[0].status;
  if (oldStatus === newStatus) return { error: `Order is already ${newStatus}.`, code: 400 };
  if (oldStatus === "Cancelled") return { error: "Cancelled orders cannot be changed.", code: 400 };

  if (newStatus === "Cancelled") {
    // Return reserved stock to inventory
    await conn.query(
      `UPDATE products p JOIN order_items oi ON oi.product_id = p.id
       SET p.stock = p.stock + oi.quantity WHERE oi.order_id = ?`,
      [orderId]
    );
  }
  await conn.query("UPDATE orders SET status = ? WHERE id = ?", [newStatus, orderId]);
  await conn.query(
    "INSERT INTO order_status_history (order_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)",
    [orderId, oldStatus, newStatus, changedBy]
  );
  return { oldStatus };
}

app.post(
  "/api/orders",
  [
    body("customerName").trim().isLength({ min: 1, max: 100 }).withMessage("customerName required").escape(),
    body("customerEmail").trim().isEmail().withMessage("valid customerEmail required").isLength({ max: 120 }).normalizeEmail(),
    body("items").isArray({ min: 1, max: 50 }).withMessage("items must be a non-empty array"),
    body("items.*.id").isInt({ min: 1 }).withMessage("item id invalid").toInt(),
    body("items.*.quantity").isInt({ min: 1, max: 1000 }).withMessage("item quantity invalid").toInt(),
    // Optional shipping details (validated through external API #2)
    body("shipping").optional().isObject(),
    body("shipping.address").if(body("shipping").exists()).trim().isLength({ min: 5, max: 255 }).withMessage("shipping.address required"),
    body("shipping.postcode").if(body("shipping").exists()).trim().matches(/^[A-Za-z0-9 -]{3,10}$/).withMessage("invalid postcode"),
    body("shipping.courier").optional().trim().isLength({ max: 50 }),
  ],
  validate,
  wrap(async (req, res) => {
    const { customerName, customerEmail, shipping } = req.body;

    // Merge duplicate product lines
    const merged = new Map();
    for (const it of req.body.items) merged.set(it.id, (merged.get(it.id) || 0) + it.quantity);

    // External API #2: validate shipping postcode before touching the DB
    let place = null;
    if (shipping) {
      place = await api.lookupPostcode(shipping.postcode);
      if (!place.valid) return handleError(res, null, "Shipping postcode not found.", 400);
    }

    const conn = await db.getConnection();
    let orderId, total = 0;
    try {
      await conn.beginTransaction();

      // Lock product rows so concurrent orders cannot oversell stock
      const ids = [...merged.keys()];
      const [products] = await conn.query("SELECT * FROM products WHERE id IN (?) FOR UPDATE", [ids]);
      for (const [id, qty] of merged) {
        const p = products.find((x) => x.id === id);
        if (!p || p.stock < qty) {
          await conn.rollback();
          return handleError(res, null, `Invalid product or insufficient stock (product ${id}).`, 400);
        }
        total += p.price * qty;
      }
      total = Number(total.toFixed(2));

      const [ord] = await conn.query(
        "INSERT INTO orders (customer_name, customer_email, total, status) VALUES (?, ?, ?, 'Pending')",
        [customerName, customerEmail, total]
      );
      orderId = ord.insertId;

      for (const [id, qty] of merged) {
        const p = products.find((x) => x.id === id);
        await conn.query("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)", [orderId, id, qty, p.price]);
        await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [qty, id]);
      }
      await conn.query("INSERT INTO order_status_history (order_id, old_status, new_status, changed_by) VALUES (?, NULL, 'Pending', 'customer')", [orderId]);

      if (shipping) {
        const tracking = `TRK${Date.now().toString(36).toUpperCase()}${orderId}`;
        await conn.query(
          `INSERT INTO shipments (order_id, courier, tracking_no, address, postcode, city, state)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [orderId, shipping.courier || "Standard Courier", tracking, shipping.address, place.postcode, place.city, place.state]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // External API #3: fire-and-forget notification; failure must not fail the order
    api
      .sendTelegram(`New order #${orderId}\nCustomer: ${customerName}\nTotal: ${total} ${api.BASE_CURRENCY}\nItems: ${merged.size}`)
      .catch((e) => console.error("Notification failed:", e.message));

    res.status(201).json({ message: "Order placed successfully", orderId, total });
  })
);

app.get(
  "/api/orders",
  requireAdmin,
  wrap(async (req, res) => {
    const [rows] = await db.query("SELECT * FROM orders ORDER BY id DESC");
    res.json(rows);
  })
);

app.get(
  "/api/orders/:id",
  requireAdmin,
  [idParam],
  validate,
  wrap(async (req, res) => {
    const [orders] = await db.query("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    if (!orders.length) return handleError(res, null, "Order not found.", 404);
    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
      [req.params.id]
    );
    const [shipment] = await db.query("SELECT * FROM shipments WHERE order_id = ?", [req.params.id]);
    const [history] = await db.query("SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id", [req.params.id]);
    res.json({ ...orders[0], items, shipment: shipment[0] || null, history });
  })
);

app.patch(
  "/api/orders/:id/status",
  requireAdmin,
  [idParam, body("status").isIn(ORDER_STATUSES).withMessage(`status must be one of ${ORDER_STATUSES.join(", ")}`)],
  validate,
  wrap(async (req, res) => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const r = await changeStatus(conn, req.params.id, req.body.status, req.user.username);
      if (r.error) {
        await conn.rollback();
        return handleError(res, null, r.error, r.code);
      }
      // Keep shipment in sync with order status
      if (req.body.status === "Shipped")
        await conn.query("UPDATE shipments SET status='In Transit', shipped_at=NOW() WHERE order_id=?", [req.params.id]);
      if (req.body.status === "Delivered")
        await conn.query("UPDATE shipments SET status='Delivered' WHERE order_id=?", [req.params.id]);
      await conn.commit();
      res.json({ message: `Order status changed from ${r.oldStatus} to ${req.body.status}` });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

app.delete(
  "/api/orders/:id",
  requireAdmin,
  [idParam],
  validate,
  wrap(async (req, res) => {
    const [r] = await db.query("DELETE FROM orders WHERE id = ?", [req.params.id]);
    if (!r.affectedRows) return handleError(res, null, "Order not found.", 404);
    res.json({ message: "Order deleted successfully." });
  })
);

// ===================== Shipments (new feature, full CRUD) =====================
const shipmentRules = [
  body("courier").trim().isLength({ min: 1, max: 50 }).withMessage("courier required"),
  body("address").trim().isLength({ min: 5, max: 255 }).withMessage("address required"),
  body("postcode").trim().matches(/^[A-Za-z0-9 -]{3,10}$/).withMessage("invalid postcode"),
];
const SHIP_STATUSES = ["Preparing", "In Transit", "Delivered", "Returned"];

app.get(
  "/api/shipments",
  requireAdmin,
  wrap(async (req, res) => {
    const [rows] = await db.query(
      `SELECT s.*, o.customer_name, o.status AS order_status FROM shipments s
       JOIN orders o ON o.id = s.order_id ORDER BY s.id DESC`
    );
    res.json(rows);
  })
);

app.get(
  "/api/shipments/:id",
  requireAdmin,
  [idParam],
  validate,
  wrap(async (req, res) => {
    const [rows] = await db.query("SELECT * FROM shipments WHERE id = ?", [req.params.id]);
    if (!rows.length) return handleError(res, null, "Shipment not found.", 404);
    res.json(rows[0]);
  })
);

app.post(
  "/api/shipments",
  requireAdmin,
  [body("orderId").isInt({ min: 1 }).toInt(), ...shipmentRules],
  validate,
  wrap(async (req, res) => {
    const { orderId, courier, address, postcode } = req.body;
    const place = await api.lookupPostcode(postcode); // External API #2
    if (!place.valid) return handleError(res, null, "Postcode not found.", 400);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [orders] = await conn.query("SELECT status FROM orders WHERE id = ? FOR UPDATE", [orderId]);
      if (!orders.length) { await conn.rollback(); return handleError(res, null, "Order not found.", 404); }
      if (["Cancelled", "Delivered"].includes(orders[0].status)) {
        await conn.rollback();
        return handleError(res, null, `Cannot ship a ${orders[0].status} order.`, 400);
      }
      const [dup] = await conn.query("SELECT id FROM shipments WHERE order_id = ?", [orderId]);
      if (dup.length) { await conn.rollback(); return handleError(res, null, "Order already has a shipment.", 409); }

      const tracking = `TRK${Date.now().toString(36).toUpperCase()}${orderId}`;
      const [r] = await conn.query(
        `INSERT INTO shipments (order_id, courier, tracking_no, address, postcode, city, state)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, courier, tracking, address, place.postcode, place.city, place.state]
      );
      if (orders[0].status === "Pending") await changeStatus(conn, orderId, "Processing", req.user.username);
      await conn.commit();
      res.status(201).json({ message: "Shipment created", id: r.insertId, trackingNo: tracking });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

app.put(
  "/api/shipments/:id",
  requireAdmin,
  [idParam, ...shipmentRules, body("status").isIn(SHIP_STATUSES).withMessage(`status must be one of ${SHIP_STATUSES.join(", ")}`)],
  validate,
  wrap(async (req, res) => {
    const { courier, address, postcode, status } = req.body;
    const place = await api.lookupPostcode(postcode);
    if (!place.valid) return handleError(res, null, "Postcode not found.", 400);
    const [r] = await db.query(
      `UPDATE shipments SET courier=?, address=?, postcode=?, city=?, state=?, status=?,
       shipped_at = IF(? = 'In Transit' AND shipped_at IS NULL, NOW(), shipped_at) WHERE id=?`,
      [courier, address, place.postcode, place.city, place.state, status, status, req.params.id]
    );
    if (!r.affectedRows) return handleError(res, null, "Shipment not found.", 404);
    res.json({ message: "Shipment updated" });
  })
);

app.delete(
  "/api/shipments/:id",
  requireAdmin,
  [idParam],
  validate,
  wrap(async (req, res) => {
    const [r] = await db.query("DELETE FROM shipments WHERE id = ?", [req.params.id]);
    if (!r.affectedRows) return handleError(res, null, "Shipment not found.", 404);
    res.json({ message: "Shipment deleted" });
  })
);

// Public tracking lookup (no personal data returned)
app.get(
  "/api/track/:trackingNo",
  [param("trackingNo").matches(/^[A-Za-z0-9]{6,60}$/)],
  validate,
  wrap(async (req, res) => {
    const [rows] = await db.query(
      "SELECT tracking_no, courier, status, city, state, shipped_at FROM shipments WHERE tracking_no = ?",
      [req.params.trackingNo]
    );
    if (!rows.length) return handleError(res, null, "Tracking number not found.", 404);
    res.json(rows[0]);
  })
);

// Health check for the cloud platform
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Start Express HTTP Server
app.listen(PORT, () => console.log(`E-commerce system running on port ${PORT}`));
