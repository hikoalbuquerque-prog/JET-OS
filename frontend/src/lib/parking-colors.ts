// Regras de cor dos pontos GoJet — espelha lógica V2 colors.ts
// Baseado na razão available / target_bikes_count

export type ParkingColor = 'red' | 'orange' | 'yellow' | 'blue' | 'green' | 'gray';

export const PARKING_COLOR_HEX: Record<ParkingColor, string> = {
  red:    '#e23b3b',
  orange: '#ef8a2a',
  yellow: '#f5c518',
  blue:   '#3b82f6',
  green:  '#22c55e',
  gray:   '#9ca3af',
};

export const PARKING_COLOR_LABEL: Record<ParkingColor, string> = {
  red:    'Zerado',
  orange: 'Abaixo do target',
  yellow: 'Próximo do target',
  blue:   'No target',
  green:  'Excesso',
  gray:   'Sem target / N-Monitor',
};

export interface ParkingForColor {
  monitor?: boolean;
  target_bikes_count?: number;
  availableCount?: number;
  bikes_count?: number;
}

/** Retorna a cor do ponto baseada na razão available/target */
export function colorForParking(p: ParkingForColor): ParkingColor {
  if (!p.monitor) return 'gray';
  const target = p.target_bikes_count ?? 0;
  if (!target) return 'gray';
  const available = p.availableCount ?? p.bikes_count ?? 0;
  const ratio = available / target;
  if (available === 0)   return 'red';
  if (ratio < 0.50)      return 'orange';
  if (ratio < 0.85)      return 'yellow';
  if (ratio < 1.20)      return 'blue';
  return 'green';
}

export function isPriority(color: ParkingColor): boolean {
  return color === 'red' || color === 'orange';
}

/** Nível de urgência numérico (para sort) */
export function urgencyLevel(color: ParkingColor): number {
  const MAP: Record<ParkingColor, number> = {
    red: 5, orange: 4, yellow: 3, blue: 2, green: 1, gray: 0,
  };
  return MAP[color];
}
