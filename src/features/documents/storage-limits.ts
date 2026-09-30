// Konstanta yang aman dipakai di sisi browser (storage.ts memakai modul node:fs, tidak boleh ikut ke client).
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
