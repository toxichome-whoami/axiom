-- =====================================================
-- AXIOM DEMO DATABASE: RELATIONAL E-COMMERCE DATASET
-- Dialect: MySQL / MariaDB (native)
-- =====================================================

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------
-- Clean up previous tables safely without constraint violations
-- -----------------------------------------------------
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS suppliers;

-- Restore foreign key checks for table creation
SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================
-- 1. CUSTOMERS
-- =====================================================

CREATE TABLE customers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    email VARCHAR(180) UNIQUE NOT NULL,
    phone VARCHAR(30),
    city VARCHAR(100),
    country VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO customers
(first_name, last_name, email, phone, city, country, created_at, is_active)
VALUES
('Arif', 'Rahman', 'arif.rahman@example.com', '+8801711000001', 'Dhaka', 'Bangladesh', '2026-01-10 00:00:00', TRUE),
('Nusrat', 'Jahan', 'nusrat.jahan@example.com', '+8801711000002', 'Chittagong', 'Bangladesh', '2026-01-12 00:00:00', TRUE),
('Tanvir', 'Ahmed', 'tanvir.ahmed@example.com', '+8801711000003', 'Sylhet', 'Bangladesh', '2026-01-15 00:00:00', TRUE),
('Sarah', 'Johnson', 'sarah.johnson@example.com', '+1-555-0104', 'New York', 'USA', '2026-01-18 00:00:00', TRUE),
('Daniel', 'Smith', 'daniel.smith@example.com', '+44-7700-900005', 'London', 'UK', '2026-01-20 00:00:00', TRUE),
('Fatima', 'Khan', 'fatima.khan@example.com', '+8801711000006', 'Dhaka', 'Bangladesh', '2026-02-01 00:00:00', TRUE),
('Hasan', 'Mahmud', 'hasan.mahmud@example.com', '+8801711000007', 'Rajshahi', 'Bangladesh', '2026-02-05 00:00:00', FALSE),
('Emily', 'Davis', 'emily.davis@example.com', '+1-555-0108', 'Toronto', 'Canada', '2026-02-08 00:00:00', TRUE),
('Rakib', 'Hossain', 'rakib.hossain@example.com', '+8801711000009', 'Khulna', 'Bangladesh', '2026-02-12 00:00:00', TRUE),
('Ayesha', 'Islam', 'ayesha.islam@example.com', '+8801711000010', 'Dhaka', 'Bangladesh', '2026-02-15 00:00:00', TRUE),
('Michael', 'Brown', 'michael.brown@example.com', '+1-555-0111', 'Chicago', 'USA', '2026-03-01 00:00:00', TRUE),
('Sadia', 'Akter', 'sadia.akter@example.com', '+8801711000012', 'Sylhet', 'Bangladesh', '2026-03-05 00:00:00', TRUE);

-- =====================================================
-- 2. EMPLOYEES
-- =====================================================

CREATE TABLE employees (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(180) UNIQUE NOT NULL,
    department VARCHAR(100) NOT NULL,
    job_title VARCHAR(120) NOT NULL,
    salary DECIMAL(12,2) NOT NULL,
    manager_id BIGINT,
    hired_at DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL
);

INSERT INTO employees
(full_name, email, department, job_title, salary, manager_id, hired_at, is_active)
VALUES
('James Wilson', 'james.wilson@example.com', 'Management', 'Operations Manager', 85000.00, NULL, '2022-01-10', TRUE),
('Sophia Taylor', 'sophia.taylor@example.com', 'Sales', 'Sales Manager', 68000.00, 1, '2022-05-15', TRUE),
('William Clark', 'william.clark@example.com', 'Engineering', 'Software Engineer', 75000.00, 1, '2023-02-20', TRUE),
('Olivia Martin', 'olivia.martin@example.com', 'Support', 'Support Specialist', 42000.00, 1, '2024-01-08', TRUE),
('Benjamin Lee', 'benjamin.lee@example.com', 'Warehouse', 'Inventory Coordinator', 39000.00, 1, '2024-06-12', TRUE);

-- =====================================================
-- 3. SUPPLIERS
-- =====================================================

CREATE TABLE suppliers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(180) NOT NULL,
    contact_name VARCHAR(150),
    email VARCHAR(180) UNIQUE,
    country VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(80) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
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
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    category_id BIGINT NOT NULL,
    supplier_id BIGINT,
    unit_price DECIMAL(10,2) NOT NULL,
    cost_price DECIMAL(10,2) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

INSERT INTO products
(sku, name, category_id, supplier_id, unit_price, cost_price, stock_quantity, is_available)
VALUES
('PROD-KB-001', 'Wireless Mechanical Keyboard', 1, 1, 89.99, 45.00, 120, TRUE),
('PROD-MS-002', 'Ergonomic Precision Mouse', 1, 1, 49.50, 22.00, 250, TRUE),
('PROD-MN-003', '27-inch 4K IPS Monitor', 1, 2, 349.00, 210.00, 45, TRUE),
('PROD-HP-004', 'Noise-Cancelling Headphones', 1, 2, 199.99, 95.00, 80, TRUE),
('PROD-BL-005', 'High-Speed Kitchen Blender', 2, 3, 79.95, 38.00, 60, TRUE),
('PROD-CM-006', 'Programmable Coffee Maker', 2, 3, 119.00, 60.00, 35, TRUE),
('PROD-JK-007', 'Waterproof Trekking Jacket', 3, NULL, 129.99, 58.00, 90, TRUE),
('PROD-BP-008', 'City Commuter Backpack', 3, NULL, 59.99, 24.00, 140, TRUE),
('PROD-NB-009', 'Hardcover Dot Grid Notebook', 4, 4, 18.50, 6.00, 400, TRUE),
('PROD-PN-010', 'Refillable Rollerball Pen Set', 4, 4, 24.00, 8.50, 300, TRUE);

-- =====================================================
-- 6. ORDERS
-- =====================================================

CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id BIGINT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    shipping_city VARCHAR(100),
    shipping_country VARCHAR(100),
    ordered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
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
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
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
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    transaction_reference VARCHAR(100) UNIQUE NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    amount DECIMAL(12,2) NOT NULL,
    paid_at TIMESTAMP NULL DEFAULT NULL,
    metadata JSON,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
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

CREATE INDEX idx_customers_country ON customers(country);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_supplier ON products(supplier_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_ordered_at ON orders(ordered_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);

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
    CONCAT(c.first_name, ' ', c.last_name) AS customer,
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
