// Enkripsi nomor dan foto 在留カード (T-020). AES-256-GCM, nonce 12 byte ACAK per nilai, kunci dari CARD_DATA_KEY.
//
// Kunci (BARU, bukan AUTH_SECRET dan bukan kunci cadangan):
//   CARD_DATA_KEY       32 byte acak, base64 (`openssl rand -base64 32`). Kunci AKTIF untuk menulis.
//   CARD_DATA_KEY_ID    nama kunci aktif (bawaan "k1"; huruf/angka, maks 16). Tercatat di setiap nilai terenkripsi.
//   CARD_DATA_KEYS_OLD  opsional, kunci lama untuk MEMBACA saja: "k0=base64,k1=base64". Dipakai saat kunci diganti (rotasi):
//                       ganti CARD_DATA_KEY + CARD_DATA_KEY_ID, pindahkan kunci lama ke sini, lalu enkripsi ulang (tugas terpisah).
// Tanpa kunci yang sah aplikasi MENOLAK menyimpan/membaca (CardKeyError), tidak pernah menyimpan polos. Kunci tidak pernah dicatat/dicetak.
//
// Format teks (nomor):  hcd1:<keyId>:<nonce b64url>:<ciphertext+tag b64url>
// Format biner (berkas): "HCD1" | panjang keyId (1 byte) | keyId | nonce (12) | ciphertext | tag (16)
// AAD (context) mengikat sandi pada tujuannya (mis. `card-number:<cardId>`): sandi yang dipindahkan ke baris/berkas lain gagal dibuka.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class CardKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardKeyError";
  }
}
export class CardDecryptError extends Error {
  constructor(message = "data terenkripsi tidak bisa dibuka (rusak, kunci salah, atau tujuan berbeda)") {
    super(message);
    this.name = "CardDecryptError";
  }
}

export type Keyring = { currentId: string; keys: Map<string, Buffer> };

const KEY_ID = /^[A-Za-z0-9]{1,16}$/;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAGIC = Buffer.from("HCD1", "ascii");
const TEXT_PREFIX = "hcd1";

function parseKey(b64: string, label: string): Buffer {
  const key = Buffer.from(b64.trim(), "base64");
  // base64 longgar di Buffer.from: periksa bahwa hasilnya tepat 32 byte dan teks aslinya memang base64 (bukan sampah yang terpotong)
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== b64.trim().replace(/=+$/, "")) {
    throw new CardKeyError(`${label} harus 32 byte acak dalam base64 (buat dengan: openssl rand -base64 32)`);
  }
  return key;
}

/** Baca kunci dari lingkungan. Melempar CardKeyError dengan pesan jelas (tanpa membocorkan nilai kunci). */
export function loadKeyring(env: Record<string, string | undefined> = process.env): Keyring {
  const raw = env.CARD_DATA_KEY;
  if (!raw || raw.trim() === "") throw new CardKeyError("CARD_DATA_KEY belum diisi (nomor dan foto kartu tidak bisa disimpan atau dibaca tanpa kunci)");
  const currentId = env.CARD_DATA_KEY_ID?.trim() || "k1";
  if (!KEY_ID.test(currentId)) throw new CardKeyError("CARD_DATA_KEY_ID harus huruf/angka, maksimal 16 karakter");
  const keys = new Map<string, Buffer>([[currentId, parseKey(raw, "CARD_DATA_KEY")]]);
  for (const part of (env.CARD_DATA_KEYS_OLD ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    const id = eq < 0 ? "" : part.slice(0, eq).trim();
    if (!KEY_ID.test(id)) throw new CardKeyError("CARD_DATA_KEYS_OLD harus berbentuk id=base64,id=base64");
    if (keys.has(id)) throw new CardKeyError(`kunci '${id}' terdaftar dua kali`);
    keys.set(id, parseKey(part.slice(eq + 1), `kunci lama '${id}'`));
  }
  return { currentId, keys };
}

let cached: Keyring | null = null;
/** Kunci proses ini (dimuat sekali). Pemeriksaan awal juga dipanggil dari instrumentation.ts supaya aplikasi gagal jalan dengan jelas. */
export function keyring(): Keyring {
  return (cached ??= loadKeyring());
}
/** Hanya untuk tes: buang cache. */
export function resetKeyringCache() {
  cached = null;
}

function seal(plain: Buffer, ring: Keyring, aad: string): { keyId: string; nonce: Buffer; body: Buffer } {
  const key = ring.keys.get(ring.currentId)!;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return { keyId: ring.currentId, nonce, body };
}

function open(keyId: string, nonce: Buffer, body: Buffer, ring: Keyring, aad: string): Buffer {
  const key = ring.keys.get(keyId);
  if (!key) throw new CardDecryptError(`kunci '${keyId}' tidak tersedia (cek CARD_DATA_KEY / CARD_DATA_KEYS_OLD)`);
  if (nonce.length !== NONCE_BYTES || body.length < TAG_BYTES) throw new CardDecryptError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new CardDecryptError();
  }
}

const b64u = (b: Buffer) => b.toString("base64url");

/** Enkripsi teks (nomor kartu). Hasil dan keyId disimpan di database. */
export function encryptText(plain: string, aad: string, ring: Keyring = keyring()): { value: string; keyId: string } {
  const s = seal(Buffer.from(plain, "utf8"), ring, aad);
  return { value: [TEXT_PREFIX, s.keyId, b64u(s.nonce), b64u(s.body)].join(":"), keyId: s.keyId };
}

export function decryptText(value: string, aad: string, ring: Keyring = keyring()): string {
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== TEXT_PREFIX) throw new CardDecryptError();
  return open(parts[1], Buffer.from(parts[2], "base64url"), Buffer.from(parts[3], "base64url"), ring, aad).toString("utf8");
}

/** Enkripsi berkas (foto kartu). */
export function encryptBytes(plain: Uint8Array, aad: string, ring: Keyring = keyring()): { data: Buffer; keyId: string } {
  const s = seal(Buffer.from(plain), ring, aad);
  const id = Buffer.from(s.keyId, "ascii");
  return { data: Buffer.concat([MAGIC, Buffer.from([id.length]), id, s.nonce, s.body]), keyId: s.keyId };
}

export function decryptBytes(data: Uint8Array, aad: string, ring: Keyring = keyring()): Buffer {
  const b = Buffer.from(data);
  if (b.length < MAGIC.length + 1 || !b.subarray(0, MAGIC.length).equals(MAGIC)) throw new CardDecryptError();
  const idLen = b[MAGIC.length];
  const start = MAGIC.length + 1;
  if (idLen === 0 || b.length < start + idLen + NONCE_BYTES + TAG_BYTES) throw new CardDecryptError();
  const keyId = b.subarray(start, start + idLen).toString("ascii");
  const nonce = b.subarray(start + idLen, start + idLen + NONCE_BYTES);
  return open(keyId, nonce, b.subarray(start + idLen + NONCE_BYTES), ring, aad);
}

// ---- Nomor kartu ---------------------------------------------------------------------------

/** 12 karakter: 2 huruf + 8 angka + 2 huruf (contoh format: AB12345678CD). */
export const CARD_NUMBER = /^[A-Z]{2}[0-9]{8}[A-Z]{2}$/;

/** Rapikan isian (spasi/strip dibuang, huruf besar). null = format salah. */
export function normalizeCardNumber(input: string): string | null {
  const v = input.replace(/[\s\-　]/g, "").toUpperCase();
  return CARD_NUMBER.test(v) ? v : null;
}

/** "AB12345678CD" → "AB********CD" (satu-satunya bentuk yang tampil tanpa tombol "Tampilkan"). */
export function maskCardNumber(n: string): string {
  return `${n.slice(0, 2)}${"*".repeat(8)}${n.slice(10)}`;
}

/** Konteks AAD per tujuan: sandi tidak bisa dipindah ke kartu/foto lain. */
export const numberAad = (cardId: string) => `card-number:${cardId}`;
export const photoAad = (photoId: string) => `card-photo:${photoId}`;
