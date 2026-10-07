// Jalankan hasil `npm run build` (output standalone) seperti di Docker.
// Dipakai tes e2e. Pemakaian: npm run build && node scripts/serve-standalone.mjs
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const out = ".next/standalone";
if (!existsSync(`${out}/server.js`)) {
  console.error("✗ Belum ada build. Jalankan `npm run build` dulu.");
  process.exit(1);
}
cpSync(".next/static", `${out}/.next/static`, { recursive: true });
cpSync("public", `${out}/public`, { recursive: true });
cpSync("assets", `${out}/assets`, { recursive: true }); // font Jepang untuk PDF (sama seperti image produksi)

// Penjaga T-013: server mati (kode 97) bila ada kueri bersamaan pada satu koneksi pg (peringatan "already executing a query"), supaya e2e/CI gagal keras.
const guard = fileURLToPath(new URL("./guard-pg-concurrency.cjs", import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, `--require ${guard}`].filter(Boolean).join(" ");

const child = spawn(process.execPath, ["server.js"], {
  cwd: out,
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions, HOSTNAME: process.env.HOSTNAME_BIND ?? "127.0.0.1", PORT: process.env.PORT ?? "3100" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
