import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// scripts/deploy.sh (T-015): log lengkap ke berkas, terminal hanya ringkasan; gagal = 40 baris terakhir + path; hanya deploy-*.log dipangkas. Diuji DI REPO SEMENTARA dengan `docker`/`curl`
// palsu (PATH), jadi tidak menyentuh container, produksi, atau jaringan.
const SCRIPT = path.resolve("scripts/deploy.sh");
const root = mkdtempSync(path.join(tmpdir(), "hashi-deploy-test-"));
after(() => spawnSync("rm", ["-rf", root]));

const sh = (cwd: string, cmd: string, args: string[], env: Record<string, string> = {}) => spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
const git = (cwd: string, ...a: string[]) => {
  const r = sh(cwd, "git", ["-c", "user.name=t", "-c", "user.email=t@t.t", ...a]);
  assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

function setup(name: string) {
  const dir = path.join(root, name);
  const origin = path.join(dir, "origin.git");
  const work = path.join(dir, "work");
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "main");
  mkdirSync(path.join(work, "scripts"));
  copyFileSync(SCRIPT, path.join(work, "scripts/deploy.sh"));
  writeFileSync(path.join(work, "scripts/backup.sh"), '#!/usr/bin/env bash\n[[ -n "${FAKE_BACKUP_FAIL:-}" ]] && { echo "ERROR: simulasi cadangan gagal"; exit 3; }\necho "→ dump database"\necho "✓ cadangan selesai: hashi-20260101-000000-{db.dump.gpg}"\necho "  database 10 entri, dokumen 2 berkas, total 1M"\n', { mode: 0o755 });
  writeFileSync(path.join(work, "compose.yaml"), "name: hashi\n");
  writeFileSync(path.join(work, ".gitignore"), ".env\n");
  writeFileSync(path.join(work, ".env"), "APP_PORT=3110\nCARD_DATA_KEY=kunci-uji-palsu\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "awal");
  git(work, "push", "-q", "-u", "origin", "main");
  // docker palsu: mencatat argumen, keluaran bising; gagal sesuai FAKE_FAIL=build|up
  writeFileSync(path.join(bin, "docker"), `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_DOCKER_LOG"
case "$*" in
  *" build"*) for i in $(seq 1 120); do echo "#$i [app] RUN langkah build bising nomor $i"; done
              [[ "\${FAKE_FAIL:-}" == build ]] && { echo "ERROR: simulasi build gagal: npm ci exit 1"; exit 1; }; exit 0 ;;
  *" up "*)   for i in $(seq 1 30); do echo " Container hashi-x-$i Started"; done
              [[ "\${FAKE_FAIL:-}" == up ]] && { echo "service migrate didn't complete successfully: exit 1"; exit 1; }; exit 0 ;;
  *"logs"*)   echo "✓ Migration selesai"; exit 0 ;;
  *"ps"*)     echo "hashi-app-1 Up"; exit 0 ;;
  *"image inspect"*) git -C "$FAKE_REPO" rev-parse --short HEAD; exit 0 ;;
esac
exit 0
`, { mode: 0o755 });
  writeFileSync(path.join(bin, "curl"), `#!/usr/bin/env bash
[[ "\${FAKE_HEALTH:-}" == bad ]] && exit 22
echo "{\\"status\\":\\"ok\\",\\"commit\\":\\"$(git -C "$FAKE_REPO" rev-parse --short HEAD)\\"}"
`, { mode: 0o755 });
  chmodSync(path.join(bin, "docker"), 0o755);
  const logs = path.join(dir, "logs");
  const dockerLog = path.join(dir, "docker.log");
  writeFileSync(dockerLog, "");
  const env = { PATH: `${bin}:${process.env.PATH}`, FAKE_REPO: work, FAKE_DOCKER_LOG: dockerLog, HASHI_DEPLOY_LOG_DIR: logs, HOME: dir };
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const r = sh(work, "bash", ["scripts/deploy.sh", ...args], { ...env, ...extra });
    // DEPLOY_TEST_VERBOSE=1: cetak keluaran apa adanya (contoh untuk PR/dokumentasi)
    if (process.env.DEPLOY_TEST_VERBOSE) console.log(`\n===== ${name} (${args.join(" ")} ${JSON.stringify(extra)}) exit ${r.status}\n--- stdout\n${r.stdout}--- stderr\n${r.stderr}`);
    return r;
  };
  const dockerCalls = () => readFileSync(dockerLog, "utf8");
  const logFiles = () => (existsSync(logs) ? readdirSync(logs).filter((f) => /^deploy-.*\.log$/.test(f)) : []);
  return { work, logs, run, dockerCalls, logFiles };
}

test("sukses: terminal hanya ringkasan per langkah (tanpa keluaran build bising); log lengkap ada, mode 600, memuat keluaran bising dan 'health ok'", () => {
  const t = setup("sukses");
  const sha = git(t.work, "rev-parse", "--short", "HEAD");
  const r = t.run(["--timeout", "5"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const s of ["→ git pull --ff-only", "→ build image", "→ migrasi + mulai layanan", "→ menunggu /api/health", `✓ deploy selesai. Commit berjalan: ${sha}`, "migrasi selesai: ✓ Migration selesai"]) assert.ok(r.stdout.includes(s), `terminal harus memuat: ${s}\n${r.stdout}`);
  assert.ok(!/langkah build bising/.test(r.stdout) && !/Container hashi-x/.test(r.stdout), "keluaran build/up tidak boleh membanjiri terminal");
  const files = t.logFiles();
  assert.equal(files.length, 1);
  const log = path.join(t.logs, files[0]);
  assert.ok(r.stdout.includes(`log: ${log}`));
  assert.equal(statSync(log).mode & 0o777, 0o600);
  const text = readFileSync(log, "utf8");
  assert.match(text, /RUN langkah build bising nomor 120/);
  assert.match(text, /### health ok: /);
  assert.match(text, /### build image/);
  assert.ok(!text.includes("kunci-uji-palsu"), "isi .env tidak boleh ada di log");
  // urutan: build dulu, baru up
  const calls = t.dockerCalls();
  assert.ok(calls.indexOf("compose -p hashi build") < calls.indexOf("compose -p hashi up -d"));
});

test("log lama dipangkas: simpan 20 terbaru HANYA untuk berkas deploy-*.log; berkas lain tidak tersentuh", () => {
  const t = setup("pangkas");
  mkdirSync(t.logs, { recursive: true });
  for (let i = 0; i < 25; i++) {
    const f = path.join(t.logs, `deploy-20250101-0000${String(i).padStart(2, "0")}.log`);
    writeFileSync(f, "lama");
    const when = new Date(Date.UTC(2025, 0, 1, 0, 0, i));
    utimesSync(f, when, when);
  }
  writeFileSync(path.join(t.logs, "backup.log"), "jangan hapus");
  writeFileSync(path.join(t.logs, "hashi-20260101-000000-db.dump.gpg"), "jangan hapus");
  const r = t.run(["--timeout", "5"]);
  assert.equal(r.status, 0, r.stderr);
  const files = t.logFiles();
  assert.equal(files.length, 20); // 19 lama terbaru + 1 baru
  assert.ok(!files.includes("deploy-20250101-000000.log") && files.includes("deploy-20250101-000024.log"));
  assert.ok(existsSync(path.join(t.logs, "backup.log")) && existsSync(path.join(t.logs, "hashi-20260101-000000-db.dump.gpg")));
});

test("build gagal: kode != 0, 40 baris terakhir log + path, `up` TIDAK dijalankan, tanpa 'deploy selesai'", () => {
  const t = setup("build-gagal");
  const r = t.run(["--timeout", "5"], { FAKE_FAIL: "build" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /langkah 'build image' GAGAL \(kode 1\)\. 40 baris terakhir log:/);
  assert.match(r.stderr, /ERROR: simulasi build gagal: npm ci exit 1/);
  assert.match(r.stderr, /log lengkap: \S+deploy-\d{8}-\d{6}\.log/);
  const shown = r.stderr.split("\n").filter((l) => l.startsWith("  | ")).length;
  assert.ok(shown >= 30 && shown <= 40, `baris log ditampilkan: ${shown}`);
  assert.ok(!r.stdout.includes("deploy selesai"));
  assert.ok(!t.dockerCalls().includes("up -d"), "up -d tidak boleh jalan setelah build gagal");
});

test("migrasi/up gagal: kode != 0, log service migrate dilampirkan ke log, pesan jelas", () => {
  const t = setup("up-gagal");
  const r = t.run(["--timeout", "5"], { FAKE_FAIL: "up" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /langkah 'migrasi \+ mulai layanan' GAGAL/);
  assert.match(r.stderr, /service migrate didn't complete successfully/);
  const text = readFileSync(path.join(t.logs, t.logFiles()[0]), "utf8");
  assert.match(text, /### log service migrate \(30 baris\)/);
});

test("health tidak memuat commit baru: kode != 0, status container dan log app dilampirkan", () => {
  const t = setup("health-gagal");
  const r = t.run(["--timeout", "1"], { FAKE_HEALTH: "bad" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /health tidak menunjukkan commit/);
  assert.match(r.stderr, /langkah 'health' GAGAL/);
  assert.match(readFileSync(path.join(t.logs, t.logFiles()[0]), "utf8"), /hashi-app-1 Up/);
});

test("--backup: ringkasan 2 baris terakhir cadangan di terminal; cadangan gagal membatalkan deploy SEBELUM build", () => {
  const ok = setup("backup-ok");
  const r = ok.run(["--backup", "--timeout", "5"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /→ cadangan dulu/);
  assert.match(r.stdout, /✓ cadangan selesai: hashi-20260101-000000/);
  assert.match(r.stdout, /database 10 entri, dokumen 2 berkas/);
  assert.ok(!r.stdout.includes("→ dump database"), "hanya ringkasan, bukan seluruh keluaran cadangan");
  const bad = setup("backup-gagal");
  const f = bad.run(["--backup", "--timeout", "5"], { FAKE_BACKUP_FAIL: "1" });
  assert.notEqual(f.status, 0);
  assert.match(f.stderr, /langkah 'cadangan' GAGAL \(kode 3\)/);
  assert.match(f.stderr, /simulasi cadangan gagal/);
  assert.ok(!bad.dockerCalls().includes("build"), "build tidak boleh jalan setelah cadangan gagal");
});

test("--check: tidak menyentuh docker dan tidak membuat log; syarat tetap diperiksa (bukan di main = ditolak)", () => {
  const t = setup("check");
  const r = t.run(["--check"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--check: syarat terpenuhi/);
  assert.equal(t.dockerCalls(), "");
  assert.equal(t.logFiles().length, 0);
  git(t.work, "checkout", "-q", "-b", "cabang");
  const bad = t.run(["--check"]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /harus di branch main/);
});
