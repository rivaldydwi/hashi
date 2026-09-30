import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit (generate/studio) selalu memakai role OWNER.
// Aplikasi yang berjalan memakai role terbatas `hashi_app` (lihat src/db/index.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.MIGRATE_DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
