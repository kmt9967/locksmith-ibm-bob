-- Baseline schema (already in production)
CREATE TABLE customers (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  full_name  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id        bigserial PRIMARY KEY,
  sku       text NOT NULL UNIQUE,
  title     text NOT NULL,
  price     numeric(10,2) NOT NULL
);

CREATE TABLE orders (
  id          bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  status      text,
  total       integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         bigserial PRIMARY KEY,
  order_id   bigint NOT NULL,
  product_id bigint NOT NULL REFERENCES products(id),
  quantity   integer NOT NULL,
  unit_price numeric(10,2) NOT NULL
);
