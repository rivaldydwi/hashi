import { pingDb } from "@/db";

export const dynamic = "force-dynamic";

// Dipakai healthcheck Docker dan monitoring uptime.
export async function GET() {
  try {
    await pingDb();
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
