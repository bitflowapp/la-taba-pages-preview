# Database model draft

This is a Phase 2 draft. It is not the current implementation.

## Purpose

Define a small and practical relational model that can support real products, real orders, delivery zones and later rider tracking.

## Main entities

### businesses

Holds the commerce profile.

Main fields:

- `id`
- `name`
- `whatsapp_number`
- `address`
- `opening_hours`
- `currency`
- `delivery_fee_default`
- `min_order_default`
- `active`

### categories

Groups products.

Main fields:

- `id`
- `business_id`
- `name`
- `slug`
- `icon`
- `sort_order`
- `active`

Relation:

- Many categories belong to one business.

### products

Stores the catalog.

Main fields:

- `id`
- `business_id`
- `category_id`
- `name`
- `description`
- `price`
- `unit`
- `stock`
- `photo_url`
- `featured`
- `offer_label`
- `available`
- `prep_minutes`
- `internal_notes`
- `active`

Relations:

- Many products belong to one business.
- Many products belong to one category.

### customers

Stores repeat buyers and delivery history.

Main fields:

- `id`
- `business_id`
- `name`
- `phone`
- `email`
- `default_address`
- `notes`
- `created_at`

### orders

Stores each order header.

Main fields:

- `id`
- `business_id`
- `customer_id`
- `delivery_zone_id`
- `delivery_mode`
- `status`
- `payment_method`
- `payment_status`
- `subtotal`
- `delivery_fee`
- `total`
- `customer_name`
- `customer_phone`
- `customer_address`
- `notes`
- `created_at`
- `updated_at`

Relations:

- Many orders belong to one business.
- Many orders can belong to one customer.
- Many orders can belong to one delivery zone.

### order_items

Stores the line items for each order.

Main fields:

- `id`
- `order_id`
- `product_id`
- `product_name_snapshot`
- `unit_price_snapshot`
- `quantity`
- `line_total`

Relations:

- Many items belong to one order.
- Many items can reference one product.

### delivery_zones

Stores delivery areas and rules.

Main fields:

- `id`
- `business_id`
- `name`
- `description`
- `delivery_fee`
- `min_order`
- `estimated_minutes`
- `active`
- `notes`

### delivery_assignments

Tracks which rider is handling which order.

Main fields:

- `id`
- `order_id`
- `rider_id`
- `status`
- `assigned_at`
- `left_store_at`
- `delivered_at`
- `notes`

### riders

Stores delivery people.

Main fields:

- `id`
- `business_id`
- `name`
- `phone`
- `active`
- `vehicle_type`
- `notes`

### payments

Stores payment tracking.

Main fields:

- `id`
- `order_id`
- `method`
- `status`
- `amount`
- `reference`
- `paid_at`
- `notes`

## Suggested relations overview

- `businesses` 1:N `categories`
- `businesses` 1:N `products`
- `businesses` 1:N `customers`
- `businesses` 1:N `orders`
- `businesses` 1:N `delivery_zones`
- `businesses` 1:N `riders`
- `orders` 1:N `order_items`
- `orders` 1:1 or 1:N `delivery_assignments`
- `orders` 1:1 `payments`
- `categories` 1:N `products`
- `customers` 1:N `orders`
- `delivery_zones` 1:N `orders`

## Notes for Phase 2

- Keep snapshots in `orders` and `order_items` so future edits to products do not change old orders.
- Keep stock logic simple first.
- Add realtime only where it adds value, mainly order status and rider assignment.
- Do not over-normalize before the business flow is validated.
