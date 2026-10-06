// Model isi lembar klien (langkah 6) yang SUDAH siap digambar: dibuat dari data mentah + mode + bahasa label. Dipakai SAMA persis oleh pembuat PDF
// dan pratinjau di layar (jadi pratinjau = isi PDF). Murni (tanpa pdfkit/DB). Semua label dan urutan bagian dari client-sheet.config.ts.
import {
  COMPLETENESS, OPENING_COLUMNS, SECTIONS, SHARE_EXCLUDES, formatEmployees, formatGender, formatHousing, formatJpRequirement, formatSalaryYen, formatYmd, label,
  type LabelKey, type LabelLang, type SheetKind, type SheetMode,
} from "./client-sheet.config";

export type SheetContact = { roleTitle: string | null; name: string; phone: string | null };
export type SheetSite = { name: string; address: string | null; phone: string | null; accessNote: string | null; note: string | null; contacts: SheetContact[] };
export type CompanySheetData = {
  company: { name: string; hqAddress: string | null; industry: string | null; employeeCount: number | null; foreignWorkerExperience: string | null; publicIntro: string | null; note: string | null };
  /** Nama bidang (Jepang) yang diterima, dari lokasi yang ikut. */
  fieldNames: string[];
  sites: SheetSite[];
  /** Job order OPEN pada lokasi yang ikut; `remaining` = posisi - terpilih (tidak kurang dari 0). */
  openings: Array<{ fieldName: string; remaining: number; minJlpt: string | null; jftRequired: boolean; targetStartDate: string | null; applicationDeadline: string | null; genderRequirement: string | null }>;
};
export type JobOrderSheetData = {
  companyName: string;
  site: SheetSite;
  fieldName: string;
  jo: {
    title: string; positions: number; description: string | null; workHours: string | null; daysOff: string | null; monthlySalary: number | null; salaryNote: string | null;
    housing: string | null; housingNote: string | null; commuteNote: string | null; benefitsNote: string | null; minJlpt: string | null; jftRequired: boolean;
    targetStartDate: string | null; applicationDeadline: string | null; genderRequirement: string | null; workPlace: string | null; note: string | null;
  };
};

export type Rows = Array<[string, string]>;
export type SheetSection =
  | { id: string; heading: string; kind: "kv"; rows: Rows }
  | { id: string; heading: string; kind: "text"; text: string }
  | { id: string; heading: string; kind: "blocks"; blocks: Array<{ heading: string; rows: Rows }> }
  | { id: string; heading: string; kind: "table"; cols: Array<{ header: string; width: number }>; rows: string[][] };

type Body<S> = S extends unknown ? Omit<S, "id" | "heading"> : never;

export type Sheet = {
  kind: SheetKind;
  mode: SheetMode;
  lang: LabelLang;
  title: string;
  subtitle: string;
  /** Baris penanda kecil di atas judul: jenis dokumen + mode ("社内用" / "提供用"). */
  badge: string;
  /** Teks pojok kanan atas header halaman (selalu Jepang). */
  headerRight: string;
  /** Judul metadata PDF (generik, tanpa nama perusahaan). */
  docTitle: string;
  sections: SheetSection[];
  /** Bagian yang dikonfigurasi tetapi DILEWATI karena datanya kosong (ditandai di pratinjau). */
  skipped: string[];
  /** Kunci isian "Informasi untuk lembar" yang belum diisi (petunjuk kelengkapan; tidak menghalangi ekspor). */
  missing: string[];
  /** Kunci hal yang sengaja tidak disertakan (hanya mode share). */
  excluded: string[];
};

const clean = (v: string | null | undefined) => (v ?? "").trim();
const pushRow = (rows: Rows, key: LabelKey, value: string | null | undefined, lang: LabelLang) => {
  const v = clean(value);
  if (v) rows.push([label(key, lang), v]);
};

function contactLine(c: SheetContact, internal: boolean): string {
  const head = [clean(c.roleTitle), c.name].filter(Boolean).join("　");
  return internal && clean(c.phone) ? `${head}（${clean(c.phone)}）` : head;
}

function siteBlock(s: SheetSite, internal: boolean, lang: LabelLang): { heading: string; rows: Rows } {
  const rows: Rows = [];
  pushRow(rows, "address", s.address, lang);
  pushRow(rows, "phone", s.phone, lang);
  pushRow(rows, "access", s.accessNote, lang);
  if (s.contacts.length) rows.push([label("contactPerson", lang), s.contacts.map((c) => contactLine(c, internal)).join("\n")]);
  return { heading: s.name, rows };
}

function missingFor(kind: SheetKind, present: Record<string, boolean>): string[] {
  return COMPLETENESS[kind].filter((k) => !present[k]);
}

/** Susun bagian sesuai urutan di config; bagian kosong dilewati (dicatat di `skipped`), bagian internal hilang di mode share. */
function assemble(kind: SheetKind, mode: SheetMode, lang: LabelLang, built: Record<string, Body<SheetSection> | null>) {
  const sections: SheetSection[] = [];
  const skipped: string[] = [];
  for (const def of SECTIONS[kind]) {
    const internalOnly = "internalOnly" in def && def.internalOnly;
    if (internalOnly && mode === "share") continue;
    const body = built[def.id];
    const heading = label(def.label, lang);
    if (!body) skipped.push(heading);
    else sections.push({ id: def.id, heading, ...body } as SheetSection);
  }
  return { sections, skipped };
}

const kvOrNull = (rows: Rows) => (rows.length ? ({ kind: "kv", rows } as const) : null);

export function buildCompanySheet(data: CompanySheetData, opts: { mode: SheetMode; lang: LabelLang; preparedBy?: string }): Sheet {
  const { mode, lang } = opts;
  const internal = mode === "internal";
  const c = data.company;

  const basic: Rows = [];
  pushRow(basic, "corporateName", c.name, lang);
  pushRow(basic, "address", c.hqAddress, lang);
  pushRow(basic, "industry", c.industry, lang);
  pushRow(basic, "employeeCount", formatEmployees(c.employeeCount), lang);
  pushRow(basic, "foreignExperience", c.foreignWorkerExperience, lang);
  pushRow(basic, "acceptedFields", data.fieldNames.join("、"), lang);

  const blocks = data.sites.map((s) => siteBlock(s, internal, lang)).filter((b) => b.heading);

  const cols = OPENING_COLUMNS.filter((col) => internal || !("internalOnly" in col && col.internalOnly));
  const openingRows = data.openings.map((o) =>
    cols.map((col) => {
      switch (col.id) {
        case "field": return o.fieldName;
        case "positions": return `${o.remaining}名`;
        case "jp": return formatJpRequirement(o.minJlpt, o.jftRequired, lang);
        case "start": return formatYmd(o.targetStartDate);
        case "deadline": return formatYmd(o.applicationDeadline);
        default: return formatGender(o.genderRequirement, lang);
      }
    }),
  );

  const notes: Rows = [];
  if (clean(c.note)) notes.push([label("note", lang), clean(c.note)]);
  for (const s of data.sites) if (clean(s.note)) notes.push([s.name, clean(s.note)]);

  const { sections, skipped } = assemble("company", mode, lang, {
    basic: kvOrNull(basic),
    intro: clean(c.publicIntro) ? { kind: "text", text: clean(c.publicIntro) } : null,
    sites: blocks.length ? { kind: "blocks", blocks } : null,
    openings: openingRows.length ? { kind: "table", cols: cols.map((col) => ({ header: label(col.label, lang), width: col.width })), rows: openingRows } : null,
    internalNote: kvOrNull(notes),
  });

  return {
    kind: "company", mode, lang,
    title: c.name,
    subtitle: internal && opts.preparedBy ? `${label("createdBy", lang)}: ${opts.preparedBy}` : "",
    badge: `${label("docCompany", lang)}　・　${label(internal ? "modeInternal" : "modeShare", lang)}`,
    headerRight: `${label("docCompany", "ja")}　${label(internal ? "modeInternal" : "modeShare", "ja")}`,
    docTitle: label("docCompany", "ja"),
    sections, skipped,
    missing: missingFor("company", {
      industry: !!clean(c.industry), employeeCount: c.employeeCount !== null, foreignWorkerExperience: !!clean(c.foreignWorkerExperience),
      publicIntro: !!clean(c.publicIntro), accessNote: data.sites.length > 0 && data.sites.every((s) => !!clean(s.accessNote)),
    }),
    excluded: internal ? [] : [...SHARE_EXCLUDES.company],
  };
}

export function buildJobOrderSheet(data: JobOrderSheetData, opts: { mode: SheetMode; lang: LabelLang; preparedBy?: string }): Sheet {
  const { mode, lang } = opts;
  const internal = mode === "internal";
  const j = data.jo;

  const basic: Rows = [];
  pushRow(basic, "company", data.companyName, lang);
  pushRow(basic, "siteName", data.site.name, lang);
  pushRow(basic, "field", data.fieldName, lang);
  pushRow(basic, "positions", `${j.positions}名`, lang);

  const conditions: Rows = [];
  pushRow(conditions, "duties", j.description, lang);
  pushRow(conditions, "workHours", j.workHours, lang);
  pushRow(conditions, "daysOff", j.daysOff, lang);
  const salary = [j.monthlySalary !== null ? formatSalaryYen(j.monthlySalary, lang) : "", clean(j.salaryNote)].filter(Boolean).join("\n");
  pushRow(conditions, "salary", salary, lang);
  pushRow(conditions, "housing", formatHousing(j.housing, j.housingNote, lang), lang);
  pushRow(conditions, "commute", j.commuteNote, lang);
  pushRow(conditions, "benefits", j.benefitsNote, lang);

  const requirements: Rows = [];
  pushRow(requirements, "jpRequirement", formatJpRequirement(j.minJlpt, j.jftRequired, lang), lang);
  pushRow(requirements, "startDate", formatYmd(j.targetStartDate), lang);
  pushRow(requirements, "deadline", formatYmd(j.applicationDeadline), lang);
  if (internal) pushRow(requirements, "genderReq", formatGender(j.genderRequirement, lang), lang);

  const site: Rows = [];
  pushRow(site, "workPlace", clean(j.workPlace) || clean(data.site.address), lang);
  pushRow(site, "access", data.site.accessNote, lang);

  const contacts: Rows = data.site.contacts.map((c) => [clean(c.roleTitle) || label("contactPerson", lang), clean(c.phone) ? `${c.name}（${clean(c.phone)}）` : c.name]);
  const notes: Rows = [];
  if (clean(j.note)) notes.push([label("note", lang), clean(j.note)]);

  const { sections, skipped } = assemble("jobOrder", mode, lang, {
    basic: kvOrNull(basic), conditions: kvOrNull(conditions), requirements: kvOrNull(requirements), site: kvOrNull(site),
    contacts: kvOrNull(contacts), internalNote: kvOrNull(notes),
  });

  return {
    kind: "jobOrder", mode, lang,
    title: j.title,
    subtitle: [data.companyName, data.site.name, data.fieldName].filter(Boolean).join(" / ") + (internal && opts.preparedBy ? `　（${label("createdBy", lang)}: ${opts.preparedBy}）` : ""),
    badge: `${label("docJobOrder", lang)}　・　${label(internal ? "modeInternal" : "modeShare", lang)}`,
    headerRight: `${label("docJobOrder", "ja")}　${label(internal ? "modeInternal" : "modeShare", "ja")}`,
    docTitle: label("docJobOrder", "ja"),
    sections, skipped,
    missing: missingFor("jobOrder", {
      description: !!clean(j.description), workHours: !!clean(j.workHours), daysOff: !!clean(j.daysOff), monthlySalary: j.monthlySalary !== null,
      housing: !!j.housing, commuteNote: !!clean(j.commuteNote), benefitsNote: !!clean(j.benefitsNote), targetStartDate: !!j.targetStartDate, applicationDeadline: !!j.applicationDeadline,
    }),
    excluded: internal ? [] : [...SHARE_EXCLUDES.jobOrder],
  };
}
