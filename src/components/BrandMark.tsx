export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 text-2xl" : "h-8 w-8 text-base";
  return (
    <span
      aria-hidden
      className={`inline-flex ${box} items-center justify-center rounded-lg bg-brand-600 font-semibold text-white`}
    >
      橋
    </span>
  );
}
