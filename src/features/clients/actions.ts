"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { clientCompanies, clientSiteContacts, clientSiteFields, clientSites, skillFields } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ActionError, pgErrorCode } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { tenantQuery, type CurrentUser } from "@/lib/session";
import { buildSchema, changedFields, type FieldDef } from "@/features/candidates/sections";
import { COMPANY_FIELDS, CONTACT_FIELDS, SITE_FIELDS } from "./fields";
import { requireAdminAction, requireTskAction, uuid } from "./guards";

const FK_VIOLATION = "23503";

type Values = Record<string, unknown>;

async function guarded(fn: () => Promise<FormState>): Promise<FormState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ActionError) return { status: "error", key: err.code };
    throw err;
  }
}

/** Audit klien: hanya jenis aksi, id, dan NAMA kolom. Nama/telepon PIC, catatan, dan alamat tidak pernah dicatat. */
async function auditClient(tx: Tx, me: CurrentUser, action: string, entity: string, entityId: string, fields?: string[]) {
  await audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action, entity, entityId, after: fields ? { fields } : undefined });
}

const parse = (defs: FieldDef[], formData: FormData) => buildSchema(defs).safeParse(Object.fromEntries(formData));
const filled = (defs: FieldDef[], values: Values) => defs.filter((f) => values[f.name] !== null && values[f.name] !== undefined).map((f) => f.name);

// ---------------------------------------------------------------------------------------------- Perusahaan (法人)

export async function createCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  let id = "";
  const res = await guarded(async () => {
    const me = await requireTskAction();
    const parsed = parse(COMPANY_FIELDS, formData);
    if (!parsed.success) return { status: "error", key: "clients.errors.invalid" };
    const values = parsed.data as Values;
    id = await tenantQuery(async (tx) => {
      const [row] = await tx.insert(clientCompanies).values({ ...(values as object), orgId: me.organizationId } as typeof clientCompanies.$inferInsert).returning({ id: clientCompanies.id });
      await auditClient(tx, me, "client_company.create", "client_company", row.id, filled(COMPANY_FIELDS, values));
      return row.id;
    });
    return { status: "success", key: "clients.saved" };
  });
  if (res.status === "success") {
    revalidatePath("/clients");
    redirect(`/clients/${id}`);
  }
  return res;
}

export async function updateCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const id = uuid.safeParse(formData.get("companyId"));
    const parsed = parse(COMPANY_FIELDS, formData);
    if (!id.success || !parsed.success) return { status: "error", key: "clients.errors.invalid" };
    const values = parsed.data as Values;
    await tenantQuery(async (tx) => {
      const [before] = await tx.select().from(clientCompanies).where(eq(clientCompanies.id, id.data));
      if (!before) throw new ActionError("clients.errors.notFound");
      const done = await tx.update(clientCompanies).set(values).where(eq(clientCompanies.id, id.data)).returning({ id: clientCompanies.id });
      if (done.length !== 1) throw new ActionError("clients.errors.forbidden");
      const changed = changedFields(COMPANY_FIELDS, before, values);
      if (changed.length) await auditClient(tx, me, "client_company.update", "client_company", id.data, changed);
    });
    revalidatePath("/clients");
    revalidatePath(`/clients/${id.data}`);
    return { status: "success", key: "clients.saved" };
  });
}

export async function setCompanyActive(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const id = uuid.safeParse(formData.get("companyId"));
    if (!id.success) return { status: "error", key: "clients.errors.invalid" };
    const active = formData.get("active") === "true";
    await tenantQuery(async (tx) => {
      const done = await tx.update(clientCompanies).set({ active }).where(eq(clientCompanies.id, id.data)).returning({ id: clientCompanies.id });
      if (done.length !== 1) throw new ActionError("clients.errors.notFound");
      await auditClient(tx, me, active ? "client_company.activate" : "client_company.deactivate", "client_company", id.data);
    });
    revalidatePath("/clients");
    revalidatePath(`/clients/${id.data}`);
    return { status: "success", key: active ? "clients.activated" : "clients.deactivated" };
  });
}

/** Hapus permanen perusahaan beserta lokasi dan PIC-nya: hanya TSK_ADMIN, dan hanya bila tidak ada job order / penempatan (FK RESTRICT). */
export async function deleteCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  let deleted = false;
  const res = await guarded(async () => {
    const me = await requireTskAction();
    requireAdminAction(me);
    const id = uuid.safeParse(formData.get("companyId"));
    if (!id.success) return { status: "error", key: "clients.errors.invalid" };
    try {
      await tenantQuery(async (tx) => {
        const done = await tx.delete(clientCompanies).where(eq(clientCompanies.id, id.data)).returning({ id: clientCompanies.id });
        if (done.length !== 1) throw new ActionError("clients.errors.notFound");
        await auditClient(tx, me, "client_company.delete", "client_company", id.data);
      });
    } catch (err) {
      if (pgErrorCode(err) === FK_VIOLATION) return { status: "error", key: "clients.errors.inUse" };
      throw err;
    }
    deleted = true;
    return { status: "success", key: "clients.deleted" };
  });
  if (deleted) {
    revalidatePath("/clients");
    redirect("/clients?deleted=1");
  }
  return res;
}

// ---------------------------------------------------------------------------------------------- Lokasi (事業所)

/** Daftar bidang yang diterima lokasi dari checkbox `fieldIds`: harus ada, dan aktif kecuali sudah terpasang di lokasi itu. */
async function resolveFieldIds(tx: Tx, formData: FormData, currentIds: string[]): Promise<string[]> {
  const ids = [...new Set(formData.getAll("fieldIds").map(String))];
  if (!ids.every((v) => uuid.safeParse(v).success)) throw new ActionError("clients.errors.invalid");
  if (ids.length === 0) return [];
  const rows = await tx.select({ id: skillFields.id, active: skillFields.active }).from(skillFields).where(inArray(skillFields.id, ids));
  if (rows.length !== ids.length) throw new ActionError("clients.errors.invalid");
  if (rows.some((r) => !r.active && !currentIds.includes(r.id))) throw new ActionError("candidates.errors.skillFieldInvalid");
  return ids;
}

async function syncSiteFields(tx: Tx, me: CurrentUser, siteId: string, ids: string[]): Promise<boolean> {
  const current = (await tx.select({ f: clientSiteFields.fieldId }).from(clientSiteFields).where(eq(clientSiteFields.siteId, siteId))).map((r) => r.f);
  const toAdd = ids.filter((i) => !current.includes(i));
  const toRemove = current.filter((i) => !ids.includes(i));
  if (toRemove.length) await tx.delete(clientSiteFields).where(and(eq(clientSiteFields.siteId, siteId), inArray(clientSiteFields.fieldId, toRemove)));
  if (toAdd.length) await tx.insert(clientSiteFields).values(toAdd.map((fieldId) => ({ siteId, fieldId, orgId: me.organizationId })));
  return toAdd.length + toRemove.length > 0;
}

export async function createSite(_prev: FormState, formData: FormData): Promise<FormState> {
  let ids: { companyId: string; siteId: string } | null = null;
  const res = await guarded(async () => {
    const me = await requireTskAction();
    const companyId = uuid.safeParse(formData.get("companyId"));
    const parsed = parse(SITE_FIELDS, formData);
    if (!companyId.success || !parsed.success) return { status: "error", key: "clients.errors.invalid" };
    const values = parsed.data as Values;
    const siteId = await tenantQuery(async (tx) => {
      const [company] = await tx.select({ id: clientCompanies.id }).from(clientCompanies).where(eq(clientCompanies.id, companyId.data));
      if (!company) throw new ActionError("clients.errors.notFound");
      const fieldIds = await resolveFieldIds(tx, formData, []);
      const [row] = await tx.insert(clientSites).values({ ...(values as object), orgId: me.organizationId, companyId: companyId.data } as typeof clientSites.$inferInsert).returning({ id: clientSites.id });
      await syncSiteFields(tx, me, row.id, fieldIds);
      await auditClient(tx, me, "client_site.create", "client_site", row.id, [...filled(SITE_FIELDS, values), ...(fieldIds.length ? ["fieldIds"] : [])]);
      return row.id;
    });
    ids = { companyId: companyId.data, siteId };
    return { status: "success", key: "clients.saved" };
  });
  if (res.status === "success" && ids) {
    revalidatePath("/clients");
    redirect(`/clients/${(ids as { companyId: string }).companyId}/sites/${(ids as { siteId: string }).siteId}`);
  }
  return res;
}

export async function updateSite(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const siteId = uuid.safeParse(formData.get("siteId"));
    const parsed = parse(SITE_FIELDS, formData);
    if (!siteId.success || !parsed.success) return { status: "error", key: "clients.errors.invalid" };
    const values = parsed.data as Values;
    await tenantQuery(async (tx) => {
      const [before] = await tx.select().from(clientSites).where(eq(clientSites.id, siteId.data));
      if (!before) throw new ActionError("clients.errors.notFound");
      const currentIds = (await tx.select({ f: clientSiteFields.fieldId }).from(clientSiteFields).where(eq(clientSiteFields.siteId, siteId.data))).map((r) => r.f);
      const fieldIds = await resolveFieldIds(tx, formData, currentIds);
      const done = await tx.update(clientSites).set(values).where(eq(clientSites.id, siteId.data)).returning({ id: clientSites.id });
      if (done.length !== 1) throw new ActionError("clients.errors.forbidden");
      const fieldsChanged = await syncSiteFields(tx, me, siteId.data, fieldIds);
      const changed = [...changedFields(SITE_FIELDS, before, values), ...(fieldsChanged ? ["fieldIds"] : [])];
      if (changed.length) await auditClient(tx, me, "client_site.update", "client_site", siteId.data, changed);
    });
    revalidatePath("/clients");
    revalidatePath(`/clients/${formData.get("companyId")}/sites/${siteId.data}`);
    return { status: "success", key: "clients.saved" };
  });
}

export async function setSiteActive(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const siteId = uuid.safeParse(formData.get("siteId"));
    if (!siteId.success) return { status: "error", key: "clients.errors.invalid" };
    const active = formData.get("active") === "true";
    await tenantQuery(async (tx) => {
      const done = await tx.update(clientSites).set({ active }).where(eq(clientSites.id, siteId.data)).returning({ id: clientSites.id });
      if (done.length !== 1) throw new ActionError("clients.errors.notFound");
      await auditClient(tx, me, active ? "client_site.activate" : "client_site.deactivate", "client_site", siteId.data);
    });
    revalidatePath("/clients");
    revalidatePath(`/clients/${formData.get("companyId")}/sites/${siteId.data}`);
    return { status: "success", key: active ? "clients.activated" : "clients.deactivated" };
  });
}

export async function deleteSite(_prev: FormState, formData: FormData): Promise<FormState> {
  let to = "";
  const res = await guarded(async () => {
    const me = await requireTskAction();
    requireAdminAction(me);
    const siteId = uuid.safeParse(formData.get("siteId"));
    const companyId = uuid.safeParse(formData.get("companyId"));
    if (!siteId.success || !companyId.success) return { status: "error", key: "clients.errors.invalid" };
    try {
      await tenantQuery(async (tx) => {
        const done = await tx.delete(clientSites).where(eq(clientSites.id, siteId.data)).returning({ id: clientSites.id });
        if (done.length !== 1) throw new ActionError("clients.errors.notFound");
        await auditClient(tx, me, "client_site.delete", "client_site", siteId.data);
      });
    } catch (err) {
      if (pgErrorCode(err) === FK_VIOLATION) return { status: "error", key: "clients.errors.inUse" };
      throw err;
    }
    to = `/clients/${companyId.data}`;
    return { status: "success", key: "clients.deleted" };
  });
  if (to) {
    revalidatePath("/clients");
    redirect(to);
  }
  return res;
}

// ---------------------------------------------------------------------------------------------- PIC

export async function saveContact(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const siteId = uuid.safeParse(formData.get("siteId"));
    const contactId = formData.get("contactId") ? uuid.safeParse(formData.get("contactId")) : null;
    const parsed = parse(CONTACT_FIELDS, formData);
    if (!siteId.success || (contactId && !contactId.success) || !parsed.success) return { status: "error", key: "clients.errors.invalid" };
    const values = parsed.data as Values;
    await tenantQuery(async (tx) => {
      if (contactId?.success) {
        const [before] = await tx.select().from(clientSiteContacts).where(and(eq(clientSiteContacts.id, contactId.data), eq(clientSiteContacts.siteId, siteId.data)));
        if (!before) throw new ActionError("clients.errors.notFound");
        const done = await tx.update(clientSiteContacts).set(values).where(eq(clientSiteContacts.id, contactId.data)).returning({ id: clientSiteContacts.id });
        if (done.length !== 1) throw new ActionError("clients.errors.forbidden");
        const changed = changedFields(CONTACT_FIELDS, before, values);
        if (changed.length) await auditClient(tx, me, "client_contact.update", "client_site_contact", contactId.data, changed);
      } else {
        const [site] = await tx.select({ id: clientSites.id }).from(clientSites).where(eq(clientSites.id, siteId.data));
        if (!site) throw new ActionError("clients.errors.notFound");
        const [row] = await tx.insert(clientSiteContacts).values({ ...(values as object), orgId: me.organizationId, siteId: siteId.data } as typeof clientSiteContacts.$inferInsert).returning({ id: clientSiteContacts.id });
        await auditClient(tx, me, "client_contact.create", "client_site_contact", row.id, filled(CONTACT_FIELDS, values));
      }
    });
    revalidatePath(`/clients/${formData.get("companyId")}/sites/${siteId.data}`);
    return { status: "success", key: "clients.saved" };
  });
}

export async function setContactActive(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    const contactId = uuid.safeParse(formData.get("contactId"));
    if (!contactId.success) return { status: "error", key: "clients.errors.invalid" };
    const active = formData.get("active") === "true";
    await tenantQuery(async (tx) => {
      const done = await tx.update(clientSiteContacts).set({ active }).where(eq(clientSiteContacts.id, contactId.data)).returning({ id: clientSiteContacts.id });
      if (done.length !== 1) throw new ActionError("clients.errors.notFound");
      await auditClient(tx, me, active ? "client_contact.activate" : "client_contact.deactivate", "client_site_contact", contactId.data);
    });
    revalidatePath(`/clients/${formData.get("companyId")}/sites/${formData.get("siteId")}`);
    return { status: "success", key: active ? "clients.activated" : "clients.deactivated" };
  });
}

export async function deleteContact(_prev: FormState, formData: FormData): Promise<FormState> {
  return guarded(async () => {
    const me = await requireTskAction();
    requireAdminAction(me);
    const contactId = uuid.safeParse(formData.get("contactId"));
    if (!contactId.success) return { status: "error", key: "clients.errors.invalid" };
    await tenantQuery(async (tx) => {
      const done = await tx.delete(clientSiteContacts).where(eq(clientSiteContacts.id, contactId.data)).returning({ id: clientSiteContacts.id });
      if (done.length !== 1) throw new ActionError("clients.errors.notFound");
      await auditClient(tx, me, "client_contact.delete", "client_site_contact", contactId.data);
    });
    revalidatePath(`/clients/${formData.get("companyId")}/sites/${formData.get("siteId")}`);
    return { status: "success", key: "clients.deleted" };
  });
}
