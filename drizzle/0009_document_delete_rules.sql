-- ============================================================================
-- Hashi — dokumen: siapa boleh menghapus
--
-- Sebelumnya hanya LPK_ADMIN pemilik yang boleh menghapus baris dokumen. Sekarang sama dengan aturan
-- unggah/ubah: LPK_ADMIN pemilik (semua status), atau TSK mitra HANYA jika keputusan TSK itu
-- IN (PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, DEPARTED) dan kandidat belum WITHDRAWN
-- (candidate_editable). Sensei tidak pernah. Tabel anak lain (keluarga, pendidikan, kerja,
-- sertifikat, data sensitif) tetap: TSK tidak boleh menghapus.
-- ============================================================================
DROP POLICY candidate_documents_delete ON candidate_documents;
--> statement-breakpoint
CREATE POLICY candidate_documents_delete ON candidate_documents FOR DELETE
  USING (candidate_editable(candidate_id));
