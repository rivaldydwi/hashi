// Label butir form 在留期間更新許可申請書 (申請人等作成用1) dalam bahasa Jepang, tetap (bukan terjemahan UI): isi form selalu Jepang, jadi label ditaruh di kode dan ditampilkan dengan lang="ja".
// Label Indonesia kecil ada di messages (cards.renewal.items.<key>). Teks resmi form berstatus DRAFT sampai dicek staf TSK.
export const RENEWAL_LABELS_JA: Record<string, string> = {
  nationality: "1 国籍・地域",
  birth: "2 生年月日",
  name: "3 氏名（ローマ字）",
  gender: "4 性別",
  marital: "5 配偶者の有無",
  occupation: "6 職業",
  homeAddress: "7 本国における居住地",
  addressJp: "8 日本における居住地",
  phoneJp: "9 電話番号・携帯電話番号",
  passport: "10 旅券（番号・有効期限）",
  currentStatus: "11 現に有する在留資格（在留期間・満了日）",
  cardNumber: "12 在留カード番号",
  desiredPeriod: "13 希望する在留期間",
  reason: "14 更新の理由",
  criminal: "15 犯罪を理由とする処分を受けたことの有無",
  familyInJapan: "16 在日親族及び同居者",
};
