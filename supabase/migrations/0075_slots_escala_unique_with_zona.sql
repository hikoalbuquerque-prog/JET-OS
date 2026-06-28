-- Add zona to unique constraint so different zones don't conflict
drop index if exists uq_slotsesc_natural;
create unique index uq_slotsesc_natural on slots_escala (cidade, data_slot, turno, tipo, zona);
