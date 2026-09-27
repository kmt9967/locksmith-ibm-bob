// Placeholder DB client for the fictional Shopfront app.
export const db = {
  async query(_sql: string, _params: unknown[]) {
    return { rows: [] as any[] };
  },
};
