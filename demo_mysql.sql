-- =====================================================
-- AXIOM DEMO DATABASE: RELATIONAL E-COMMERCE DATASET
-- Dialect: MySQL / MariaDB
-- Exact total replica of demo_postgres.sql
-- =====================================================

SET FOREIGN_KEY_CHECKS = 0;

-- Remove previous demo tables in dependency order
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS suppliers;

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
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    parent_id BIGINT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO categories (name, description, parent_id)
VALUES
('Electronics', 'Electronic devices and accessories', NULL),
('Computers', 'Laptops and computer hardware', 1),
('Accessories', 'Computer and mobile accessories', 1),
('Home & Office', 'Furniture and office equipment', NULL),
('Audio', 'Headphones, speakers, and audio equipment', 1),
('Storage', 'Portable and internal storage devices', 2);

-- =====================================================
-- 5. PRODUCTS
-- =====================================================

CREATE TABLE products (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    category_id BIGINT,
    supplier_id BIGINT,
    price DECIMAL(12,2) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO products
(sku, name, description, category_id, supplier_id, price, stock_quantity, is_active)
VALUES
('LAP-001', 'ProBook Laptop 15', '15-inch productivity laptop with 16GB RAM', 2, 1, 899.99, 25, TRUE),
('MOU-001', 'Wireless Mouse', 'Ergonomic wireless mouse with adjustable DPI', 3, 1, 24.99, 150, TRUE),
('KEY-001', 'Mechanical Keyboard', 'Mechanical keyboard with RGB lighting', 3, 2, 79.99, 80, TRUE),
('MON-001', '4K Monitor 27', '27-inch UHD IPS monitor', 2, 2, 329.99, 35, TRUE),
('HUB-001', 'USB-C Hub 7-in-1', 'USB-C hub with HDMI and card reader', 3, 1, 39.99, 100, TRUE),
('CHR-001', 'Ergonomic Office Chair', 'Adjustable office chair with lumbar support', 4, 3, 219.99, 18, TRUE),
('DSK-001', 'Standing Desk', 'Height-adjustable office desk', 4, 3, 449.99, 12, TRUE),
('AUD-001', 'Studio Headphones', 'Over-ear headphones for work and music', 5, 2, 129.99, 45, TRUE),
('SSD-001', 'External SSD 1TB', 'Portable USB-C solid-state drive', 6, 4, 99.99, 65, TRUE),
('WEB-001', 'Full HD Webcam', '1080p webcam with integrated microphone', 3, 2, 59.99, 50, TRUE),
('LAP-002', 'UltraBook Laptop 14', 'Lightweight laptop for everyday productivity', 2, 4, 1099.99, 15, TRUE),
('SPK-001', 'Bluetooth Speaker', 'Compact portable wireless speaker', 5, 2, 49.99, 90, FALSE);

-- =====================================================
-- 6. ORDERS
-- =====================================================

CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(40) UNIQUE NOT NULL,
    customer_id BIGINT NOT NULL,
    handled_by BIGINT,
    status VARCHAR(30) NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    shipping_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(12,2) NOT NULL,
    ordered_at DATETIME NOT NULL,
    notes TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (handled_by) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO orders
(order_number, customer_id, handled_by, status, subtotal, tax_amount, shipping_amount, total_amount, ordered_at, notes)
VALUES
('ORD-2026-0001', 1, 2, 'delivered', 924.98, 46.25, 10.00, 981.23, '2026-03-01 10:15:00', 'Delivered successfully'),
('ORD-2026-0002', 2, 2, 'shipped', 119.98, 6.00, 5.00, 130.98, '2026-03-03 14:30:00', 'Express delivery'),
('ORD-2026-0003', 3, 3, 'processing', 329.99, 16.50, 10.00, 356.49, '2026-03-07 09:45:00', NULL),
('ORD-2026-0004', 4, 2, 'delivered', 349.98, 17.50, 8.00, 375.48, '2026-03-10 16:20:00', 'Customer confirmed receipt'),
('ORD-2026-0005', 5, 4, 'cancelled', 219.99, 11.00, 8.00, 238.99, '2026-03-12 11:10:00', 'Cancelled by customer'),
('ORD-2026-0006', 6, 2, 'delivered', 129.98, 6.50, 5.00, 141.48, '2026-03-15 13:00:00', NULL),
('ORD-2026-0007', 7, 3, 'pending', 1099.99, 55.00, 15.00, 1169.99, '2026-03-18 08:30:00', 'Awaiting payment'),
('ORD-2026-0008', 8, 4, 'shipped', 549.98, 27.50, 15.00, 592.48, '2026-03-20 17:40:00', 'Tracking number pending'),
('ORD-2026-0009', 9, 2, 'delivered', 99.99, 5.00, 5.00, 109.99, '2026-03-22 12:25:00', NULL),
('ORD-2026-0010', 10, 3, 'processing', 139.97, 7.00, 5.00, 151.97, '2026-03-25 15:50:00', 'Gift packaging requested'),
('ORD-2026-0011', 1, 2, 'delivered', 449.99, 22.50, 10.00, 482.49, '2026-04-01 10:00:00', 'Repeat customer'),
('ORD-2026-0012', 12, 4, 'pending', 59.99, 3.00, 5.00, 67.99, '2026-04-05 18:10:00', NULL);

-- =====================================================
-- 7. ORDER ITEMS
-- =====================================================

CREATE TABLE order_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    line_total DECIMAL(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
VALUES
(1, 1, 1, 899.99),
(1, 2, 1, 24.99),
(2, 3, 1, 79.99),
(2, 5, 1, 39.99),
(3, 4, 1, 329.99),
(4, 2, 2, 24.99),
(4, 8, 2, 129.99),
(5, 6, 1, 219.99),
(6, 8, 1, 129.99),
(7, 11, 1, 1099.99),
(8, 7, 1, 449.99),
(8, 5, 1, 39.99),
(9, 9, 1, 99.99),
(10, 2, 1, 24.99),
(10, 3, 1, 79.99),
(10, 5, 1, 34.99),
(11, 7, 1, 449.99),
(12, 10, 1, 59.99);

-- =====================================================
-- 8. PAYMENTS
-- =====================================================

CREATE TABLE payments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    transaction_reference VARCHAR(100) UNIQUE NOT NULL,
    payment_method VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    paid_at DATETIME,
    metadata JSON,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
-- 9. INDEXES
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
