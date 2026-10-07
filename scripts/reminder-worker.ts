// Worker pengingat 在留カード (T-022): service `worker` di project compose `hashi` (BUKAN cron sistem / systemd). Berjalan terus; tiap hari jam 08:00 Asia/Tokyo menjalankan
// `runCardReminders` (src/db/card-reminders.ts, lewat withSystem/withTenant). Saat dimulai (mis. setelah deploy) dan sudah lewat jam 08:00, menyusul SEKALI (aman: log pengiriman unik).
//
//   SMTP_URL   mis. smtp://user:pass@host:587 ; KOSONG = MODE KERING (tidak ada email, hanya log "akan dikirim" tanpa alamat)
//   MAIL_FROM  pengirim, mis. "Hashi <hashi@contoh.id>"
//   APP_URL    alamat dasar Hashi untuk tautan di email (kosong = tanpa tautan)
//   --once     jalankan satu putaran lalu keluar (uji manual / integrasi)
// Hanya mengimpor dari src/db (aturan scripts/). Nilai SMTP_URL (kata sandi!) tidak pernah dicetak.
import nodemailer from "nodemailer";
import { afterSendTimeToday, nextRunAfter, runCardReminders, type Mailer } from "../src/db/card-reminders";

const once = process.argv.includes("--once");
const smtpUrl = process.env.SMTP_URL?.trim() || "";
const from = process.env.MAIL_FROM?.trim() || "Hashi <noreply@localhost>";
const baseUrl = process.env.APP_URL?.trim() || null;
const mailer: Mailer | null = smtpUrl ? (nodemailer.createTransport(smtpUrl) as unknown as Mailer) : null;
const log = (line: string) => console.log(line);

async function tick() {
  try {
    await runCardReminders({ mailer, from, baseUrl, log });
  } catch (err) {
    console.error(`[reminder] putaran gagal: ${err instanceof Error ? err.name : "error"}${err instanceof Error ? ` (${err.message.slice(0, 120)})` : ""}`);
    if (once) process.exitCode = 1;
  }
}

function schedule(after: Date) {
  const next = nextRunAfter(after);
  log(`[reminder] putaran berikutnya ${next.toISOString()} (08:00 Asia/Tokyo)`);
  const timer = setTimeout(async () => {
    await tick();
    schedule(new Date(Math.max(Date.now(), next.getTime()) + 1000)); // jangan jatuh ke target yang sama bila timer menyala sedikit lebih awal
  }, Math.min(Math.max(next.getTime() - Date.now(), 1000), 2 ** 31 - 1));
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => { clearTimeout(timer); process.exit(0); });
}

async function main() {
  log(`[reminder] worker mulai: mode=${mailer ? "kirim (SMTP_URL terisi)" : "KERING (SMTP_URL kosong: tidak ada email terkirim)"}`);
  if (once) {
    await tick();
    process.exit(process.exitCode ?? 0); // kolam koneksi database masih terbuka
  }
  if (afterSendTimeToday(new Date())) await tick(); // menyusul setelah mulai ulang; log pengiriman mencegah dobel
  schedule(new Date());
}
void main();
