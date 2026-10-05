// Task 2: shipments and transactions
// MySQL connection pool - all credentials come from environment variables.
const mysql = require("mysql2");

const ssl = process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined;

const config = process.env.DATABASE_URL
  ? { uri: process.env.DATABASE_URL, ssl }
  : {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "ecommerce_db",
      ssl,
    };

const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // return DECIMAL columns as numbers, not strings
});

module.exports = pool.promise();
module.exports.raw = pool;
