import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIONS, actorLabel, AUDIT_ACTION_NAMES, categoryOf, describeAudit, type AuditView } from "../../src/db/audit-describe";
import { AUDIT_VALUE_FIELDS, sanitizeAuditPayload } from "../../src/db/audit-values";
import { assessmentAuditEntry } from "../../src/db/audit-entries";
import { parseAuditFilters } from "../../src/db/audit-history";

const CJK = /[぀-ヿ㐀-鿿]/;
const view = (over: Partial<AuditView> = {}): AuditView => ({
  id: 1, createdAt: "2026-10-02T03:00:00Z", action: "candidate.change_stage", entity: "candidate", entityId: "abcdef12-0000-4000-8000-000000000000",
  candidateId: "abcdef12-0000-4000-8000-000000000000", before: { stage: "STUDYING" }, after: { stage: "READY" },
  actorName: "Admin Uji", actorRole: "LPK_ADMIN", actorOrgName: "LPK Uji", actorOrgId: "o1", organizationId: "o1", ...over,
});

test("setiap aksi punya kalimat Indonesia (tanpa huruf Jepang) dan Jepang (dengan huruf Jepang)", () => {
  assert.ok(AUDIT_ACTION_NAMES.length > 40);
  for (const action of AUDIT_ACTION_NAMES) {
    const e = view({ action, after: { stage: "READY", section: "basic", fields: ["heightCm"], role: "LPK_SENSEI", kind: "LPK_MONTHLY", period: "2026-09-01", rows: 12 }, before: { stage: "STUDYING" } });
    const id = describeAudit(e, "id");
    const ja = describeAudit(e, "ja");
    assert.ok(id.text.length > 5 && !CJK.test(id.text), `${action} (id): ${id.text}`);
    assert.ok(CJK.test(ja.text), `${action} (ja): ${ja.text}`);
    assert.equal(id.known, true);
    assert.ok(["auth", "user", "organization", "candidate", "document", "note", "assessment", "decision", "tsk", "system"].includes(categoryOf(action)));
  }
});

test("aksi tidak dikenal: tampil kodenya, tidak crash, kategori sistem", () => {
  const d = describeAudit(view({ action: "sesuatu.baru" }), "id");
  assert.equal(d.text, "sesuatu.baru");
  assert.equal(d.known, false);
  assert.equal(d.category, "system");
});

test("kalimat status memuat label dari-ke dan kode kandidat (bukan nama)", () => {
  const d = describeAudit(view(), "id");
  assert.match(d.text, /abcdef12/);
  assert.match(d.text, /Belajar → Siap seleksi/);
  assert.match(describeAudit(view(), "ja").text, /学習中 → 選考準備完了/);
});

test("label bagian/kolom dari pemanggil dipakai", () => {
  const d = describeAudit(view({ action: "candidate.update", after: { section: "basic", fields: ["heightCm", "birthPlace"] } }), "id", { section: () => "Data dasar", field: (_s, n) => ({ heightCm: "Tinggi", birthPlace: "Tempat lahir" })[n] });
  assert.match(d.text, /Data dasar \(Tinggi, Tempat lahir\)/);
});

test("pelaku: nama bila ada; lintas organisasi (tanpa nama) hanya nama organisasi", () => {
  assert.equal(actorLabel(view(), "id"), "Admin Uji (Admin LPK)");
  assert.equal(actorLabel(view({ actorName: null, actorRole: "TSK_ADMIN", actorOrgName: "TSK Uji" }), "id"), "TSK Uji (Admin TSK)");
  assert.equal(actorLabel(view({ actorName: null, actorRole: null, actorOrgName: null }), "id"), "Tidak diketahui");
});

test("sanitize: nilai di luar daftar dibuang; kunci struktural dan nilai pilihan dipertahankan", () => {
  assert.deepEqual(sanitizeAuditPayload("user", { name: "Budi", email: "b@x.id", role: "LPK_SENSEI", languages: ["id"], active: true }), { role: "LPK_SENSEI", languages: ["id"], active: true });
  assert.deepEqual(sanitizeAuditPayload("candidate", { fullName: "Siti", stage: "READY", code: "abcdef12", section: "basic", fields: ["a"] }), { stage: "READY", code: "abcdef12", section: "basic", fields: ["a"] });
  assert.equal(sanitizeAuditPayload("candidate_note", { body: "rahasia" }), undefined);
  assert.deepEqual(sanitizeAuditPayload("candidate_note", { body: "rahasia", visibility: "TSK_ONLY", bodyChanged: true }), { visibility: "TSK_ONLY", bodyChanged: true });
  assert.equal(sanitizeAuditPayload("entitas_baru", { x: 1 }), undefined); // entitas tanpa daftar: hanya struktural
  assert.equal(sanitizeAuditPayload("candidate", undefined), undefined);
  assert.equal(sanitizeAuditPayload("candidate", [1] as never), undefined);
});

test("AUDIT_VALUE_FIELDS tidak memuat kolom pribadi", () => {
  const banned = /name$|email|phone|address|note|body|passport|nationalId|password/i;
  for (const [entity, fields] of Object.entries(AUDIT_VALUE_FIELDS)) {
    for (const f of fields) {
      if (entity === "organization" && f === "name") continue; // nama ORGANISASI (bukan orang): satu-satunya pengecualian, disengaja
      assert.ok(!banned.test(f), `${entity}.${f}`);
    }
  }
});

test("parseAuditFilters: nilai asing diabaikan", () => {
  assert.deepEqual(parseAuditFilters({ category: "ngawur", from: "kemarin", to: "2026-10-01", candidate: "bukan-uuid", page: "-3" }), { category: "", from: "", to: "2026-10-01", candidateId: "", page: 1 });
  assert.equal(parseAuditFilters({ category: "candidate", page: "3" }).page, 3);
  assert.equal(parseAuditFilters({ candidate: "abcdef12-0000-4000-8000-000000000000" }).candidateId, "abcdef12-0000-4000-8000-000000000000");
});

test("ACTIONS konsisten dengan nama aksi", () => {
  assert.equal(Object.keys(ACTIONS).length, AUDIT_ACTION_NAMES.length);
});

test("user: role, active, dan languages tercatat sebagai nilai; nama dan email tidak", () => {
  assert.deepEqual(sanitizeAuditPayload("user", { name: "Budi", email: "b@x.id", role: "LPK_SENSEI", active: true, languages: ["id", "ja"], changed: ["name", "languages"] }), { role: "LPK_SENSEI", active: true, languages: ["id", "ja"], changed: ["name", "languages"] });
});

test("penilaian: skor 1-5 tercatat untuk LPK_MONTHLY saja; note/tindak lanjut tidak pernah", () => {
  const a = { id: "a1", candidateId: "c1", period: "2026-10-01" };
  const base = { action: "assessment.update" as const, lpkOrgId: "l", actorOrgId: "l", actorUserId: "u", changed: ["scoreJapanese", "note"] };
  const lpk = assessmentAuditEntry({ ...base, assessment: { ...a, kind: "LPK_MONTHLY" }, scores: { before: { scoreJapanese: 3 }, after: { scoreJapanese: 4, note: "rahasia" as never } } });
  const sa = sanitizeAuditPayload("candidate_assessment", lpk.after);
  assert.equal(sa?.scoreJapanese, 4);
  assert.equal(sanitizeAuditPayload("candidate_assessment", lpk.before, "LPK_MONTHLY")?.scoreJapanese, 3);
  assert.ok(!JSON.stringify(lpk).includes("rahasia"));
  // jenis TSK: skor TIDAK ikut (penilaian TSK_ONLY tidak boleh sampai ke LPK), lewat pembangun entri maupun lewat sanitize
  for (const kind of ["TSK_VISIT", "TSK_INTERVIEW"] as const) {
    const t = assessmentAuditEntry({ ...base, assessment: { ...a, kind }, scores: { after: { scoreJapanese: 5 } } });
    assert.ok(!("scoreJapanese" in (t.after ?? {})));
    assert.equal(sanitizeAuditPayload("candidate_assessment", { kind, scoreJapanese: 5, fields: ["scoreJapanese"] })?.scoreJapanese, undefined);
  }
});
