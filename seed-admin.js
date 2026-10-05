// Creates (or resets) the admin account with a bcrypt-hashed password.
// Usage: npm run seed:admin   (reads ADMIN_USERNAME / ADMIN_PASSWORD from .env)
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./src/db");

(async () => {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    console.error("Set ADMIN_PASSWORD (min 8 chars) in .env first.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')
     ON DUPLICATE KEY UPDATE password = VALUES(password)`,
    [username, hash]
  );
  console.log(`Admin "${username}" is ready (password stored as bcrypt hash).`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
