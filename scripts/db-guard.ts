// Pengaman: script/tes yang MENULIS data uji hanya boleh berjalan di database dev atau test.
// Nama database (dari DATABASE_URL dan MIGRATE_DATABASE_URL) harus berakhiran _dev atau _test.
// Ini mencegah kecelakaan seperti menjalankan e2e atau `db:seed -- --reset` ke database produksi
// (`hashi`). CI memakai nama khusus (`hashi_test`).
//
// Kalau benar-benar disengaja: ALLOW_DESTRUCTIVE_DB=1 <perintah>

export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "(URL tidak valid)";
  }
}

export function assertTestDatabase(what: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.ALLOW_DESTRUCTIVE_DB === "1") {
    console.warn(`⚠ ALLOW_DESTRUCTIVE_DB=1: pengaman database dilewati untuk "${what}".`);
    return;
  }
  const urls: Record<string, string | undefined> = {
    DATABASE_URL: env.DATABASE_URL,
    MIGRATE_DATABASE_URL: env.MIGRATE_DATABASE_URL,
  };
  const set = Object.entries(urls).filter((e): e is [string, string] => Boolean(e[1]));
  if (set.length === 0) {
    throw new Error(`✗ ${what} DITOLAK: DATABASE_URL / MIGRATE_DATABASE_URL belum di-set.`);
  }
  for (const [key, url] of set) {
    const name = databaseName(url);
    if (!/_(dev|test)$/.test(name)) {
      throw new Error(
        `✗ ${what} DITOLAK: ${key} mengarah ke database "${name}", bukan database dev/test.\n` +
          `  Nama database harus berakhiran "_dev" atau "_test" supaya data uji tidak masuk ke produksi.\n` +
          `  Perbaiki .env (mis. .../hashi_dev), atau jika benar-benar disengaja: ALLOW_DESTRUCTIVE_DB=1 <perintah>`,
      );
    }
  }
}
