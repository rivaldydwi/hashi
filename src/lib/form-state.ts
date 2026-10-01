// Hasil server action untuk form. `key` adalah kunci pesan lengkap di messages/*.json,
// mis. "users.errors.emailTaken", supaya bisa diterjemahkan di sisi client.

export type FormState =
  | { status: "idle" }
  // fieldErrors: kolom yang tidak valid per bagian ("basic", atau "family.3" untuk baris ke-3), dipakai form panjang
  | { status: "error"; key: string; fieldErrors?: Record<string, string[]> }
  | { status: "success"; key: string; tempPassword?: string; email?: string; id?: string };

export const idle: FormState = { status: "idle" };
