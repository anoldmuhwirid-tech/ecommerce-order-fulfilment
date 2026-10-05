-- Database Initialization & Context Selection
CREATE DATABASE IF NOT EXISTS ecommerce_db;
USE ecommerce_db;

-- Drop existing tables in reverse-dependency order
DROP TABLE IF EXISTS order_status_history;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

-- Users: passwords are stored as bcrypt hashes (created by `npm run seed:admin`)
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'admin'
);

CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  image_url VARCHAR(255) DEFAULT 'default.jpg',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_price CHECK (price >= 0),
  CONSTRAINT chk_stock CHECK (stock >= 0),
  INDEX idx_products_category (category)
);

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  customer_email VARCHAR(120) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_order_status CHECK (status IN ('Pending','Processing','Shipped','Delivered','Cancelled')),
  INDEX idx_orders_status (status)
);

-- Order items: product_id becomes NULL if a product is later deleted,
-- so historical orders are preserved (was ON DELETE CASCADE).
CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  CONSTRAINT chk_qty CHECK (quantity > 0),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

-- ===== NEW FEATURE (Task 2): Shipment tracking & order status audit trail =====
-- One shipment per order (1:1), validated address from the postcode API.
CREATE TABLE shipments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL UNIQUE,
  courier VARCHAR(50) NOT NULL,
  tracking_no VARCHAR(60) NOT NULL UNIQUE,
  address VARCHAR(255) NOT NULL,
  postcode VARCHAR(10) NOT NULL,
  city VARCHAR(80),
  state VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'Preparing',
  shipped_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_ship_status CHECK (status IN ('Preparing','In Transit','Delivered','Returned')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- 1:N audit log of every order status change
CREATE TABLE order_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  old_status VARCHAR(30) NULL,
  new_status VARCHAR(30) NOT NULL,
  changed_by VARCHAR(50) NOT NULL DEFAULT 'system',
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX idx_hist_order (order_id)
);

-- Catalog seed data (admin user is created by `npm run seed:admin`, not here)
INSERT INTO products (name, category, price, stock, image_url) VALUES
('Wireless Headphones', 'Electronics', 129.90, 20, 'Wireless Headphones.jpg'),
('Smart Watch', 'Electronics', 199.90, 15, 'Smart Watch.png'),
('Backpack', 'Fashion', 79.90, 25, 'Backpack.jpg'),
('USB-C Cable', 'Accessories', 29.90, 40, 'USB-C Cable.jpg'),
('Running Shoes', 'Sports', 159.90, 12, 'Running Shoes.jpg');
