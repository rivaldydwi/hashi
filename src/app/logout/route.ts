import { signOut } from "@/auth";

// Dipakai saat akses user dicabut (dinonaktifkan / kata sandi di-reset admin):
// hapus cookie sesi lalu kembali ke halaman login.
export async function GET() {
  await signOut({ redirectTo: "/login" });
}
