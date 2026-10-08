// Kalimat riwayat aktivitas dari satu entri audit, dalam bahasa tampilan. Murni (tanpa DB/React), jadi bisa dites dan dipakai di halaman, tab kandidat,
// widget, dan ekspor CSV. SATU tabel `ACTIONS` = daftar semua aksi yang dikenal; aksi baru wajib ditambahkan di sini (dites: setiap aksi punya teks id DAN ja).
// Nama kandidat TIDAK ada di entri (tidak disimpan): kalimat memakai kode kandidat (8 karakter pertama id), kecuali pemanggil menyediakan nama dari tabel kandidat yang hidup.

export type AuditLocale = "id" | "ja";

export type AuditView = {
  id: number;
  createdAt: Date | string;
  action: string;
  entity: string;
  entityId: string | null;
  candidateId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actorName: string | null;
  actorRole: string | null;
  actorOrgName: string | null;
  actorOrgId: string | null;
  organizationId: string | null;
};

export type AuditLabels = {
  /** Label bagian (mis. "basic" -> "Data dasar"). */
  section?: (key: string) => string | undefined;
  /** Label kolom (bagian, nama kolom). */
  field?: (section: string, name: string) => string | undefined;
};

export const AUDIT_CATEGORIES = ["auth", "user", "organization", "candidate", "document", "note", "assessment", "decision", "tsk", "records", "system"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

type Vars = { who: string; code: string; from: string; to: string; fields: string; section: string; role: string; value: string };
type Def = { category: AuditCategory; id: (v: Vars) => string; ja: (v: Vars) => string };

const d = (category: AuditCategory, id: (v: Vars) => string, ja: (v: Vars) => string): Def => ({ category, id, ja });

/** Semua aksi yang dikenal beserta kalimatnya. */
export const ACTIONS: Record<string, Def> = {
  "auth.login": d("auth", () => "Masuk ke Hashi", () => "Hashiにログインしました"),
  "user.create": d("user", (v) => `Menambah pengguna (peran ${v.role})`, (v) => `ユーザーを追加しました（役割：${v.role}）`),
  "user.update": d("user", (v) => `Mengubah data pengguna${v.fields ? ` (${v.fields})` : ""}`, (v) => `ユーザー情報を変更しました${v.fields ? `（${v.fields}）` : ""}`),
  "user.password_reset": d("user", () => "Mereset kata sandi pengguna", () => "ユーザーのパスワードをリセットしました"),
  "user.password_change": d("user", () => "Mengganti kata sandi sendiri", () => "自分のパスワードを変更しました"),
  "user.deactivate": d("user", () => "Menonaktifkan pengguna", () => "ユーザーを無効にしました"),
  "user.reactivate": d("user", () => "Mengaktifkan kembali pengguna", () => "ユーザーを再び有効にしました"),
  "organization.create": d("organization", () => "Membuat organisasi", () => "組織を作成しました"),
  "organization.update": d("organization", () => "Mengubah data organisasi", () => "組織情報を変更しました"),
  "partnership.create": d("organization", () => "Membuat kemitraan", () => "提携を作成しました"),
  "partnership.activate": d("organization", () => "Mengaktifkan kemitraan", () => "提携を有効にしました"),
  "partnership.deactivate": d("organization", () => "Menonaktifkan kemitraan", () => "提携を無効にしました"),
  "skill_field.create": d("system", () => "Menambah bidang kerja", () => "職種分野を追加しました"),
  "skill_field.update": d("system", () => "Mengubah bidang kerja", () => "職種分野を変更しました"),
  "skill_field.activate": d("system", () => "Mengaktifkan bidang kerja", () => "職種分野を有効にしました"),
  "skill_field.deactivate": d("system", () => "Menonaktifkan bidang kerja", () => "職種分野を無効にしました"),
  "skill_field.delete": d("system", () => "Menghapus bidang kerja", () => "職種分野を削除しました"),
  "candidate.create": d("candidate", (v) => `Menambah kandidat ${v.code}`, (v) => `候補者 ${v.code} を追加しました`),
  "candidate.update": d("candidate", (v) => `Mengubah data kandidat ${v.code}: ${v.section}${v.fields ? ` (${v.fields})` : ""}`, (v) => `候補者 ${v.code} の情報を変更しました：${v.section}${v.fields ? `（${v.fields}）` : ""}`),
  "candidate.row_create": d("candidate", (v) => `Menambah baris ${v.section} pada kandidat ${v.code}`, (v) => `候補者 ${v.code} の「${v.section}」に行を追加しました`),
  "candidate.row_update": d("candidate", (v) => `Mengubah baris ${v.section} pada kandidat ${v.code}${v.fields ? ` (${v.fields})` : ""}`, (v) => `候補者 ${v.code} の「${v.section}」の行を変更しました${v.fields ? `（${v.fields}）` : ""}`),
  "candidate.row_delete": d("candidate", (v) => `Menghapus baris ${v.section} pada kandidat ${v.code}`, (v) => `候補者 ${v.code} の「${v.section}」の行を削除しました`),
  "candidate.change_stage": d("candidate", (v) => `Mengubah status kandidat ${v.code}: ${v.from} → ${v.to}`, (v) => `候補者 ${v.code} の状況を変更しました：${v.from} → ${v.to}`),
  "candidate.consent_date_change": d("candidate", (v) => `Mengubah tanggal formulir persetujuan kandidat ${v.code}`, (v) => `候補者 ${v.code} の同意書の日付を変更しました`),
  "candidate.share_enable": d("candidate", (v) => `Membagikan kandidat ${v.code} ke TSK mitra`, (v) => `候補者 ${v.code} を提携の登録支援機関に共有しました`),
  "candidate.share_disable": d("candidate", (v) => `Menghentikan berbagi kandidat ${v.code} ke TSK`, (v) => `候補者 ${v.code} の共有を停止しました`),
  "candidate.decision": d("decision", (v) => `Keputusan TSK atas kandidat ${v.code}: ${v.from} → ${v.to}`, (v) => `候補者 ${v.code} への判断：${v.from} → ${v.to}`),
  "candidate.delete": d("candidate", (v) => `Menghapus permanen kandidat ${v.code}`, (v) => `候補者 ${v.code} を完全に削除しました`),
  "candidate.delete_files_failed": d("candidate", (v) => `Berkas kandidat ${v.code} gagal dihapus dari penyimpanan (perlu dibersihkan manual)`, (v) => `候補者 ${v.code} のファイルを保存領域から削除できませんでした（手動での整理が必要です）`),
  "document.upload": d("document", (v) => `Mengunggah dokumen untuk kandidat ${v.code}`, (v) => `候補者 ${v.code} の書類をアップロードしました`),
  "document.delete": d("document", (v) => `Menghapus dokumen kandidat ${v.code}`, (v) => `候補者 ${v.code} の書類を削除しました`),
  "document.download": d("document", (v) => `Mengunduh dokumen kandidat ${v.code}`, (v) => `候補者 ${v.code} の書類をダウンロードしました`),
  "note.create": d("note", (v) => `Menambah catatan TSK pada kandidat ${v.code} (${v.to})`, (v) => `候補者 ${v.code} にTSKメモを追加しました（${v.to}）`),
  "note.update": d("note", (v) => `Mengubah catatan TSK pada kandidat ${v.code}`, (v) => `候補者 ${v.code} のTSKメモを変更しました`),
  "note.visibility_change": d("note", (v) => `Mengubah siapa yang bisa membaca catatan TSK pada kandidat ${v.code}: ${v.from} → ${v.to}`, (v) => `候補者 ${v.code} のTSKメモの閲覧範囲を変更しました：${v.from} → ${v.to}`),
  "assessment.create": d("assessment", (v) => `Menulis penilaian ${v.value} untuk kandidat ${v.code}`, (v) => `候補者 ${v.code} の評価（${v.value}）を記入しました`),
  "assessment.update": d("assessment", (v) => `Mengubah penilaian ${v.value} untuk kandidat ${v.code}`, (v) => `候補者 ${v.code} の評価（${v.value}）を変更しました`),
  "selection.job_order": d("decision", (v) => `Mengaitkan keputusan kandidat ${v.code} dengan sebuah job order`, (v) => `候補者 ${v.code} の判断を求人に関連付けました`),
  "client_company.create": d("tsk", () => "Menambah perusahaan klien", () => "配属先企業を追加しました"),
  "client_company.update": d("tsk", () => "Mengubah perusahaan klien", () => "配属先企業を変更しました"),
  "client_company.activate": d("tsk", () => "Mengaktifkan perusahaan klien", () => "配属先企業を有効にしました"),
  "client_company.deactivate": d("tsk", () => "Menonaktifkan perusahaan klien", () => "配属先企業を無効にしました"),
  "client_company.delete": d("tsk", () => "Menghapus perusahaan klien", () => "配属先企業を削除しました"),
  "client_site.create": d("tsk", () => "Menambah lokasi kerja klien", () => "事業所を追加しました"),
  "client_site.update": d("tsk", () => "Mengubah lokasi kerja klien", () => "事業所を変更しました"),
  "client_site.activate": d("tsk", () => "Mengaktifkan lokasi kerja klien", () => "事業所を有効にしました"),
  "client_site.deactivate": d("tsk", () => "Menonaktifkan lokasi kerja klien", () => "事業所を無効にしました"),
  "client_site.delete": d("tsk", () => "Menghapus lokasi kerja klien", () => "事業所を削除しました"),
  "client_contact.create": d("tsk", () => "Menambah PIC klien", () => "配属先担当者を追加しました"),
  "client_contact.update": d("tsk", () => "Mengubah PIC klien", () => "配属先担当者を変更しました"),
  "client_contact.activate": d("tsk", () => "Mengaktifkan PIC klien", () => "配属先担当者を有効にしました"),
  "client_contact.deactivate": d("tsk", () => "Menonaktifkan PIC klien", () => "配属先担当者を無効にしました"),
  "client_contact.delete": d("tsk", () => "Menghapus PIC klien", () => "配属先担当者を削除しました"),
  "job_order.create": d("tsk", () => "Membuat job order", () => "求人を作成しました"),
  "responsible.set": d("records", () => "Menetapkan penanggung jawab pekerja", () => "就労者の担当者を設定しました"),
  "client_sheet_export": d("tsk", () => "Mengekspor lembar klien / job order ke PDF", () => "取引先プロフィール／求人票をPDFに書き出しました"),
  "job_order.update": d("tsk", () => "Mengubah job order", () => "求人を変更しました"),
  "job_order.status": d("tsk", () => "Mengubah status job order", () => "求人の状況を変更しました"),
  "job_order.delete": d("tsk", () => "Menghapus job order", () => "求人を削除しました"),
  "placement.update": d("tsk", (v) => `Mengubah data penempatan kandidat ${v.code}`, (v) => `候補者 ${v.code} の配属情報を変更しました`),
  // ---- Catatan kegiatan TSK (langkah 7A). Tanpa isi teks, nama pekerja, atau nama berkas.
  "activity_record.create": d("records", (v) => `Membuat catatan kegiatan (${v.value})`, (v) => `活動記録を作成しました（${v.value}）`),
  "activity_record.update": d("records", () => "Mengubah catatan kegiatan", () => "活動記録を変更しました"),
  "activity_record.void": d("records", () => "Membatalkan catatan kegiatan", () => "活動記録を取り消しました"),
  "activity_case.create": d("records", () => "Membuat kasus", () => "ケースを作成しました"),
  "activity_case.update": d("records", () => "Mengubah kasus", () => "ケースを変更しました"),
  "activity_case.close": d("records", () => "Menutup kasus", () => "ケースを終了しました"),
  "activity_case.reopen": d("records", () => "Membuka kembali kasus", () => "ケースを再開しました"),
  "case_timeline_event.create": d("records", () => "Menambah baris kronologi kasus", () => "時系列に行を追加しました"),
  "case_timeline_event.update": d("records", () => "Mengubah baris kronologi kasus", () => "時系列の行を変更しました"),
  "case_timeline_event.void": d("records", () => "Membatalkan baris kronologi kasus", () => "時系列の行を取り消しました"),
  "activity_followup.create": d("records", () => "Menambah tugas tindak lanjut", () => "フォローアップ課題を追加しました"),
  "activity_followup.status_change": d("records", (v) => `Mengubah status tugas tindak lanjut: ${v.to}`, (v) => `フォローアップ課題の状況を変更しました：${v.to}`),
  "activity_attachment.add": d("records", () => "Menambah lampiran foto pada catatan kegiatan", () => "活動記録に写真を添付しました"),
  "activity_attachment.update": d("records", () => "Mengubah keterangan lampiran foto", () => "写真の説明を変更しました"),
  "activity_attachment.remove": d("records", () => "Menyembunyikan lampiran foto pada catatan kegiatan", () => "活動記録の写真を非表示にしました"),
  "activity_attachment.download": d("records", () => "Mengunduh lampiran foto catatan kegiatan", () => "活動記録の写真をダウンロードしました"),
  "activity_daily_report.share": d("records", () => "Mengirim laporan harian ke leader", () => "日報を責任者に送信しました"),
  "periodic_interview.create": d("records", (v) => `Mengisi wawancara berkala (${v.value})`, (v) => `定期面談を記録しました（${v.value}）`),
  "periodic_interview.update": d("records", (v) => `Mengubah wawancara berkala (${v.value})`, (v) => `定期面談を変更しました（${v.value}）`),
  "periodic_interview.void": d("records", () => "Membatalkan wawancara berkala", () => "定期面談を取り消しました"),
  "residence_card.create": d("records", () => "Mencatat kartu izin tinggal pekerja", () => "在留カード情報を登録しました"),
  "residence_card.update": d("records", (v) => `Mengubah data kartu izin tinggal${v.fields ? ` (${v.fields})` : ""}`, (v) => `在留カード情報を変更しました${v.fields ? `（${v.fields}）` : ""}`),
  "residence_card.receive": d("records", () => "Mencatat kartu izin tinggal baru diterima", () => "新しい在留カードの受領を記録しました"),
  "residence_card.number_set": d("records", () => "Menyimpan nomor kartu izin tinggal (terenkripsi)", () => "在留カード番号を保存しました（暗号化）"),
  "residence_card.number_view": d("records", () => "Menampilkan nomor kartu izin tinggal", () => "在留カード番号を表示しました"),
  "residence_card.number_remove": d("records", () => "Menghapus nomor kartu izin tinggal tersimpan", () => "保存済みの在留カード番号を削除しました"),
  "residence_card.photo_set": d("records", () => "Menyimpan foto kartu izin tinggal", () => "在留カードの画像を保存しました"),
  "residence_card.photo_view": d("records", () => "Membuka foto kartu izin tinggal", () => "在留カードの画像を開きました"),
  "residence_card.photo_remove": d("records", () => "Menghapus foto kartu izin tinggal", () => "在留カードの画像を削除しました"),
  "residence_card.reminder_sent": d("records", () => "Email pengingat kartu izin tinggal terkirim (otomatis)", () => "在留カードのリマインダーメールを送信しました（自動）"),
  "residence_card.renewal_view": d("records", () => "Membuka data perpanjangan kartu izin tinggal (siap salin)", () => "在留カード更新申請データを開きました"),
  "placement.arrival_update": d("records", () => "Mengubah tanggal tiba pekerja di Jepang", () => "就労者の日本到着日を変更しました"),
  "worker_jp_profile.update": d("records", (v) => `Mengubah data pekerja di Jepang${v.fields ? ` (${v.fields})` : ""}`, (v) => `就労者の日本での連絡先情報を変更しました${v.fields ? `（${v.fields}）` : ""}`),
  "residence_card.void": d("records", () => "Membatalkan data kartu izin tinggal", () => "在留カード情報を取り消しました"),
  "activity_export": d("records", (v) => `Mengekspor catatan kegiatan ke PDF (${v.value})`, (v) => `活動記録をPDFに書き出しました（${v.value}）`),
  "audit.export": d("system", (v) => `Mengekspor riwayat aktivitas ke CSV (${v.value})`, (v) => `アクティビティ履歴をCSVに書き出しました（${v.value}）`),
};

export const AUDIT_ACTION_NAMES = Object.keys(ACTIONS);
export const categoryOf = (action: string): AuditCategory => ACTIONS[action]?.category ?? "system";

// Label nilai (pilihan/status) yang boleh muncul di audit (lihat AUDIT_VALUE_FIELDS). Nilai tak dikenal ditampilkan apa adanya.
const VALUES: Record<AuditLocale, Record<string, string>> = {
  id: {
    STUDYING: "Belajar", READY: "Siap seleksi", WITHDRAWN: "Mundur",
    NONE: "Belum diputuskan", SHORTLISTED: "Masuk shortlist", PASSED_TSK_INTERVIEW: "Lulus wawancara TSK", SUBMITTED_TO_CLIENT: "Diajukan ke klien",
    PASSED_CLIENT_INTERVIEW: "Lulus interview klien", DOCUMENT_PROCESS: "Proses dokumen", DEPARTED: "Berangkat", REJECTED: "Ditolak",
    TSK_ONLY: "hanya TSK", SHARED_WITH_LPK: "dibagikan ke LPK",
    daily_work: "catatan kerja harian", meeting: "notulen/pertemuan", open: "terbuka", done: "selesai", cancelled: "dibatalkan", closed: "ditutup", void: "dibatalkan", active: "aktif",
    LPK_ADMIN: "Admin LPK", LPK_SENSEI: "Sensei", TSK_ADMIN: "Admin TSK", TSK_STAFF: "Staf TSK", SUPER_ADMIN: "Super admin",
    LPK_MONTHLY: "bulanan LPK", TSK_INTERVIEW: "wawancara TSK", TSK_VISIT: "kunjungan TSK",
  },
  ja: {
    STUDYING: "学習中", READY: "選考準備完了", WITHDRAWN: "辞退",
    NONE: "未判断", SHORTLISTED: "候補リスト入り", PASSED_TSK_INTERVIEW: "支援機関面接合格", SUBMITTED_TO_CLIENT: "企業へ推薦済み",
    PASSED_CLIENT_INTERVIEW: "企業面接合格", DOCUMENT_PROCESS: "書類手続き中", DEPARTED: "渡航済み", REJECTED: "見送り",
    TSK_ONLY: "TSK内のみ", SHARED_WITH_LPK: "LPKに共有",
    daily_work: "業務記録", meeting: "議事録・面談記録", open: "未完了", done: "完了", cancelled: "取消", closed: "終了", void: "取消", active: "有効",
    LPK_ADMIN: "LPK管理者", LPK_SENSEI: "講師", TSK_ADMIN: "TSK管理者", TSK_STAFF: "TSKスタッフ", SUPER_ADMIN: "スーパー管理者",
    LPK_MONTHLY: "LPK月次", TSK_INTERVIEW: "TSK面談", TSK_VISIT: "TSK訪問",
  },
};
export const auditValueLabel = (locale: AuditLocale, v: unknown): string => (v === undefined || v === null ? "—" : (VALUES[locale][String(v)] ?? String(v)));

/** Kode kandidat = 8 karakter pertama id (sama dengan dialog hapus). Nama kandidat tidak disimpan di audit. */
export const candidateCode = (id: string | null | undefined) => (id ? id.slice(0, 8) : "—");

/** Pelaku untuk ditampilkan: nama (bila tersimpan, yaitu satu organisasi) atau nama organisasinya (lintas organisasi), plus peran. */
export function actorLabel(e: Pick<AuditView, "actorName" | "actorRole" | "actorOrgName">, locale: AuditLocale): string {
  const role = e.actorRole ? auditValueLabel(locale, e.actorRole) : null;
  const base = e.actorName ?? e.actorOrgName ?? (locale === "ja" ? "不明" : "Tidak diketahui");
  return role ? `${base} (${role})` : base;
}

export function describeAudit(e: AuditView, locale: AuditLocale, labels: AuditLabels = {}): { text: string; actor: string; category: AuditCategory; known: boolean } {
  const def = ACTIONS[e.action];
  const after = e.after ?? {};
  const before = e.before ?? {};
  const section = typeof after.section === "string" ? after.section : "";
  const rawFields = Array.isArray(after.fields) ? (after.fields as unknown[]).map(String) : Array.isArray(after.changed) ? (after.changed as unknown[]).map(String) : [];
  const valueOf = (o: Record<string, unknown>) => o.stage ?? o.decision ?? o.visibility ?? o.active ?? o.sharedWithTsk ?? o.status;
  const act = (x: unknown) => (x === true ? (locale === "ja" ? "有効" : "aktif") : x === false ? (locale === "ja" ? "無効" : "nonaktif") : auditValueLabel(locale, x));
  const vars: Vars = {
    who: actorLabel(e, locale),
    code: candidateCode(e.candidateId ?? e.entityId),
    from: act(valueOf(before)),
    to: act(valueOf(after)),
    fields: rawFields.map((f) => labels.field?.(section, f) ?? f).join(", "),
    section: labels.section?.(section) ?? section ?? "",
    role: auditValueLabel(locale, after.role),
    value: [after.kind ? auditValueLabel(locale, after.kind) : "", after.exportKind ? String(after.exportKind) : "", after.clientVersion === true ? (locale === "ja" ? "企業向け" : "versi klien") : "", typeof after.period === "string" ? after.period.slice(0, 7) : "", typeof after.rows === "number" ? `${after.rows}` : ""].filter(Boolean).join(" ") || "—",
  };
  const text = def ? def[locale](vars) : e.action; // aksi tak dikenal: tampilkan kodenya (tidak pernah crash)
  return { text, actor: vars.who, category: def?.category ?? "system", known: Boolean(def) };
}
