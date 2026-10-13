-- =====================================================
-- AXIOM DEMO DATABASE: RELATIONAL E-COMMERCE DATASET
-- Dialect: Turso / LibSQL / SQLite
-- (For PostgreSQL use demo_postgres.sql, for MySQL use demo_mysql.sql)
-- =====================================================

PRAGMA foreign_keys = OFF;

-- -----------------------------------------------------
-- Clean up previous demo tables
-- -----------------------------------------------------
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS suppliers;

PRAGMA foreign_keys = ON;

-- =====================================================
-- 1. CUSTOMERS
-- =====================================================

CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    city TEXT,
    country TEXT,
    created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
    is_active INTEGER NOT NULL DEFAULT 1
);

INSERT INTO customers
(first_name, last_name, email, phone, city, country, created_at, is_active)
VALUES
('Arif', 'Rahman', 'arif.rahman@example.com', '+8801711000001', 'Dhaka', 'Bangladesh', '2026-01-10 00:00:00', 1),
('Nusrat', 'Jahan', 'nusrat.jahan@example.com', '+8801711000002', 'Chittagong', 'Bangladesh', '2026-01-12 00:00:00', 1),
('Tanvir', 'Ahmed', 'tanvir.ahmed@example.com', '+8801711000003', 'Sylhet', 'Bangladesh', '2026-01-15 00:00:00', 1),
('Sarah', 'Johnson', 'sarah.johnson@example.com', '+1-555-0104', 'New York', 'USA', '2026-01-18 00:00:00', 1),
('Daniel', 'Smith', 'daniel.smith@example.com', '+44-7700-900005', 'London', 'UK', '2026-01-20 00:00:00', 1),
('Fatima', 'Khan', 'fatima.khan@example.com', '+8801711000006', 'Dhaka', 'Bangladesh', '2026-02-01 00:00:00', 1),
('Hasan', 'Mahmud', 'hasan.mahmud@example.com', '+8801711000007', 'Rajshahi', 'Bangladesh', '2026-02-05 00:00:00', 0),
('Emily', 'Davis', 'emily.davis@example.com', '+1-555-0108', 'Toronto', 'Canada', '2026-02-08 00:00:00', 1),
('Rakib', 'Hossain', 'rakib.hossain@example.com', '+8801711000009', 'Khulna', 'Bangladesh', '2026-02-12 00:00:00', 1),
('Ayesha', 'Islam', 'ayesha.islam@example.com', '+8801711000010', 'Dhaka', 'Bangladesh', '2026-02-15 00:00:00', 1),
('Michael', 'Brown', 'michael.brown@example.com', '+1-555-0111', 'Chicago', 'USA', '2026-03-01 00:00:00', 1),
('Sadia', 'Akter', 'sadia.akter@example.com', '+8801711000012', 'Sylhet', 'Bangladesh', '2026-03-05 00:00:00', 1);

-- =====================================================
-- 2. EMPLOYEES
-- =====================================================

CREATE TABLE employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    department TEXT NOT NULL,
    job_title TEXT NOT NULL,
    salary REAL NOT NULL CHECK (salary >= 0),
    manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    hired_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);

INSERT INTO employees
(full_name, email, department, job_title, salary, manager_id, hired_at, is_active)
VALUES
('James Wilson', 'james.wilson@example.com', 'Management', 'Operations Manager', 85000.0, NULL, '2022-01-10', 1),
('Sophia Taylor', 'sophia.taylor@example.com', 'Sales', 'Sales Manager', 68000.0, 1, '2022-05-15', 1),
('William Clark', 'william.clark@example.com', 'Engineering', 'Software Engineer', 75000.0, 1, '2023-02-20', 1),
('Olivia Martin', 'olivia.martin@example.com', 'Support', 'Support Specialist', 42000.0, 1, '2024-01-08', 1),
('Benjamin Lee', 'benjamin.lee@example.com', 'Warehouse', 'Inventory Coordinator', 39000.0, 1, '2024-06-12', 1);

-- =====================================================
-- 3. SUPPLIERS
-- =====================================================

CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT UNIQUE,
    country TEXT,
    created_at TEXT NOT NULL DEFAULT (DATETIME('now'))
);

INSERT INTO suppliers
(company_name, contact_name, email, country)
VALUES
('TechSource Ltd', 'Imran Chowdhury', 'contact@techsource.example', 'Bangladesh'),
('Global Electronics', 'David Miller', 'sales@globalelectronics.example', 'USA'),
('Modern Living Supplies', 'Aminul Karim', 'orders@modernliving.example', 'Bangladesh'),
('Digital Components GmbH', 'Anna Weber', 'info@digitalcomponents.example', 'Germany');

-- =====================================================
-- 4. CATEGORIES
-- =====================================================

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT
);

INSERT INTO categories
(slug, name, description)
VALUES
('electronics', 'Electronics', 'Consumer tech, computers, accessories and audio gear'),
('home-appliances', 'Home Appliances', 'Kitchen tools, living room equipment and utilities'),
('fashion', 'Fashion & Apparel', 'Clothing, footwear and everyday style accessories'),
('stationery', 'Stationery & Office', 'Desk items, notebooks and workplace productivity');

-- =====================================================
-- 5. PRODUCTS
-- =====================================================

CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    unit_price REAL NOT NULL,
    cost_price REAL NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    is_available INTEGER NOT NULL DEFAULT 1
);

INSERT INTO products
(sku, name, category_id, supplier_id, unit_price, cost_price, stock_quantity, is_available)
VALUES
('PROD-KB-001', 'Wireless Mechanical Keyboard', 1, 1, 89.99, 45.00, 120, 1),
('PROD-MS-002', 'Ergonomic Precision Mouse', 1, 1, 49.50, 22.00, 250, 1),
('PROD-MN-003', '27-inch 4K IPS Monitor', 1, 2, 349.00, 210.00, 45, 1),
('PROD-HP-004', 'Noise-Cancelling Headphones', 1, 2, 199.99, 95.00, 80, 1),
('PROD-BL-005', 'High-Speed Kitchen Blender', 2, 3, 79.95, 38.00, 60, 1),
('PROD-CM-006', 'Programmable Coffee Maker', 2, 3, 119.00, 60.00, 35, 1),
('PROD-JK-007', 'Waterproof Trekking Jacket', 3, NULL, 129.99, 58.00, 90, 1),
('PROD-BP-008', 'City Commuter Backpack', 3, NULL, 59.99, 24.00, 140, 1),
('PROD-NB-009', 'Hardcover Dot Grid Notebook', 4, 4, 18.50, 6.00, 400, 1),
('PROD-PN-010', 'Refillable Rollerball Pen Set', 4, 4, 24.00, 8.50, 300, 1);

-- =====================================================
-- 6. ORDERS
-- =====================================================

CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    total_amount REAL NOT NULL DEFAULT 0.00,
    shipping_city TEXT,
    shipping_country TEXT,
    ordered_at TEXT NOT NULL DEFAULT (DATETIME('now'))
);

INSERT INTO orders
(order_number, customer_id, status, total_amount, shipping_city, shipping_country, ordered_at)
VALUES
('ORD-2026-001', 1, 'delivered', 981.23, 'Dhaka', 'Bangladesh', '2026-03-01 10:14:00'),
('ORD-2026-002', 2, 'processing', 130.98, 'Chittagong', 'Bangladesh', '2026-03-03 14:30:00'),
('ORD-2026-003', 4, 'shipped', 356.49, 'New York', 'USA', '2026-03-05 09:20:00'),
('ORD-2026-004', 5, 'delivered', 375.48, 'London', 'UK', '2026-03-10 16:22:00'),
('ORD-2026-005', 6, 'cancelled', 238.99, 'Dhaka', 'Bangladesh', '2026-03-12 11:10:00'),
('ORD-2026-006', 7, 'delivered', 141.48, 'Rajshahi', 'Bangladesh', '2026-03-15 13:00:00'),
('ORD-2026-007', 8, 'pending', 1169.99, 'Toronto', 'Canada', '2026-03-18 18:40:00'),
('ORD-2026-008', 9, 'processing', 592.48, 'Khulna', 'Bangladesh', '2026-03-20 17:42:00'),
('ORD-2026-009', 11, 'delivered', 109.99, 'Chicago', 'USA', '2026-03-22 12:28:00'),
('ORD-2026-010', 12, 'shipped', 151.97, 'Sylhet', 'Bangladesh', '2026-03-25 15:05:00');

-- =====================================================
-- 7. ORDER ITEMS
-- =====================================================

CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    line_total REAL NOT NULL
);

INSERT INTO order_items
(order_id, product_id, quantity, unit_price, line_total)
VALUES
(1, 3, 2, 349.00, 698.00),
(1, 1, 1, 89.99, 89.99),
(1, 4, 1, 199.99, 199.99),
(2, 2, 2, 49.50, 99.00),
(2, 9, 1, 18.50, 18.50),
(3, 4, 1, 199.99, 199.99),
(3, 2, 1, 49.50, 49.50),
(3, 8, 1, 59.99, 59.99),
(4, 3, 1, 349.00, 349.00),
(4, 10, 1, 24.00, 24.00),
(5, 4, 1, 199.99, 199.99),
(5, 10, 1, 24.00, 24.00),
(6, 5, 1, 79.95, 79.95),
(6, 8, 1, 59.99, 59.99),
(7, 3, 3, 349.00, 1047.00),
(7, 7, 1, 129.99, 129.99),
(8, 6, 2, 119.00, 238.00),
(8, 3, 1, 349.00, 349.00),
(9, 1, 1, 89.99, 89.99),
(9, 10, 1, 24.00, 24.00),
(10, 8, 1, 59.99, 59.99),
(10, 1, 1, 89.99, 89.99);

-- =====================================================
-- 8. PAYMENTS
-- =====================================================

CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    transaction_reference TEXT UNIQUE NOT NULL,
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    amount REAL NOT NULL,
    paid_at TEXT,
    metadata TEXT
);

INSERT INTO payments
(order_id, transaction_reference, payment_method, status, amount, paid_at, metadata)
VALUES
(1, 'TXN-10001', 'card', 'completed', 981.23, '2026-03-01 10:16:00', '{"provider":"stripe","currency":"USD"}'),
(2, 'TXN-10002', 'mobile_banking', 'completed', 130.98, '2026-03-03 14:32:00', '{"provider":"bkash","currency":"USD"}'),
(3, 'TXN-10003', 'card', 'pending', 356.49, NULL, '{"provider":"stripe"}'),
(4, 'TXN-10004', 'bank_transfer', 'completed', 375.48, '2026-03-10 16:25:00', '{"reference":"BANK-456"}'),
(5, 'TXN-10005', 'card', 'refunded', 238.99, '2026-03-12 11:15:00', '{"reason":"customer_cancellation"}'),
(6, 'TXN-10006', 'mobile_banking', 'completed', 141.48, '2026-03-15 13:05:00', '{"provider":"bkash"}'),
(7, 'TXN-10007', 'card', 'pending', 1169.99, NULL, '{"provider":"stripe"}'),
(8, 'TXN-10008', 'bank_transfer', 'completed', 592.48, '2026-03-20 17:45:00', '{"reference":"BANK-789"}'),
(9, 'TXN-10009', 'cash', 'completed', 109.99, '2026-03-22 12:30:00', '{}'),
(10, 'TXN-10010', 'card', 'failed', 151.97, NULL, '{"error":"payment_declined"}');

-- =====================================================
-- 9. INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_ordered_at ON orders(ordered_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- =====================================================
-- 10. OVERVIEW: TABLES AND ROW COUNTS
-- =====================================================

SELECT 'customers' AS table_name, COUNT(*) AS row_count FROM customers
UNION ALL
SELECT 'employees', COUNT(*) FROM employees
UNION ALL
SELECT 'suppliers', COUNT(*) FROM suppliers
UNION ALL
SELECT 'categories', COUNT(*) FROM categories
UNION ALL
SELECT 'products', COUNT(*) FROM products
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL
SELECT 'payments', COUNT(*) FROM payments
ORDER BY table_name;

-- =====================================================
-- 11. RELATIONAL DEMO QUERY
-- =====================================================

SELECT
    o.order_number,
    c.first_name || ' ' || c.last_name AS customer,
    c.email,
    o.status AS order_status,
    o.total_amount,
    p.payment_method,
    p.status AS payment_status,
    o.ordered_at
FROM orders o
JOIN customers c ON o.customer_id = c.id
LEFT JOIN payments p ON p.order_id = o.id
ORDER BY o.ordered_at DESC
LIMIT 10;
