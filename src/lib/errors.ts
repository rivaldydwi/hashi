/** Error yang aman ditampilkan ke pengguna. `code` adalah kunci pesan di messages/*.json. */
export class ActionError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "ActionError";
  }
}

/** Ambil kode error Postgres (mis. "23505" = duplikat) dari error Drizzle/pg. */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_CHECK_VIOLATION = "23514";
