import { db } from "./db";

export async function findCustomerByEmail(email: string) {
  const { rows } = await db.query(
    "SELECT id, email, full_name FROM customers WHERE email = $1",
    [email],
  );
  return rows[0] ?? null;
}

export async function createCustomer(email: string, fullName: string) {
  const { rows } = await db.query(
    "INSERT INTO customers (email, full_name) VALUES ($1, $2) RETURNING id",
    [email, fullName],
  );
  return rows[0].id as number;
}
