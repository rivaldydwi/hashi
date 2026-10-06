// Semua label PDF (bahasa Jepang) di SATU berkas ini, BUKAN di messages/*.json: dokumen yang dicetak/dikirim ke klien harus selalu berbahasa Jepang,
// apa pun bahasa tampilan pengguna. Format baku kantor TSK (langkah 7A); ubah di sini bila format kantor berubah.
export const PDF = {
  // ① 業務記録
  daily: { title: "業務記録", date: "日付", author: "担当者", subjects: "対象者", site: "所属先", workType: "業務内容", actionTaken: "対応内容", result: "結果・状況", pending: "未対応・継続事項", nextAction: "今後の対応", reportTo: "共有・報告先", note: "備考" },
  // ② 議事録・面談記録
  meeting: { title: "議事録・面談記録", subject: "件名", when: "日時", subjects: "対象者", handlers: "対応者", placeMethod: "場所・方法", sections: ["相談・面談内容", "本人の話・意向", "現在の状況", "対応内容", "今後の対応", "共有事項", "未対応事項"] as const },
  // ③ 時系列
  timeline: { title: "時系列", when: "日時", event: "出来事・状況", subjectStatement: "本人の発言・対応", companyResponse: "当社の対応", note: "備考", caseTitle: "件名", category: "区分", subjects: "対象者", site: "配属先", caseCode: "管理番号", status: "状況", opened: "発生日", writtenBy: "作成" },
  // ④ 定期面談 (配属先企業の住所と担当者は Excel 基本情報シートの列名に合わせる)
  periodic: { title: "定期面談", name: "氏名", field: "特定技能分野", startDate: "就労開始日", company: "配属先企業名", address: "配属先企業住所", phone: "配属先企業電話番号", pic: "配属先企業担当者", month: "月", date: "面談日", status: "ステータス", content: "面談内容", reason: "実施理由", staff: "担当者", note: "備考", notApplicable: "対象外", quarterNote: (q: number) => `Q${q} 備考` },
  // 参考様式第5-5号 定期面談報告書（1号特定技能外国人用）. Label butir (①〜⑤) ada di src/db/form55.ts (satu daftar kode tetap).
  form55: {
    title: "定期面談報告書（1号特定技能外国人用）", formNo: "参考様式第5-5号",
    s1: "1 面談対象者", name: "① 氏名", org: "② 特定技能所属機関", date: "③ 面談日", method: "④ 面談方式",
    s2: "2 面談対応者", responder: "① 氏名", position: "② 区分・役職名",
    s3: "3 面談結果", colItem: "項目", colHas: "問題の有無", colText: "問題の内容", has: "有", none: "無",
    nonconformity: "⑥ 基準不適合等の有無", special: "⑦ その他特筆事項",
    s4: "4 基準不適合等への対応", occurredOn: "① 発生日", content: "② 内容", handling: "③ 対応結果",
    toWorker: "ア 外国人本人への対応", toCompany: "イ 所属機関（受入れ企業）への対応", toAgency: "ウ 関係機関への対応",
    notifyManager: "(ア) 責任者への通知", immigration: "(イ) 出入国在留管理庁への案内",
    referred: "関係機関へ案内した", noAction: "対応なし", done: "済", notDone: "未", date2: "年月日", to: "通知先", body: "機関名", reason: "理由",
    createdOn: "作成年月日", interviewer: "面談実施者の氏名", unfilled: "（未記入）",
    methods: { in_person: "対面", online: "オンライン" } as Record<string, string>,
    roles: { support_manager: "支援責任者", support_staff: "支援担当者" } as Record<string, string>,
    yearTitle: (fyTitle: string) => `定期面談報告書 ${fyTitle}`,
  },
  common: { createdAt: "作成日時", void: "取消済み", voidReason: "取消理由", photo: "写真", page: (n: number, total: number) => `${n} / ${total}`, none: "—" },
  workTypes: { interview: "面談", consultation: "相談対応", residence_card: "在留カード", hospital_visit: "病院同行", other: "その他" } as Record<string, string>,
  methods: { phone: "電話", online: "オンライン", visit: "訪問", in_person: "対面" } as Record<string, string>,
  categories: { trouble: "トラブル", resignation: "退職", workplace_change: "職場変更", hospital: "病院", residence: "在留関係", life_consultation: "生活相談", other: "その他" } as Record<string, string>,
  caseStatus: { open: "対応中", closed: "終了" } as Record<string, string>,
  results: { no_issue: "問題なし", follow_up: "要フォロー", issue: "問題あり", not_done: "未実施" } as Record<string, string>,
  reasons: { agency: "機関判断", support: "登録支援判断", worker: "本人申出" } as Record<string, string>,
};
