import type { DefaultSession } from "next-auth";
import type { Locale, Role } from "@/db/schema";

type OrgType = "PLATFORM" | "LPK" | "TSK";

interface HashiUserFields {
  role: Role;
  locale: Locale;
  organizationId: string;
  organizationType: OrgType;
  organizationName: string;
}

declare module "next-auth" {
  interface User extends HashiUserFields {}

  interface Session {
    user: HashiUserFields & { id: string; loginAt?: number } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT extends HashiUserFields {
    loginAt?: number;
  }
}
