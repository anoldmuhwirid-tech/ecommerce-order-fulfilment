// Task 3: validation and security
// Task 3 - authentication, authorisation and input-validation helpers.
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");

const COOKIE = "token";
const isProd = process.env.NODE_ENV === "production";

function signSession(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "2h",
  });
  // httpOnly: not readable by JS (mitigates XSS token theft); sameSite: mitigates CSRF
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 2 * 60 * 60 * 1000 });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", secure: isProd });
}

function requireAdmin(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE] || "", process.env.JWT_SECRET);
    if (payload.role !== "admin") return res.status(403).json({ error: "Admin access required." });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Authentication required." });
  }
}

// Runs after express-validator chains; returns 400 with all field errors
function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  res.status(400).json({
    error: "Validation failed.",
    details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
  });
}

module.exports = { signSession, clearSession, requireAdmin, validate };
