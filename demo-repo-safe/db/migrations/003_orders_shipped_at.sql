-- Track shipping time for the new fulfilment dashboard
ALTER TABLE orders ADD COLUMN shipped_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE orders ADD COLUMN tracking_code text NOT NULL;
