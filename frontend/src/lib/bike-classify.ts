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
  last_order_at?: string | null;
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

/** Verifica se bike está ociosa (sem aluguel) há mais de N horas */
export function isBikeIdleOverHours(b: BikeForClassify, hours: number, now = Date.now()): boolean {
  const sub = (b.business_sub_status ?? '').toLowerCase();
  const status = (b.business_status ?? '').toLowerCase();
  if (sub.includes('rent') || status.includes('rent')) return false;

  if (!b.last_order_at) return true;
  const lastMs = new Date(b.last_order_at).getTime();
  if (!Number.isFinite(lastMs)) return true;
  return (now - lastMs) > hours * 3_600_000;
}

/** Conta bikes por status, separando operacionais de oficina/apreendidos */
export function computeFleetStats(bikes: BikeForClassify[]) {
  let total = 0, available = 0, renting = 0, reserved = 0,
      maintenance = 0, lowBattery = 0, oficina = 0, apreendidos = 0,
      outOfParking = 0, outOfParkingAvailable = 0, idle48h = 0;
  const now = Date.now();

  for (const b of bikes) {
    total++;
    const st = classifyBike(b);
    switch (st) {
      case 'available':   available++; break;
      case 'renting':     renting++; break;
      case 'reserved':    reserved++; break;
      case 'maintenance': maintenance++; break;
      case 'low_battery': lowBattery++; break;
      case 'oficina':     oficina++; break;
      case 'apreendidos': apreendidos++; break;
    }

    const bAny = b as any;
    if (!bAny.parking_id) {
      outOfParking++;
      if (st === 'available' || st === 'low_battery') outOfParkingAvailable++;
    }

    if (st !== 'oficina' && st !== 'apreendidos' && isBikeIdleOverHours(b, 48, now)) {
      idle48h++;
    }
  }

  const operational = total - oficina - apreendidos;
  return {
    total, operational, available, renting, reserved,
    maintenance, lowBattery, oficina, apreendidos,
    outOfParking, outOfParkingAvailable, idle48h,
  };
}

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
