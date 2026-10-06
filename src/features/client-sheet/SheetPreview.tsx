import type { Sheet } from "@/lib/pdf/client-sheet-model";

/** Pratinjau isi lembar di layar: dari model YANG SAMA dengan PDF (pratinjau = isi PDF). Isi dokumen selalu Jepang (lang="ja"). */
export function SheetPreview({ sheet }: { sheet: Sheet }) {
  const th = "w-40 bg-page px-2 py-1.5 text-left align-top text-xs font-semibold";
  const td = "whitespace-pre-wrap break-words px-2 py-1.5 align-top text-sm";
  return (
    <article lang="ja" className="space-y-3 rounded-lg border border-line bg-white p-4 text-ink" data-testid="sheet-preview" data-mode={sheet.mode} data-lang={sheet.lang}>
      <p className="text-xs text-ink-2" data-testid="sheet-badge">{sheet.badge}</p>
      <h3 className="text-base font-semibold" data-testid="sheet-title">{sheet.title}</h3>
      {sheet.subtitle && <p className="text-xs text-ink-2">{sheet.subtitle}</p>}
      {sheet.sections.map((s) => (
        <section key={s.id} data-testid={`sheet-section-${s.id}`} className="space-y-1.5">
          <h4 className="text-sm font-semibold">{s.heading}</h4>
          {s.kind === "kv" && (
            <table className="w-full border-collapse border border-line"><tbody>
              {s.rows.map(([k, v], i) => (<tr key={i} className="border-b border-line"><th scope="row" className={th}>{k}</th><td className={td}>{v}</td></tr>))}
            </tbody></table>
          )}
          {s.kind === "text" && <p className="whitespace-pre-wrap text-sm">{s.text}</p>}
          {s.kind === "blocks" && s.blocks.map((b, bi) => (
            <div key={bi} className="space-y-1" data-testid="sheet-block">
              <p className="text-sm font-medium">{b.heading}</p>
              {b.rows.length > 0 && (
                <table className="w-full border-collapse border border-line"><tbody>
                  {b.rows.map(([k, v], i) => (<tr key={i} className="border-b border-line"><th scope="row" className={th}>{k}</th><td className={td}>{v}</td></tr>))}
                </tbody></table>
              )}
            </div>
          ))}
          {s.kind === "table" && (
            <div className="overflow-x-auto"><table className="w-full min-w-[32rem] border-collapse border border-line">
              <thead><tr>{s.cols.map((c, i) => (<th key={i} scope="col" className={th.replace("w-40 ", "")}>{c.header}</th>))}</tr></thead>
              <tbody>{s.rows.map((r, ri) => (<tr key={ri} className="border-b border-line" data-testid="sheet-opening-row">{r.map((c, ci) => (<td key={ci} className={td}>{c}</td>))}</tr>))}</tbody>
            </table></div>
          )}
        </section>
      ))}
    </article>
  );
}
