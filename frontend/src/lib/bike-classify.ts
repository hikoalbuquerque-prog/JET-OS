// frontend/src/lib/bike-classify.ts
// Classificação de bike — campos confirmados pela API GoJet (02/06/2026)
// Campos reais: business_status, business_sub_status, disabled, ordered,
//               booked, service_mode, battery_percent, identifier

export type BikeStatus =
  | 'available'    // 🟢 disponível para aluguel
  | 'renting'      // 🟡 em uso ativo pelo cliente
  | 'reserved'     // ⚫ reservada
  | 'maintenance'  // 🔴 manutenção / desabilitada
  | 'low_battery'  // 🟠 bateria baixa (< 20%)
  | 'oficina'      // 🟣 em área de oficina
  | 'apreendidos'; // 🟥 em área de apreensão

export interface BikeForClassify {
  business_status?:     string;
  business_sub_status?: string;
  disabled?:     boolean;
  ordered?:      boolean;
  booked?:       boolean;
  service_mode?: boolean;
  battery_percent?: number;
}

export function classifyBike(b: BikeForClassify): BikeStatus {
  const sub    = (b.business_sub_status ?? '').toLowerCase();
  const status = (b.business_status    ?? '').toLowerCase();

  // Em uso ativo
  if (sub.includes('rent') || status.includes('rent')) return 'renting';

  // Reservada
  if (b.ordered === true || b.booked === true) return 'reserved';

  // Manutenção / desabilitada
  if (b.disabled === true || b.service_mode === true) return 'maintenance';
  if (
    sub.includes('maintenance') ||
    sub.includes('low_battery') ||
    sub.includes('low_charge')  ||
    sub.includes('disabled')    ||
    sub.includes('inactive')    ||
    sub.includes('broken')
  ) return 'maintenance';

  // Disponível — "OperationAvailable" é o valor real da API
  if (
    sub.includes('available') ||
    sub === 'operationavailable'
  ) {
    // Bateria baixa = disponível mas precisa de charger urgente
    if (typeof b.battery_percent === 'number' && b.battery_percent < 0.20) {
      return 'low_battery';
    }
    return 'available';
  }

  // Fallback
  return 'available';
}

export const BIKE_STATUS_HEX: Record<BikeStatus, string> = {
  available:   '#22c55e',
  renting:     '#f5c518',
  reserved:    '#9ca3af',
  maintenance: '#ef4444',
  low_battery: '#f97316',
  oficina:     '#a855f7',
  apreendidos: '#dc2626',
};

export const BIKE_STATUS_LABEL: Record<BikeStatus, string> = {
  available:   'Disponível',
  renting:     'Em aluguel',
  reserved:    'Reservado',
  maintenance: 'Manutenção',
  low_battery: 'Bateria baixa',
  oficina:     'Em oficina',
  apreendidos: 'Apreendido',
};

/** Converte battery_percent (0-1) para string legível */
export function formatBattery(pct?: number): string {
  if (pct === undefined || pct === null) return '—';
  return `${Math.round(pct * 100)}%`;
}

/** Cor da bateria por nível */
export function batteryColor(pct?: number): string {
  if (!pct && pct !== 0) return '#6b7280';
  if (pct < 0.20) return '#ef4444';
  if (pct < 0.40) return '#f97316';
  if (pct < 0.60) return '#f5c518';
  return '#22c55e';
}
