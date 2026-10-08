import { NotFoundView } from "@/components/NotFoundView";

// 404 di dalam shell aplikasi (T-029): semua `notFound()` di halaman (app) (id tidak ada ATAU tidak punya akses) memakai ini; sidebar dan header tetap utuh.
export default function AppNotFound() {
  return <NotFoundView />;
}
