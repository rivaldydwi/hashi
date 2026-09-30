// Autentikasi (Auth.js v5): login email + kata sandi, sesi JWT 8 jam.

import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/db";
import { auditLogs, organizations, users } from "@/db/schema";
import { clearFailures, isRateLimited, recordFailure } from "@/lib/rate-limit";

class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

// Hash dummy supaya waktu respons sama untuk email yang tidak terdaftar
// (mencegah penebakan email lewat perbedaan waktu).
const DUMMY_HASH = "$2b$12$sTk665RhKYHXdUqIm7cM3uYcjb.DPzD.mKLQnzKDvQwzdj1S0IwGW";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  trustHost: true,
  logger: {
    // Salah password itu kejadian normal, tidak perlu stack trace panjang di log.
    error(error) {
      if (error instanceof CredentialsSignin || error.name === "CredentialsSignin") {
        console.warn(`[auth] login gagal (${(error as CredentialsSignin).code ?? "credentials"})`);
        return;
      }
      console.error("[auth]", error);
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { type: "email" },
        password: { type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();

        if (isRateLimited(email)) throw new RateLimited();

        const row = await withSystem(async (tx) => {
          const [found] = await tx
            .select({ user: users, org: organizations })
            .from(users)
            .innerJoin(organizations, eq(organizations.id, users.organizationId))
            .where(eq(users.email, email))
            .limit(1);
          return found;
        });

        const valid = await bcrypt.compare(parsed.data.password, row?.user.passwordHash ?? DUMMY_HASH);
        if (!row || !valid || !row.user.active) {
          recordFailure(email);
          return null;
        }
        clearFailures(email);

        await withSystem(async (tx) => {
          await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.user.id));
          await tx.insert(auditLogs).values({
            organizationId: row.org.id,
            actorUserId: row.user.id,
            action: "auth.login",
            entity: "user",
            entityId: row.user.id,
          });
        });

        return {
          id: row.user.id,
          email: row.user.email,
          name: row.user.name,
          role: row.user.role,
          locale: row.user.locale,
          organizationId: row.org.id,
          organizationType: row.org.type,
          organizationName: row.org.name,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.locale = user.locale;
        token.organizationId = user.organizationId;
        token.organizationType = user.organizationType;
        token.organizationName = user.organizationName;
        // Waktu login (milidetik). Tidak berubah saat token diperpanjang, dipakai untuk mencabut sesi.
        token.loginAt = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      session.user.role = token.role;
      session.user.locale = token.locale;
      session.user.organizationId = token.organizationId;
      session.user.organizationType = token.organizationType;
      session.user.organizationName = token.organizationName;
      session.user.loginAt = token.loginAt ?? 0;
      return session;
    },
  },
});
