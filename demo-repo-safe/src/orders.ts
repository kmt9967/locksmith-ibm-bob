import { db } from "./db";

export async function listOrdersForCustomer(customerId: number) {
  const { rows } = await db.query(
    "SELECT id, status, total_new AS total, created_at FROM orders WHERE customer_id = $1 ORDER BY created_at DESC",
    [customerId],
  );
  return rows;
}

export async function placeOrder(customerId: number, totalCents: number) {
  const { rows } = await db.query(
    "INSERT INTO orders (customer_id, status, total, total_new) VALUES ($1, 'new', $2, $2) RETURNING id",
    [customerId, totalCents],
  );
  return rows[0].id as number;
}
