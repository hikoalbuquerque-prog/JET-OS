-- PostgREST on_conflict requires a UNIQUE CONSTRAINT, not just a UNIQUE INDEX.
-- Replace the index from 0075 with a proper constraint.
drop index if exists uq_slotsesc_natural;
alter table slots_escala
  add constraint uq_slotsesc_natural unique (cidade, data_slot, turno, tipo, zona);
