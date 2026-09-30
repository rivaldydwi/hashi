import type { OrgType, Role } from "@/db/schema";

/** Peran yang boleh dimiliki pengguna, per jenis organisasi. Sama dengan trigger di database. */
export const ROLES_BY_ORG_TYPE: Record<OrgType, readonly Role[]> = {
  PLATFORM: ["SUPER_ADMIN"],
  LPK: ["LPK_ADMIN", "LPK_SENSEI"],
  TSK: ["TSK_ADMIN", "TSK_STAFF"],
};

/** Peran admin utama tiap jenis organisasi (dipakai saat membuat organisasi baru). */
export const ADMIN_ROLE_BY_ORG_TYPE: Record<OrgType, Role> = {
  PLATFORM: "SUPER_ADMIN",
  LPK: "LPK_ADMIN",
  TSK: "TSK_ADMIN",
};

const ADMIN_ROLES: readonly Role[] = ["SUPER_ADMIN", "LPK_ADMIN", "TSK_ADMIN"];

export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export function roleAllowedFor(orgType: OrgType, role: Role): boolean {
  return ROLES_BY_ORG_TYPE[orgType].includes(role);
}
