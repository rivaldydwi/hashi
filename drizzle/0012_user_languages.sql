-- Bahasa yang dikuasai pengguna (boleh lebih dari satu). `locale` tetap bahasa tampilan (id/ja).
CREATE TYPE "public"."language" AS ENUM('id', 'ja', 'en');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "languages" "language"[] DEFAULT ARRAY['id']::language[] NOT NULL;--> statement-breakpoint

-- Isi dari locale yang ada: id -> {id}, ja -> {ja}
UPDATE "users" SET "languages" = ARRAY["locale"::text::language];--> statement-breakpoint

-- Syarat: minimal satu elemen, tanpa NULL, tanpa duplikat (fungsi, karena CHECK tidak boleh berisi subquery)
CREATE OR REPLACE FUNCTION language_array_ok(arr language[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT arr IS NOT NULL
     AND cardinality(arr) >= 1
     AND array_position(arr, NULL) IS NULL
     AND cardinality(arr) = cardinality(ARRAY(SELECT DISTINCT e FROM unnest(arr) AS e))
$$;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_languages_check" CHECK (language_array_ok("users"."languages"));
