import { NotFoundView } from "@/components/NotFoundView";

// 404 untuk alamat di luar shell aplikasi (T-029): terang, bahasa mengikuti cookie/pengguna, tanpa gaya bawaan Next.js.
export default function NotFound() {
  return (
    <main className="min-h-screen bg-page px-4 py-10 text-ink">
      <NotFoundView />
    </main>
  );
}
