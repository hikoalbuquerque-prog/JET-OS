-- O1: Handoff entre turnos
ALTER TABLE tarefas_logistica
  ADD COLUMN IF NOT EXISTS handoff_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime BOOLEAN NOT NULL DEFAULT false;

-- O3: Registro climático
ALTER TABLE tarefas_logistica
  ADD COLUMN IF NOT EXISTS pausado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_pausa TEXT,
  ADD COLUMN IF NOT EXISTS clima_registro JSONB;
