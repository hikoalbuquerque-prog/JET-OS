-- Colunas de slot que o aceitarSlot espera e que podem não existir ainda
ALTER TABLE public.slots ADD COLUMN IF NOT EXISTS titulo text;
ALTER TABLE public.slots ADD COLUMN IF NOT EXISTS cargo text;
ALTER TABLE public.slots ADD COLUMN IF NOT EXISTS turno_inicio timestamptz;
ALTER TABLE public.slots ADD COLUMN IF NOT EXISTS turno_fim timestamptz;
ALTER TABLE public.slots ADD COLUMN IF NOT EXISTS zona text;
ALTER TABLE public.slots ADD COLUMN IF NOT EXISTS tipo_slot text;
ALTER TABLE public.slots ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();

-- cargo_prestador na tabela usuarios (Firestore: cargoPrestador)
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS cargo_prestador text;
