import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, ElementHandle, Locator, Page } from "@playwright/test";
import sharp from "sharp";
import { login } from "../e2e/helpers";

// Pembantu tangkapan layar buku panduan (T-030). Gambar ditulis ke docs/panduan/img/, dimampatkan (palet PNG) supaya PDF tetap kecil.
export const IMG = path.resolve("docs/panduan/img");
export const DESKTOP = { width: 1280, height: 800 };
export const PHONE = { width: 390, height: 800 };

export type Role = "lpk" | "sensei" | "tsk" | "staff" | "admin";
const EMAIL: Record<Role, string> = {
  lpk: "lpk1.admin@hashi.test",
  sensei: "lpk1.sensei@hashi.test",
  tsk: "tsk.admin@hashi.test",
  staff: "tsk.staff@hashi.test",
  admin: "admin@hashi.test",
};

/** Buka sesi baru untuk satu peran, tampilan bahasa Indonesia (akun TSK demo bawaannya Jepang). */
export async function open(browser: Browser, role: Role, viewport = DESKTOP): Promise<Page> {
  const page = await (await browser.newContext({ viewport, locale: "id-ID", timezoneId: "Asia/Jakarta" })).newPage();
  await login(page, EMAIL[role]);
  if ((await page.locator("html").getAttribute("lang")) === "ja") {
    await page.getByRole("button", { name: "Indonesia" }).first().click();
    await page.waitForFunction(() => document.documentElement.lang === "id");
  }
  return page;
}

/** Beri kotak merah sementara pada elemen yang ingin ditunjuk (dikembalikan seperti semula setelah foto). */
async function mark(targets: Locator[]) {
  const handles: ElementHandle<HTMLElement | SVGElement>[] = [];
  for (const t of targets) {
    const el = await t.first().elementHandle();
    if (!el) continue;
    await el.evaluate((e) => {
      const h = e as HTMLElement;
      h.dataset.prevOutline = h.style.outline;
      h.dataset.prevOffset = h.style.outlineOffset;
      h.style.outline = "3px solid #dc2626";
      h.style.outlineOffset = "3px";
      h.style.borderRadius = h.style.borderRadius || "8px";
    });
    handles.push(el);
  }
  return async () => {
    for (const el of handles) {
      await el.evaluate((e) => {
        const h = e as HTMLElement;
        h.style.outline = h.dataset.prevOutline ?? "";
        h.style.outlineOffset = h.dataset.prevOffset ?? "";
      });
    }
  };
}

async function hideSticky(page: Page, target: Locator) {
  const handle = await target.first().elementHandle();
  await page.evaluate((t) => {
    for (const e of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const pos = getComputedStyle(e).position;
      if (t && (e === t || t.contains(e) || e.contains(t))) continue;
      if ((pos === "fixed" || pos === "sticky") && e.dataset.guideHidden === undefined) {
        e.dataset.guideHidden = e.style.visibility || "-";
        e.style.visibility = "hidden";
      }
    }
  }, handle);
  return async () => {
    await page.evaluate(() => {
      for (const e of Array.from(document.querySelectorAll<HTMLElement>("[data-guide-hidden]"))) {
        const v = e.dataset.guideHidden;
        e.style.visibility = v === "-" ? "" : (v ?? "");
        delete e.dataset.guideHidden;
      }
    });
  };
}

export type ShotOpts = {
  /** Foto satu bagian saja (elemen), bukan seluruh layar. */
  of?: Locator;
  /** Foto seluruh halaman (bukan hanya layar yang terlihat). */
  full?: boolean;
  /** Elemen yang diberi kotak merah. */
  mark?: Locator[];
  /** Potong tinggi (px) untuk halaman yang sangat panjang. */
  maxHeight?: number;
  /** Foto sebagian layar saja (koordinat layar). */
  clip?: { x: number; y: number; width: number; height: number };
  /** Jangan gulir ke atas sebelum memotret (untuk bagian yang sengaja di bawah). */
  keepScroll?: boolean;
};

/** Simpan satu gambar panduan. Nama berkas = `<nama>.png`. */
export async function shot(page: Page, name: string, opts: ShotOpts = {}) {
  await mkdir(IMG, { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  // Fokus input (sorotan oranye / bagian tanggal terpilih) dan posisi gulir yang kebetulan tidak dibawa ke gambar.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  if (!opts.of && !opts.keepScroll) await page.evaluate(() => window.scrollTo(0, 0));
  const restore = await mark(opts.mark ?? []);
  // Foto satu bagian: header/nav yang menempel (sticky/fixed) disembunyikan supaya tidak menutupi isi.
  const hidden = opts.of ? await hideSticky(page, opts.of) : async () => undefined;
  let buf: Buffer;
  if (opts.of) {
    await opts.of.first().scrollIntoViewIfNeeded();
    buf = await opts.of.first().screenshot();
  } else {
    buf = await page.screenshot({ fullPage: !!opts.full, clip: opts.clip });
  }
  await hidden();
  await restore();
  let img = sharp(buf);
  if (opts.maxHeight) {
    const m = await img.metadata();
    if ((m.height ?? 0) > opts.maxHeight) img = sharp(buf).extract({ left: 0, top: 0, width: m.width!, height: opts.maxHeight });
  }
  await img.png({ palette: true, quality: 88, compressionLevel: 9 }).toFile(path.join(IMG, `${name}.png`));
}

/** Buka sebuah <details> (formulir lipat) bila masih tertutup. */
export async function openDetails(summary: Locator) {
  const open = await summary.evaluate((s) => (s.closest("details") as HTMLDetailsElement | null)?.open ?? true);
  if (!open) await summary.click();
}

export const isoDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
