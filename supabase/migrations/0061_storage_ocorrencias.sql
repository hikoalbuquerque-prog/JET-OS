-- 0061 — Bucket dedicado "ocorrencias" no Supabase Storage.
-- Separar do bucket genérico "uploads" para controle fino de políticas,
-- ciclo de vida e futura CDN/transformação de imagem.

INSERT INTO storage.buckets (id, name, public)
VALUES ('ocorrencias', 'ocorrencias', true)
ON CONFLICT (id) DO NOTHING;

-- Qualquer autenticado pode fazer upload
CREATE POLICY "ocorrencias_upload_auth" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ocorrencias');

-- Leitura pública (fotos exibidas no app sem auth header)
CREATE POLICY "ocorrencias_read_public" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'ocorrencias');

-- service_role acesso total (backfill, migração)
CREATE POLICY "ocorrencias_service_manage" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'ocorrencias');
