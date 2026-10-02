// Riwayat aktivitas DEMO (~30 entri per organisasi), dibangkitkan deterministik (PRNG ber-seed tetap). Murni: hanya menyusun baris; seed yang menyisipkannya.
// Mengikuti aturan produksi: nilai hanya dari AUDIT_VALUE_FIELDS (lewat sanitizeAuditPayload), nama orang TIDAK disimpan untuk entri lintas organisasi,
// dan nama kandidat tidak pernah ada di entri.
import { sanitizeAuditPayload } from "./audit-values";
import { int, makeRng, pick } from "./demo-rng";

type Org = { id: string; name: string };
type User = { id: string; name: string; role: string; orgId: string };
type Cand = { id: string; orgIndex: number; i: number; stage: string };

export type DemoAuditRow = {
  organizationId: string;
  actorOrgId: string;
  actorUserId: string;
  actorName: string | null;
  actorRole: string;
  actorOrgName: string;
  candidateId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: Date;
};

const SECTIONS: Array<[string, string[]]> = [["basic", ["heightCm", "birthPlace"]], ["contact", ["phone", "address"]], ["about", ["motivation", "hobby"]], ["physical", ["visionNote"]], ["japan", ["everInJapan"]]];
const DOC_TYPES = ["PASSPORT", "DIPLOMA", "PHOTO", "MEDICAL_CHECKUP"];
const DECISIONS = ["SHORTLISTED", "PASSED_TSK_INTERVIEW", "SUBMITTED_TO_CLIENT", "PASSED_CLIENT_INTERVIEW", "DOCUMENT_PROCESS", "DEPARTED"];

export function buildDemoAudit(p: { now: Date; lpks: Org[]; tsk: Org; users: User[]; cands: Cand[] }): DemoAuditRow[] {
  const rng = makeRng("demo-audit");
  const rows: DemoAuditRow[] = [];
  const orgOf = new Map([...p.lpks, p.tsk].map((o) => [o.id, o]));
  const when = (daysAgo: number) => new Date(p.now.getTime() - daysAgo * 86_400_000 - int(rng, 0, 20 * 3600) * 1000);

  const add = (r: { org: string; actor: User; cand?: Cand; action: string; entity: string; entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; daysAgo: number }) => {
    const actorOrgId = r.actor.orgId;
    const cross = actorOrgId !== r.org;
    rows.push({
      organizationId: r.org,
      actorOrgId,
      actorUserId: r.actor.id,
      actorName: cross ? null : r.actor.name,
      actorRole: r.actor.role,
      actorOrgName: orgOf.get(actorOrgId)?.name ?? "",
      candidateId: r.cand?.id ?? null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId ?? r.cand?.id ?? null,
      before: sanitizeAuditPayload(r.entity, r.before) ?? null,
      after: sanitizeAuditPayload(r.entity, r.after) ?? null,
      createdAt: when(r.daysAgo),
    });
  };

  const tskUsers = p.users.filter((u) => u.orgId === p.tsk.id);
  for (const [oi, lpk] of p.lpks.entries()) {
    const staff = p.users.filter((u) => u.orgId === lpk.id);
    const admin = staff.find((u) => u.role === "LPK_ADMIN")!;
    const sensei = staff.find((u) => u.role === "LPK_SENSEI") ?? admin;
    const cands = p.cands.filter((c) => c.orgIndex === oi);
    for (let k = 0; k < 6; k++) add({ org: lpk.id, actor: k % 3 === 2 ? sensei : admin, action: "auth.login", entity: "user", entityId: (k % 3 === 2 ? sensei : admin).id, daysAgo: k * 5 + int(rng, 0, 3) });
    for (const c of cands.slice(0, 5)) add({ org: lpk.id, actor: admin, cand: c, action: "candidate.create", entity: "candidate", after: { fields: ["fullName", "gender", "birthDate", "fieldId"], rows: { family: 3, education: 2 } }, daysAgo: 24 + int(rng, 0, 6) });
    for (let k = 0; k < 6; k++) {
      const [section, fields] = pick(rng, SECTIONS);
      add({ org: lpk.id, actor: admin, cand: pick(rng, cands), action: "candidate.update", entity: "candidate", after: { section, fields }, daysAgo: int(rng, 3, 22) });
    }
    for (const [k, c] of cands.filter((x) => x.stage !== "STUDYING").slice(0, 3).entries()) add({ org: lpk.id, actor: admin, cand: c, action: "candidate.change_stage", entity: "candidate", before: { stage: "STUDYING" }, after: { stage: c.stage }, daysAgo: 8 + k * 3 });
    for (const c of cands.filter((x) => x.stage === "READY").slice(0, 2)) add({ org: lpk.id, actor: admin, cand: c, action: "candidate.share_enable", entity: "candidate", before: { sharedWithTsk: false }, after: { sharedWithTsk: true }, daysAgo: int(rng, 2, 14) });
    for (let k = 0; k < 3; k++) add({ org: lpk.id, actor: admin, cand: cands[k], action: "document.upload", entity: "candidate_document", entityId: `${k}`, after: { section: "documents", fields: ["type"], type: DOCUMENT_TYPE(k) }, daysAgo: 20 + k });
    for (let k = 0; k < 3; k++) add({ org: lpk.id, actor: sensei, cand: cands[k + 3], action: "assessment.create", entity: "candidate_assessment", after: { kind: "LPK_MONTHLY", period: `${p.now.getUTCFullYear()}-${String(p.now.getUTCMonth() + 1).padStart(2, "0")}-01`, fields: ["scoreJapanese", "scoreAttitude"] }, daysAgo: int(rng, 1, 12) });
    add({ org: lpk.id, actor: admin, action: "user.create", entity: "user", entityId: sensei.id, after: { role: "LPK_SENSEI" }, daysAgo: 28 });
    add({ org: lpk.id, actor: admin, action: "user.update", entity: "user", entityId: sensei.id, before: { role: "LPK_SENSEI" }, after: { role: "LPK_SENSEI", changed: ["languages"] }, daysAgo: 15 });
    // Aksi TSK mitra pada kandidat LPK ini: tersimpan di log LPK (LPK ikut melihat), tanpa nama orang
    if (oi < 2) {
      const staffTsk = tskUsers.find((u) => u.role === "TSK_STAFF") ?? tskUsers[0];
      const adminTsk = tskUsers.find((u) => u.role === "TSK_ADMIN") ?? tskUsers[0];
      for (const [k, c] of cands.filter((x) => x.stage === "READY").slice(0, 3).entries()) {
        add({ org: lpk.id, actor: adminTsk, cand: c, action: "candidate.decision", entity: "candidate", before: { decision: k === 0 ? "NONE" : DECISIONS[k - 1] }, after: { decision: DECISIONS[k] }, daysAgo: 4 + k * 2 });
        add({ org: lpk.id, actor: staffTsk, cand: c, action: "document.download", entity: "candidate_document", entityId: `d${k}`, after: { type: "PASSPORT" }, daysAgo: 3 + k });
      }
      add({ org: lpk.id, actor: staffTsk, cand: cands.find((x) => x.stage === "READY") ?? cands[0], action: "note.create", entity: "candidate_note", entityId: `n${oi}`, after: { visibility: "SHARED_WITH_LPK" }, daysAgo: 2 });
    }
  }

  // Log organisasi TSK sendiri: masuk, klien, job order, penempatan
  const admin = tskUsers.find((u) => u.role === "TSK_ADMIN") ?? tskUsers[0];
  const staff = tskUsers.find((u) => u.role === "TSK_STAFF") ?? admin;
  for (let k = 0; k < 7; k++) add({ org: p.tsk.id, actor: k % 2 ? staff : admin, action: "auth.login", entity: "user", entityId: (k % 2 ? staff : admin).id, daysAgo: k * 4 + int(rng, 0, 2) });
  for (let k = 0; k < 3; k++) add({ org: p.tsk.id, actor: staff, action: "client_company.create", entity: "client_company", entityId: `c${k}`, after: { fields: ["name", "corporateNumber"] }, daysAgo: 26 - k });
  for (let k = 0; k < 4; k++) add({ org: p.tsk.id, actor: staff, action: "client_site.create", entity: "client_site", entityId: `s${k}`, after: { fields: ["name", "address", "fieldIds"] }, daysAgo: 24 - k });
  for (let k = 0; k < 3; k++) add({ org: p.tsk.id, actor: staff, action: "client_contact.create", entity: "client_site_contact", entityId: `p${k}`, after: { fields: ["name", "phone", "roleTitle"] }, daysAgo: 22 - k });
  for (let k = 0; k < 4; k++) add({ org: p.tsk.id, actor: admin, action: "job_order.create", entity: "job_order", entityId: `j${k}`, after: { fields: ["title", "fieldId", "positions", "siteId"] }, daysAgo: 18 - k * 2 });
  add({ org: p.tsk.id, actor: admin, action: "job_order.status", entity: "job_order", entityId: "j0", after: { fields: ["status"], status: "CLOSED" }, daysAgo: 6 });
  const departed = p.cands.filter((c) => c.stage === "READY").slice(0, 2);
  for (const c of departed) add({ org: p.tsk.id, actor: admin, cand: c, action: "placement.update", entity: "placement", entityId: `pl-${c.id.slice(0, 4)}`, after: { fields: ["startDate"] }, daysAgo: 3 });
  for (const c of departed) add({ org: p.tsk.id, actor: staff, cand: c, action: "selection.job_order", entity: "candidate_selection", entityId: `sel-${c.id.slice(0, 4)}`, after: { fields: ["decision"] }, daysAgo: 9 });
  return rows;
}

function DOCUMENT_TYPE(k: number) {
  return DOC_TYPES[k % DOC_TYPES.length];
}
