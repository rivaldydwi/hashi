"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { signIn } from "@/auth";
import { safeCallbackPath } from "./callback";

export type LoginState = { error?: "invalid" | "rateLimited" } | undefined;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safeCallbackPath(formData.get("callbackUrl")), // hanya jalur relatif satu situs; selain itu "/"
    });
  } catch (err) {
    if (err instanceof CredentialsSignin && err.code === "rate_limited") return { error: "rateLimited" };
    if (err instanceof AuthError) return { error: "invalid" };
    throw err; // redirect sukses dari Next.js juga lewat sini
  }
}
