// Kerangka muatan (skeleton): bentuknya mirip halaman (judul + kartu) supaya tata letak tidak melompat. Dipakai lewat <Suspense fallback>.
// SENGAJA bukan `loading.tsx` tingkat (app): loading.tsx membuat respons mulai dengan status 200 sehingga `notFound()` di bawahnya tidak lagi menghasilkan HTTP 404
// (aturan akses kita memakai 404 untuk halaman yang tidak boleh dibuka peran itu). Pakai hanya di bagian halaman yang tidak memanggil notFound()/redirect().
export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" data-testid="page-skeleton">
      <span className="sr-only">…</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-card" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl border border-line bg-card" />)}
      </div>
    </div>
  );
}
