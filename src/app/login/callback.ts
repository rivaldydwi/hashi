/** Tujuan setelah login: hanya jalur relatif satu situs ("/candidates?x=1"). Tolak "//host", "/\\host", skema, dan jalur /login atau /logout (mencegah open redirect dan putaran). */
export function safeCallbackPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const v = value.trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v)) return "/";
  if (/^\/(login|logout)(\/|\?|$)/.test(v)) return "/";
  return v.length > 500 ? "/" : v;
}
