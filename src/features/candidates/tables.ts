import {
  candidateCertificates,
  candidateEducations,
  candidateFamilyMembers,
  candidateWorkHistories,
} from "@/db/schema";

// Tabel dinamis untuk bagian berbaris banyak. Nama kolom di definisi bagian (sections.ts) = nama properti tabel Drizzle.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const LIST_TABLES: Record<string, any> = {
  candidate_family_members: candidateFamilyMembers,
  candidate_educations: candidateEducations,
  candidate_work_histories: candidateWorkHistories,
  candidate_certificates: candidateCertificates,
};
