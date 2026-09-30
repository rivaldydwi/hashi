// Hasil server action untuk form. `key` adalah kunci pesan lengkap di messages/*.json,
// mis. "users.errors.emailTaken", supaya bisa diterjemahkan di sisi client.

export type FormState =
  | { status: "idle" }
  | { status: "error"; key: string }
  | { status: "success"; key: string; tempPassword?: string; email?: string; id?: string };

export const idle: FormState = { status: "idle" };
