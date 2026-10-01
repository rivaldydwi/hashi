"use client";

import { createContext, useContext } from "react";

export type SkillFieldOption = { id: string; code: string; label: string; active: boolean };

const Ctx = createContext<SkillFieldOption[]>([]);

/** Pilihan bidang kerja untuk form (client) tanpa menurunkan props lewat banyak komponen. Diisi layout aplikasi. */
export function SkillFieldsProvider({ options, children }: { options: SkillFieldOption[]; children: React.ReactNode }) {
  return <Ctx.Provider value={options}>{children}</Ctx.Provider>;
}
export const useSkillFieldOptions = () => useContext(Ctx);
