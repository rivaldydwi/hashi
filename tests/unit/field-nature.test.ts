import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldNature, LIST_SECTIONS, SINGLE_SECTIONS, type FieldDef } from "../../src/db/candidate-sections";

// Sifat data kolom (T-023): identitas dikunci translate="no", teks bebas boleh diterjemahkan peramban.
const all: Array<{ section: string; f: FieldDef }> = [...SINGLE_SECTIONS, ...LIST_SECTIONS].flatMap((s) => s.fields.map((f) => ({ section: s.key, f })));

test("setiap kolom text/textarea/email punya sifat data eksplisit (identity | prose)", () => {
  for (const { section, f } of all) {
    if (f.kind === "text" || f.kind === "textarea" || f.kind === "email") {
      assert.ok(f.data === "identity" || f.data === "prose", `${section}.${f.name} belum diberi sifat data`);
    }
  }
});

test("identitas: nama, katakana, tempat/organisasi, alamat, telepon, email, nomor dokumen", () => {
  const identity = [
    "basic.fullName", "basic.nameKatakana", "basic.birthPlace", "contact.address", "contact.phone", "contact.whatsapp", "contact.email",
    "identity.nationalId", "identity.familyCardNumber", "identity.passportNumber", "family.name", "family.phone", "family.address",
    "education.schoolName", "work.companyName", "certificates.certificateNumber",
  ];
  for (const key of identity) {
    const [s, n] = key.split(".");
    const f = all.find((x) => x.section === s && x.f.name === n)?.f;
    assert.ok(f, key);
    assert.equal(fieldNature(f), "identity", key);
  }
});

test("teks bebas: motivasi, PR diri, hobi, keahlian, catatan riwayat Jepang, catatan penglihatan, jabatan, jurusan, pekerjaan keluarga", () => {
  const prose = ["about.motivation", "about.selfPr", "about.hobby", "about.specialSkill", "japan.japanHistoryNote", "health.visionNote", "work.position", "education.major", "family.occupation", "certificates.levelOrField"];
  for (const key of prose) {
    const [s, n] = key.split(".");
    const f = all.find((x) => x.section === s && x.f.name === n)?.f;
    assert.ok(f, key);
    assert.equal(fieldNature(f), "prose", key);
  }
});

test("catatan medis dikunci (identity) walau teks bebas: data kesehatan sensitif tidak dikirim ke layanan terjemahan; catatan penglihatan tetap prose", () => {
  const f = (n: string) => all.find((x) => x.section === "health" && x.f.name === n)!.f;
  assert.equal(fieldNature(f("medicalNote")), "identity");
  assert.equal(fieldNature(f("visionNote")), "prose");
});

test("jenis non-teks: pilihan/boolean/bidang kerja = label (prose); tanggal dan angka = identity", () => {
  for (const { section, f } of all) {
    if (f.kind === "select" || f.kind === "boolean" || f.kind === "skillField") assert.equal(fieldNature(f), "prose", `${section}.${f.name}`);
    if (f.kind === "date" || f.kind === "int") assert.equal(fieldNature(f), "identity", `${section}.${f.name}`);
  }
});
