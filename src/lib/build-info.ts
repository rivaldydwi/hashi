// Commit yang membangun image ini (build-arg GIT_SHA -> env GIT_SHA di Dockerfile). Hanya sha pendek heksadesimal yang dipercaya;
// apa pun selain itu (kosong, "unknown", teks aneh) menjadi "unknown". Tidak ada info lain (versi paket, env, nama host) yang diekspos.
export function normalizeCommit(raw: string | undefined | null): string {
  const v = (raw ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(v) ? v.slice(0, 12) : "unknown";
}

export const buildCommit = (): string => normalizeCommit(process.env.GIT_SHA);
