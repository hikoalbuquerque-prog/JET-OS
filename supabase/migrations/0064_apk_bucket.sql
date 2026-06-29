-- Create public storage bucket for APK hosting
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'apk',
  'apk',
  true,
  104857600,  -- 100 MB
  ARRAY['application/vnd.android.package-archive', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Allow anonymous downloads (public read)
CREATE POLICY "apk_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'apk');
