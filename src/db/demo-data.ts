// Generator data DEMO yang lengkap dan konsisten (dipakai scripts/seed.ts). Murni: hanya bergantung pada PRNG ber-seed tetap
// dan tanggal "hari ini" yang diberikan pemanggil, jadi reseed pada hari yang sama menghasilkan data identik.
// SEMUA nilai di sini fiktif: nomor identitas berawalan DUMMY, email berdomain .test, telepon berpola 0812-0000-xxxx.
import { addDays, addMonths, addYears, chance, clamp, int, makeRng, monthsBetween, pick, type Rng } from "./demo-rng";

export type Gender = "MALE" | "FEMALE";
export type Stage = "STUDYING" | "READY" | "WITHDRAWN";

export const FIELD_KEYS = ["food", "restaurant", "kaigo", "manufacture", "construction", "agri"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Kolom `candidates.field` per bidang; urutan sama dengan FIELD_KEYS. */
export const FIELDS = [
  "Pengolahan makanan & minuman",
  "Jasa makanan (restoran)",
  "Perawatan lansia (kaigo)",
  "Manufaktur industri",
  "Konstruksi",
  "Pertanian",
] as const;

const CITIES: Record<number, { cities: string[]; province: string; streets: string[] }> = {
  0: { cities: ["Bandung", "Cimahi", "Garut", "Tasikmalaya", "Sumedang", "Cianjur"], province: "Jawa Barat", streets: ["Jl. Cihampelas", "Jl. Setiabudi", "Jl. Soekarno-Hatta", "Jl. Dipatiukur", "Jl. Cibaduyut", "Jl. Kiaracondong"] },
  1: { cities: ["Surabaya", "Sidoarjo", "Malang", "Kediri", "Jember", "Gresik"], province: "Jawa Timur", streets: ["Jl. Darmo", "Jl. Ahmad Yani", "Jl. Kenjeran", "Jl. Raya Waru", "Jl. Pahlawan", "Jl. Gubeng"] },
  2: { cities: ["Medan", "Binjai", "Pematangsiantar", "Tebing Tinggi", "Lubuk Pakam", "Kisaran"], province: "Sumatera Utara", streets: ["Jl. Gatot Subroto", "Jl. Sisingamangaraja", "Jl. Williem Iskandar", "Jl. Setia Budi", "Jl. Marelan", "Jl. Pancing"] },
};

// Plan JLPT + lama belajar di LPK per indeks pipeline (0..11), selaras dengan status: Belajar = N5/N4, Siap seleksi = N4/N3/N2.
// Tanggal ujian tetap (Juli & Desember); lama belajar dijaga cukup panjang untuk mencapai level itu.
type JlptPlan = { levels: Array<{ level: "N5" | "N4" | "N3" | "N2"; date: string }>; studyMonths: number };
const JLPT_PLANS: JlptPlan[] = [
  { levels: [{ level: "N5", date: "2026-07-05" }], studyMonths: 8 }, // 0 Belajar
  { levels: [{ level: "N5", date: "2026-07-05" }], studyMonths: 9 }, // 1
  { levels: [{ level: "N5", date: "2026-07-05" }], studyMonths: 10 }, // 2
  { levels: [{ level: "N4", date: "2026-07-05" }], studyMonths: 12 }, // 3
  { levels: [{ level: "N4", date: "2026-07-05" }], studyMonths: 13 }, // 4 Siap seleksi
  { levels: [{ level: "N5", date: "2025-07-06" }, { level: "N4", date: "2026-07-05" }], studyMonths: 19 }, // 5 (naik level)
  { levels: [{ level: "N4", date: "2026-07-05" }], studyMonths: 14 }, // 6
  { levels: [{ level: "N4", date: "2025-12-07" }, { level: "N3", date: "2026-07-05" }], studyMonths: 18 }, // 7 (naik level)
  { levels: [{ level: "N3", date: "2026-07-05" }], studyMonths: 16 }, // 8
  { levels: [{ level: "N3", date: "2025-07-06" }, { level: "N2", date: "2026-07-05" }], studyMonths: 21 }, // 9 (naik level)
  { levels: [{ level: "N3", date: "2025-07-06" }, { level: "N2", date: "2026-07-05" }], studyMonths: 22 }, // 10 (naik level)
  { levels: [{ level: "N5", date: "2026-07-05" }], studyMonths: 11 }, // 11 Mundur
];
const JLPT_SCORE: Record<string, [number, number]> = { N5: [95, 150], N4: [100, 150], N3: [100, 140], N2: [95, 125] };

const FATHER_JOBS = ["Petani", "Buruh pabrik", "Pedagang", "Sopir angkutan", "Wiraswasta", "Pegawai desa", "Tukang bangunan", "Nelayan"];
const MOTHER_JOBS = ["Ibu rumah tangga", "Pedagang warung", "Penjahit", "Buruh pabrik", "Guru honorer", "Petani"];
const SIBLING_JOBS = ["Pelajar", "Mahasiswa", "Karyawan swasta", "Wiraswasta", "Belum bekerja"];
const FAMILY_FIRST_M = ["Slamet", "Hasan", "Darmawan", "Sukirno", "Yanto", "Rahmat", "Dedi", "Bambang", "Suryadi", "Ahmad"];
const FAMILY_FIRST_F = ["Siti", "Ratna", "Yuni", "Aminah", "Wati", "Nurhayati", "Lina", "Rohana", "Fitri", "Endang"];

const SCHOOLS: Record<FieldKey, { major: string; smk: string }> = {
  food: { major: "Tata Boga", smk: "SMK" },
  restaurant: { major: "Perhotelan / Tata Boga", smk: "SMK" },
  kaigo: { major: "Keperawatan", smk: "SMK" },
  manufacture: { major: "Teknik Pemesinan", smk: "SMK" },
  construction: { major: "Teknik Konstruksi Bangunan", smk: "SMK" },
  agri: { major: "Agribisnis Tanaman Pangan", smk: "SMK" },
};

const COMPANIES: Record<FieldKey, Array<[string, string]>> = {
  food: [["CV Dapur Nusantara (dummy)", "Operator produksi"], ["PT Roti Sejahtera (dummy)", "Helper produksi"], ["UD Kerupuk Sari (dummy)", "Pekerja pengemasan"]],
  restaurant: [["Rumah Makan Sederhana Jaya (dummy)", "Pelayan"], ["Kafe Senja (dummy)", "Barista"], ["Hotel Melati Indah (dummy)", "Asisten dapur"]],
  kaigo: [["Panti Werdha Kasih (dummy)", "Pendamping lansia"], ["Klinik Sehat Sentosa (dummy)", "Asisten perawat"], ["Posyandu Lansia Mawar (dummy)", "Relawan"]],
  manufacture: [["PT Logam Karya (dummy)", "Operator mesin"], ["PT Elektro Prima (dummy)", "Operator produksi"], ["CV Bengkel Maju (dummy)", "Mekanik"]],
  construction: [["PT Bangun Raya (dummy)", "Tukang bangunan"], ["CV Cipta Griya (dummy)", "Pekerja konstruksi"], ["UD Besi Beton (dummy)", "Pembantu tukang"]],
  agri: [["Kelompok Tani Subur (dummy)", "Buruh tani"], ["PT Agro Lestari (dummy)", "Operator kebun"], ["Koperasi Tani Makmur (dummy)", "Petugas panen"]],
};

const MOTIVATION: Record<FieldKey, string[]> = {
  food: ["Saya ingin belajar teknik pengolahan makanan Jepang yang higienis dan membawa ilmunya pulang untuk membuka usaha keluarga.", "Saya tertarik dengan standar kebersihan dan kualitas produksi makanan di Jepang dan ingin bekerja dengan disiplin."],
  restaurant: ["Saya ingin mengasah keterampilan melayani tamu dengan keramahan khas Jepang (omotenashi) dan menabung untuk modal usaha.", "Sejak SMK saya suka dunia kuliner. Saya ingin pengalaman kerja di restoran Jepang yang rapi dan profesional."],
  kaigo: ["Saya ingin merawat lansia dengan penuh hormat. Jepang adalah negara dengan keahlian kaigo terbaik dan saya ingin belajar langsung.", "Pengalaman merawat kakek di rumah membuat saya ingin menjadi tenaga perawat lansia yang terlatih."],
  manufacture: ["Saya ingin menguasai teknologi manufaktur Jepang yang presisi dan menerapkannya sepulang dari sana.", "Saya suka bekerja dengan mesin dan tertarik pada budaya kerja tertib dan tepat waktu di pabrik Jepang."],
  construction: ["Saya ingin belajar teknik konstruksi yang aman dan rapi dari Jepang untuk meningkatkan keahlian dan penghasilan keluarga.", "Pengalaman sebagai pembantu tukang membuat saya ingin menjadi tukang bersertifikat dengan standar keselamatan tinggi."],
  agri: ["Saya ingin belajar pertanian modern dan efisien di Jepang lalu mengembangkan lahan keluarga di kampung.", "Keluarga saya petani. Saya ingin membawa teknik budidaya Jepang yang rapi untuk meningkatkan hasil panen desa."],
};
const SELF_PR = [
  "Saya pekerja keras, disiplin, dan cepat belajar. Di LPK saya jarang absen dan aktif membantu teman belajar bahasa Jepang.",
  "Saya orang yang tenang dan teliti. Saya terbiasa bangun pagi dan menyelesaikan tugas sebelum tenggat.",
  "Saya mudah bekerja dalam tim dan tidak mudah menyerah. Saya siap beradaptasi dengan lingkungan baru.",
  "Saya jujur dan bertanggung jawab. Selama bekerja sebelumnya, saya dipercaya memegang kunci tempat kerja.",
  "Saya punya fisik kuat dan terbiasa kerja berdiri lama. Saya rutin berolahraga dan menjaga kesehatan.",
];
const HOBBIES = ["Sepak bola", "Membaca komik dan novel", "Memasak", "Bulu tangkis", "Menonton anime", "Bersepeda", "Berkebun", "Futsal", "Menggambar", "Mendengarkan musik"];
const SPECIAL_SKILLS: Record<FieldKey, string[]> = {
  food: ["Membuat roti dan kue", "Mengolah ikan dan daging", "Memotong sayur dengan cepat dan rapi"],
  restaurant: ["Meracik kopi", "Menghafal menu dan melayani tamu", "Memasak masakan Nusantara"],
  kaigo: ["Pijat dan terapi ringan", "Pertolongan pertama (P3K)", "Komunikasi sabar dengan lansia"],
  manufacture: ["Mengoperasikan mesin bubut", "Membaca gambar teknik", "Perawatan mesin dasar"],
  construction: ["Memasang bata dan plester", "Merakit bekisting", "Mengoperasikan alat bantu bangun"],
  agri: ["Budidaya sayuran", "Mengoperasikan traktor tangan", "Pengolahan pupuk kompos"],
};

const NOTE_BY_ASPECT = {
  good: ["Perkembangan sangat baik bulan ini.", "Aktif bertanya di kelas dan tugas selesai tepat waktu.", "Hasil tryout meningkat dibanding bulan lalu.", "Sikap belajar konsisten dan menjadi contoh teman sekelas."],
  mid: ["Perkembangan cukup stabil, perlu menambah latihan mandiri.", "Kosakata bertambah, pelafalan masih perlu dilatih.", "Kehadiran baik namun fokus kadang menurun di sore hari.", "Cukup baik; perlu lebih berani berbicara dalam percakapan."],
  low: ["Beberapa kali terlambat dan tugas tertunda; sudah diingatkan.", "Nilai tryout menurun; perlu bimbingan tambahan.", "Motivasi sedang turun karena urusan keluarga; dipantau.", "Perlu perbaikan kehadiran dan disiplin mengumpulkan tugas."],
};
const FOLLOW_UP = ["Tambah sesi latihan percakapan 2x per minggu.", "Ulang materi kanji bab 5-6 dan tes kecil minggu depan.", "Jadwalkan konseling singkat dengan sensei.", "Siapkan simulasi wawancara TSK bulan depan.", "Pantau kehadiran; hubungi keluarga bila absen lagi.", "Latihan soal choukai (mendengar) setiap hari 20 menit."];

export type DemoCandidateInput = {
  orgIndex: number; // 0 Bandung, 1 Surabaya, 2 Medan
  i: number; // indeks pipeline 0..11
  stage: Stage;
  gender: Gender;
  fullName: string;
  firstName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  fieldIndex: number; // indeks FIELDS
  today: string; // YYYY-MM-DD
};

export type DemoProfile = {
  candidatePatch: {
    birthPlace: string;
    maritalStatus: "SINGLE" | "MARRIED" | "DIVORCED";
    heightCm: number;
    weightKg: number;
    dominantHand: "RIGHT" | "LEFT" | "BOTH";
    everInJapan: boolean;
    visaRejectedBefore: boolean;
    japanHistoryNote: string | null;
    motivation: string;
    selfPr: string;
    hobby: string;
    specialSkill: string;
  };
  private: {
    nationalId: string;
    familyCardNumber: string;
    passportNumber: string;
    passportIssuedDate: string;
    passportExpiryDate: string;
    address: string;
    phone: string;
    whatsapp: string;
    email: string;
    visionNote: string;
    colorBlind: boolean;
    medicalNote: string;
  };
  family: Array<{ relation: "FATHER" | "MOTHER" | "SPOUSE" | "CHILD" | "SIBLING" | "RELATIVE_IN_JAPAN"; name: string; occupation: string; phone: string; address: string; livesInJapan: boolean; isEmergencyContact: boolean }>;
  educations: Array<{ schoolName: string; major: string; startYear: number; endYear: number }>;
  works: Array<{ companyName: string; position: string; startDate: string; endDate: string }>;
  certificates: Array<{ type: "JLPT" | "JFT_BASIC" | "SKILL_TEST"; levelOrField: string; score: number; certificateNumber: string; issuedDate: string }>;
  studyMonths: number;
  /** Tanggal masuk LPK (YYYY-MM-DD). */
  lpkEntry: string;
  /** Tingkat JLPT tertinggi (angka N), untuk menurunkan nilai penilaian. */
  bestJlpt: number;
  diplomaDate: string;
  mcuDate: string;
};

const phone = (rng: Rng) => `0812-0000-${String(int(rng, 0, 9999)).padStart(4, "0")}`;
const digits = (rng: Rng, n: number) => Array.from({ length: n }, () => int(rng, 0, 9)).join("");

/** Kategori kedaluwarsa paspor per (orgIndex, i): 2 sudah lewat, 4 kurang dari 6 bulan, sisanya > 2 tahun. */
function passportCategory(orgIndex: number, i: number): "expired" | "soon" | "ok" {
  const key = `${orgIndex}.${i}`;
  if (["0.0", "1.5"].includes(key)) return "expired";
  if (["0.4", "0.9", "1.7", "2.5"].includes(key)) return "soon";
  return "ok";
}
// Dua kandidat pernah ditolak visa (di LPK mana pun).
const VISA_REJECTED = new Set(["0.8", "1.6"]);

export function buildProfile(c: DemoCandidateInput): DemoProfile {
  const rng = makeRng(`profil:${c.orgIndex}:${c.i}`);
  const fieldKey = FIELD_KEYS[c.fieldIndex % FIELD_KEYS.length];
  const geo = CITIES[c.orgIndex];
  const city = geo.cities[(c.i + c.orgIndex) % geo.cities.length];
  const birthYear = Number(c.birthDate.slice(0, 4));
  const age = Number(c.today.slice(0, 4)) - birthYear;
  const plan = JLPT_PLANS[c.i];
  const lpkEntry = addMonths(c.today, -plan.studyMonths);

  // Status pernikahan: yang berusia >= 25 sebagian menikah; keluarga mengikuti
  const married = age >= 25 && chance(rng, 0.45);
  const divorced = !married && age >= 27 && chance(rng, 0.2);
  const maritalStatus = married ? "MARRIED" : divorced ? "DIVORCED" : "SINGLE";

  // Fisik wajar menurut jenis kelamin; berat dari BMI 19-25
  const heightCm = c.gender === "MALE" ? int(rng, 158, 178) : int(rng, 148, 166);
  const weightKg = Math.round(((heightCm / 100) ** 2) * (19 + rng() * 6));
  const dominantHand = chance(rng, 0.9) ? "RIGHT" : chance(rng, 0.8) ? "LEFT" : "BOTH";

  // ---- Pendidikan: SMP, SMA/SMK, dan sebagian D3 (usia cukup)
  const school = SCHOOLS[fieldKey];
  const educations: DemoProfile["educations"] = [
    { schoolName: `SMP Negeri ${int(rng, 1, 25)} ${city}`, major: "Umum", startYear: birthYear + 12, endYear: birthYear + 15 },
    { schoolName: `${school.smk} ${pick(rng, ["Negeri", "Muhammadiyah", "Telkom", "Bakti"])} ${int(rng, 1, 12)} ${city}`, major: school.major, startYear: birthYear + 15, endYear: birthYear + 18 },
  ];
  let schoolEnd = birthYear + 18;
  if (birthYear <= 2002 && chance(rng, 0.45)) {
    educations.push({ schoolName: `Politeknik ${pick(rng, ["Negeri", "Mandiri", "Nusantara"])} ${city}`, major: `D3 ${school.major}`, startYear: birthYear + 18, endYear: birthYear + 21 });
    schoolEnd = birthYear + 21;
  }
  const diplomaDate = `${educations[educations.length - 1].endYear}-07-15`;

  // ---- Jepang: hanya yang cukup tua dan punya jendela waktu; ditentukan deterministik dari indeks
  let everInJapan = false;
  let japanStay: { start: string; end: string } | null = null;
  const workWindowStart = `${schoolEnd}-08-01`;
  const workWindowEnd = addMonths(lpkEntry, -1);
  if (birthYear <= 2003 && (c.i + c.orgIndex) % 3 === 0 && c.i !== 0) {
    const months = pick(rng, [12, 24, 36]);
    const start = addMonths(workWindowStart, int(rng, 3, 6));
    const end = addMonths(start, months);
    if (end <= addMonths(workWindowEnd, -4)) {
      everInJapan = true;
      japanStay = { start, end };
    }
  }
  const visaRejected = VISA_REJECTED.has(`${c.orgIndex}.${c.i}`);
  const prefecture = pick(rng, ["Aichi", "Saitama", "Hiroshima", "Kumamoto", "Shizuoka", "Hokkaido"]);
  const japanHistoryNote = japanStay
    ? `Magang teknis (ginou jisshu) di Prefektur ${prefecture}, ${japanStay.start.slice(0, 4)}-${japanStay.end.slice(0, 4)}; selesai kontrak dan pulang sesuai jadwal.`
    : visaRejected
      ? `Pengajuan visa kerja tahun ${Number(c.today.slice(0, 4)) - 2} ditolak karena dokumen keuangan sponsor belum lengkap; kini mengajukan ulang lewat jalur SSW.`
      : null;

  // ---- Riwayat kerja: 1-3 baris berurutan di antara selesai sekolah dan masuk LPK (+ masa di Jepang bila ada)
  const works: DemoProfile["works"] = [];
  const companies = COMPANIES[fieldKey];
  if (japanStay) {
    works.push({ companyName: `Perusahaan penerima magang, Prefektur ${prefecture} (dummy)`, position: "Peserta magang teknis", startDate: japanStay.start, endDate: japanStay.end });
    const after = addMonths(japanStay.end, 1);
    if (monthsBetween(after, workWindowEnd) >= 4) {
      const [name, position] = companies[0];
      works.push({ companyName: name, position, startDate: after, endDate: workWindowEnd });
    }
    const before = workWindowStart;
    const beforeEnd = addMonths(japanStay.start, -1);
    if (monthsBetween(before, beforeEnd) >= 4) {
      const [name, position] = companies[1];
      works.unshift({ companyName: name, position, startDate: before, endDate: beforeEnd });
    }
  } else {
    const total = Math.max(0, monthsBetween(workWindowStart, workWindowEnd));
    const jobs = total < 8 ? 1 : clamp(Math.floor(total / 9), 1, 3);
    const want = Math.min(jobs, int(rng, 1, 3));
    let cursor = workWindowStart;
    const chunk = Math.max(3, Math.floor(total / want) - 1);
    for (let k = 0; k < want; k++) {
      const [name, position] = companies[(k + c.i) % companies.length];
      const end = k === want - 1 ? workWindowEnd : addMonths(cursor, chunk);
      if (end <= cursor) break;
      works.push({ companyName: name, position, startDate: cursor, endDate: end });
      cursor = addMonths(end, 1);
    }
  }
  if (works.length === 0) {
    // Jendela terlalu sempit (lulus sekolah baru masuk LPK): satu pekerjaan paruh waktu singkat
    const [name, position] = companies[0];
    works.push({ companyName: name, position: `${position} (paruh waktu)`, startDate: addMonths(lpkEntry, -4), endDate: addMonths(lpkEntry, -1) });
  }

  // ---- Keluarga: 3-5 anggota, satu kontak darurat, sebagian tinggal di Jepang
  const familyName = c.lastName;
  const family: DemoProfile["family"] = [];
  const addr = `${pick(rng, geo.streets)} No. ${int(rng, 1, 120)}, ${city}`;
  const person = (relation: DemoProfile["family"][number]["relation"], name: string, occupation: string, extra: Partial<DemoProfile["family"][number]> = {}) =>
    family.push({ relation, name, occupation, phone: phone(rng), address: addr, livesInJapan: false, isEmergencyContact: false, ...extra });
  person("FATHER", `${pick(rng, FAMILY_FIRST_M)} ${familyName}`, pick(rng, FATHER_JOBS));
  person("MOTHER", `${pick(rng, FAMILY_FIRST_F)} ${familyName}`, pick(rng, MOTHER_JOBS), { isEmergencyContact: !married });
  if (married) {
    const spouseName = c.gender === "MALE" ? pick(rng, FAMILY_FIRST_F) : pick(rng, FAMILY_FIRST_M);
    person("SPOUSE", `${spouseName} ${pick(rng, ["Lestari", "Pratiwi", "Wibowo", "Kurniawan"])}`, pick(rng, ["Ibu rumah tangga", "Wiraswasta", "Karyawan swasta"]), { isEmergencyContact: true });
    if (chance(rng, 0.6)) person("CHILD", `${pick(rng, FAMILY_FIRST_M.concat(FAMILY_FIRST_F))} ${familyName}`, "Belum sekolah");
  }
  const siblings = int(rng, 1, married ? 1 : 2);
  for (let s = 0; s < siblings; s++) {
    const female = chance(rng, 0.5);
    person("SIBLING", `${pick(rng, female ? FAMILY_FIRST_F : FAMILY_FIRST_M)} ${familyName}`, pick(rng, SIBLING_JOBS));
  }
  if ((c.i * 5 + c.orgIndex) % 4 === 1 && family.length < 5) {
    person("RELATIVE_IN_JAPAN", `${pick(rng, FAMILY_FIRST_M)} ${familyName}`, "Karyawan pabrik di Jepang", { livesInJapan: true, address: `Prefektur ${pick(rng, ["Aichi", "Gunma", "Ibaraki"])}, Jepang` });
  }

  // ---- Kontak
  const slug = `${c.firstName}.${c.lastName}`.toLowerCase().replace(/[^a-z.]/g, "");
  const kontak = { phone: phone(rng), whatsapp: phone(rng), email: `${slug}.${c.orgIndex}${String(c.i).padStart(2, "0")}@contoh.test` };

  // ---- Paspor
  const cat = passportCategory(c.orgIndex, c.i);
  const passportExpiryDate = cat === "expired" ? addDays(c.today, -int(rng, 20, 90)) : cat === "soon" ? addDays(c.today, int(rng, 25, 160)) : addDays(c.today, int(rng, 800, 3200));
  const validity = cat === "ok" && birthYear + 17 <= Number(addYears(passportExpiryDate, -10).slice(0, 4)) ? 10 : 5;
  const passportIssuedDate = addYears(passportExpiryDate, -validity);
  if (passportIssuedDate >= c.today || Number(passportIssuedDate.slice(0, 4)) < birthYear + 17) throw new Error(`paspor tidak masuk akal untuk ${c.orgIndex}.${c.i}`);

  // ---- Kesehatan
  const glasses = chance(rng, 0.3);
  const mcuDate = addDays(c.today, -int(rng, 20, 110));
  const visionNote = glasses ? `Minus ${pick(rng, ["0,75", "1,25", "1,5", "2,0"])} kedua mata (berkacamata), koreksi mencapai 1.0` : "Normal, tanpa kacamata";
  const medicalNote = `Medical check-up ${mcuDate.slice(0, 7)} (dummy): kondisi sehat, tekanan darah normal, rontgen dada bersih, tidak ada riwayat penyakit serius.`;

  // ---- Sertifikat
  const certificates: DemoProfile["certificates"] = [];
  plan.levels.forEach((l, k) => {
    const [lo, hi] = JLPT_SCORE[l.level];
    certificates.push({ type: "JLPT", levelOrField: l.level, score: int(rng, lo, hi), certificateNumber: `DUMMY-JLPT-${c.orgIndex}${String(c.i).padStart(2, "0")}${k}`, issuedDate: l.date });
  });
  if ((c.i + c.orgIndex) % 4 !== 0) {
    certificates.push({ type: "JFT_BASIC", levelOrField: "A2", score: int(rng, 195, 245), certificateNumber: `DUMMY-JFT-${c.orgIndex}${String(c.i).padStart(2, "0")}`, issuedDate: pick(rng, ["2026-03-14", "2026-05-23", "2026-06-20"]) });
  }
  if (c.stage === "READY") {
    certificates.push({ type: "SKILL_TEST", levelOrField: `SSW - ${FIELDS[c.fieldIndex % FIELDS.length]}`, score: int(rng, 62, 94), certificateNumber: `DUMMY-SSW-${c.orgIndex}${String(c.i).padStart(2, "0")}`, issuedDate: pick(rng, ["2026-04-18", "2026-06-06", "2026-08-15"]) });
  }
  // Level terbaik = angka N terkecil
  const bestJlpt = Math.min(...plan.levels.map((l) => Number(l.level.slice(1))));

  return {
    candidatePatch: {
      birthPlace: city,
      maritalStatus,
      heightCm,
      weightKg,
      dominantHand,
      everInJapan,
      visaRejectedBefore: visaRejected,
      japanHistoryNote,
      motivation: pick(rng, MOTIVATION[fieldKey]),
      selfPr: pick(rng, SELF_PR),
      hobby: pick(rng, HOBBIES),
      specialSkill: pick(rng, SPECIAL_SKILLS[fieldKey]),
    },
    private: {
      nationalId: `DUMMY-NIK-${digits(rng, 10)}`,
      familyCardNumber: `DUMMY-KK-${digits(rng, 10)}`,
      passportNumber: `DUMMY-P${digits(rng, 7)}`,
      passportIssuedDate,
      passportExpiryDate,
      address: `${addr}, ${geo.province}`,
      ...kontak,
      visionNote,
      colorBlind: c.orgIndex === 1 && c.i === 3, // satu kasus buta warna ringan, untuk contoh tampilan
      medicalNote,
    },
    family,
    educations,
    works,
    certificates,
    studyMonths: plan.studyMonths,
    lpkEntry,
    bestJlpt,
    diplomaDate,
    mcuDate,
  };
}

// ---------------------------------------------------------------------------------------------
// Penilaian bulanan LPK

export type DemoAssessment = {
  assessedOn: string;
  durationMinutes: number;
  scoreJapanese: number;
  scoreAttitude: number;
  scoreFitness: number;
  scoreMotivation: number;
  attendancePct: number;
  testName: string | null;
  testScore: number | null;
  note: string;
  followUp: string | null;
  /** Indeks penilai (untuk memilih dari staf LPK). */
  assessorSlot: number;
};

/** Belum dinilai bulan ini? Sekitar 40% kandidat berstatus Belajar / Siap seleksi (pola deterministik). */
export const pendingThisMonth = (orgIndex: number, i: number, stage: Stage) => stage !== "WITHDRAWN" && (i * 7 + orgIndex * 3) % 5 < 2;

/** Kandidat dengan kehadiran dan nilai tinggi (untuk filter "kehadiran >= 90" dan "nilai >= 4"). */
const HIGH_PERFORMERS = new Set([5, 8, 9, 10]);

export function buildAssessments(c: { orgIndex: number; i: number; stage: Stage; bestJlpt: number; today: string; currentPeriod: string; periodOf: (monthsAgo: number) => string }): DemoAssessment[] {
  const rng = makeRng(`nilai:${c.orgIndex}:${c.i}`);
  const history = 3 + ((c.i + c.orgIndex) % 4); // 3..6 penilaian berturut-turut
  const high = HIGH_PERFORMERS.has(c.i);
  // Mundur: penilaian berhenti 2+ bulan lalu; yang lain: sampai bulan ini, atau bulan lalu bila belum dinilai bulan ini
  const lastMonthsAgo = c.stage === "WITHDRAWN" ? 2 + (c.orgIndex % 2) : pendingThisMonth(c.orgIndex, c.i, c.stage) ? 1 : 0;
  const jpBase = clamp(6 - c.bestJlpt - 0.4 + (rng() - 0.5), 2, 4.6); // N5 ~2.5, N4 ~3.3, N3 ~4, N2 ~4.5 (menyusut ke batas 5)
  const attBase = high ? 91 + rng() * 6 : c.stage === "READY" ? 82 + rng() * 9 : 66 + rng() * 22;
  const attitudeBase = high ? 4.2 : 2.8 + rng() * 1.4;
  const fitnessBase = 3 + rng() * 1.4;
  const motivationBase = high ? 4.3 : 3 + rng() * 1.3;
  const out: DemoAssessment[] = [];
  for (let j = 0; j < history; j++) {
    const monthsAgo = lastMonthsAgo + (history - 1 - j);
    const period = c.periodOf(monthsAgo);
    const trend = (j - (history - 1) / 2) * 0.25; // naik pelan
    const noise = () => (rng() - 0.5) * 0.9;
    const score = (base: number) => clamp(Math.round(base + trend + noise()), 2, 5);
    const sJ = score(jpBase);
    const sA = score(attitudeBase);
    const sF = score(fitnessBase);
    const sM = score(motivationBase);
    const avg = (sJ + sA + sF + sM) / 4;
    const attendance = clamp(Math.round(attBase + trend * 3 + (rng() - 0.5) * 8), 65, 100);
    let day = int(rng, 5, 25);
    let assessedOn = `${period.slice(0, 7)}-${String(day).padStart(2, "0")}`;
    if (assessedOn > c.today) assessedOn = c.today; // bulan berjalan: jangan di masa depan
    day = Number(assessedOn.slice(8, 10));
    const withTest = rng() < 0.4;
    out.push({
      assessedOn,
      durationMinutes: rng() < 0.75 ? 30 : pick(rng, [20, 45, 60]),
      scoreJapanese: sJ,
      scoreAttitude: sA,
      scoreFitness: sF,
      scoreMotivation: sM,
      attendancePct: attendance,
      testName: withTest ? `Tryout JLPT N${c.bestJlpt}` : null,
      testScore: withTest ? clamp(Math.round(60 + avg * 18 + (rng() - 0.5) * 14), 55, 175) : null,
      note: pick(rng, avg >= 3.9 ? NOTE_BY_ASPECT.good : avg >= 3 ? NOTE_BY_ASPECT.mid : NOTE_BY_ASPECT.low),
      followUp: rng() < 0.55 ? pick(rng, FOLLOW_UP) : null,
      assessorSlot: (c.i + j) % 2,
    });
  }
  return out;
}
