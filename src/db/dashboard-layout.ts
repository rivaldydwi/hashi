// Tata letak dashboard per pengguna: validator dan penyelesai (murni, tanpa DB). Bentuk tersimpan (jsonb):
//   { v: 1, items: [{ id: "<id widget>", size?: "half" | "full", hidden?: true }, ...] }   (urutan array = urutan tampil)
// `resolveLayout` TIDAK PERNAH gagal: data usang/rusak (widget dihapus dari katalog, peran berganti) dibuang diam-diam dan widget
// yang belum tercantum ditambahkan di akhir menurut urutan bawaan. `parseLayoutInput` ketat, dipakai server action saat menyimpan.
import { z } from "zod";
import type { Role } from "./schema";
import { widgetById, widgetsForRole, type WidgetSize } from "./dashboard-catalog";

export type ResolvedItem = { id: string; kind: "kpi" | "widget"; size: WidgetSize; hidden: boolean };
export type StoredLayout = { v: 1; items: Array<{ id: string; size?: WidgetSize; hidden?: boolean }> };

const itemSchema = z.object({ id: z.string().min(1).max(40), size: z.enum(["half", "full"]).optional(), hidden: z.boolean().optional() }).strict();
const layoutSchema = z.object({ v: z.literal(1), items: z.array(itemSchema).max(40) }).strict();

/** Susunan bawaan peran: urutan katalog, ukuran bawaan, tidak ada yang disembunyikan. */
export function defaultLayout(role: Role): ResolvedItem[] {
  return widgetsForRole(role).map((w) => ({ id: w.id, kind: w.kind, size: w.kind === "kpi" ? "half" : w.defaultSize, hidden: false }));
}

/** Gabungkan layout tersimpan dengan katalog peran. `stored` boleh apa saja (null, rusak, dari versi lama). */
export function resolveLayout(role: Role, stored: unknown): ResolvedItem[] {
  const base = defaultLayout(role);
  const parsed = layoutSchema.safeParse(stored);
  if (!parsed.success) return base;
  const byId = new Map(base.map((b) => [b.id, b]));
  const out: ResolvedItem[] = [];
  const seen = new Set<string>();
  for (const it of parsed.data.items) {
    const def = byId.get(it.id);
    if (!def || seen.has(it.id)) continue; // widget tak dikenal / bukan untuk peran ini / duplikat
    seen.add(it.id);
    const allowed = widgetById(it.id)!.sizes;
    out.push({ ...def, size: def.kind === "kpi" ? "half" : it.size && allowed.includes(it.size) ? it.size : def.size, hidden: it.hidden === true });
  }
  for (const b of base) if (!seen.has(b.id)) out.push(b); // widget baru dari katalog: tampil di akhir
  return out;
}

export class LayoutError extends Error {}

/** Validasi masukan dari klien sebelum disimpan. Melempar LayoutError bila ada id di luar katalog peran, duplikat, atau ukuran yang tak diizinkan. */
export function parseLayoutInput(role: Role, input: unknown): StoredLayout {
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) throw new LayoutError("bentuk layout tidak valid");
  const allowed = new Set(widgetsForRole(role).map((w) => w.id));
  const seen = new Set<string>();
  const items: StoredLayout["items"] = [];
  for (const it of parsed.data.items) {
    if (!allowed.has(it.id)) throw new LayoutError(`widget tidak dikenal untuk peran ini: ${it.id}`);
    if (seen.has(it.id)) throw new LayoutError(`widget ganda: ${it.id}`);
    seen.add(it.id);
    const def = widgetById(it.id)!;
    if (it.size && !def.sizes.includes(it.size)) throw new LayoutError(`ukuran tidak diizinkan: ${it.id}`);
    items.push({ id: it.id, ...(it.size && def.kind === "widget" ? { size: it.size } : {}), ...(it.hidden ? { hidden: true } : {}) });
  }
  return { v: 1, items };
}

/** Bentuk tersimpan dari susunan terselesaikan (dipakai klien saat menyimpan). */
export function toStored(items: ResolvedItem[]): StoredLayout {
  return { v: 1, items: items.map((i) => ({ id: i.id, ...(i.kind === "widget" ? { size: i.size } : {}), ...(i.hidden ? { hidden: true } : {}) })) };
}
