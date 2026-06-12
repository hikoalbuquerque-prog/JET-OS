// Zone analytics — point-in-polygon para estatísticas por zona
// Portado do V2 zone-analytics.ts (Supabase→Firestore)
// Depende de: bike-classify.ts, parking-colors.ts

import { classifyBike, BikeForClassify } from './bike-classify';

function isOperational(st: string): boolean {
  return st !== 'oficina' && st !== 'apreendidos';
}
import { colorForParking, ParkingForColor } from './parking-colors';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ZonePolygon {
  id: string;
  nome: string;
  cor?: string;
  // GeoJSON ring [[lng,lat],[lng,lat],...]
  coordenadas: [number, number][];
}

export interface ParkingPoint extends ParkingForColor {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  availableCount?: number;
}

export interface BikePoint extends BikeForClassify {
  id: string;
  location_lat: number;
  location_lng: number;
  parking_id?: string | null;
}

export interface EmptyPointRef {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface ZoneStats {
  zoneId: string;
  zoneName: string;
  parkingsTotal: number;
  monitorTotal: number;
  monitorEmpty: number;   // monitores sem bike disponível
  pontosEmpty: number;    // todos os pontos sem bike
  bikesTotal: number;
  bikesAvailable: number;
  bikesRenting: number;
  bikesReserved: number;
  bikesUnavailable: number;
  bikesOutOfParking: number;
  efficiencyPct: number;  // (monitorWithBikes / monitorTotal) * 100
  emptyMonitors: EmptyPointRef[];
  redPoints: EmptyPointRef[];
}

// ─── Ray-casting point-in-polygon ──────────────────────────────────────────── 

export function isInsidePolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]; // [lng, lat]
    const [xj, yj] = ring[j];
    // lat = y, lng = x
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── Cálculo principal ────────────────────────────────────────────────────────

export function computeZoneAnalytics(
  zones: ZonePolygon[],
  parkings: ParkingPoint[],
  bikes: BikePoint[],
): ZoneStats[] {
  return zones.map(zone => {
    const zoneParkings = parkings.filter(p =>
      isInsidePolygon(p.latitude, p.longitude, zone.coordenadas)
    );
    const zoneBikes = bikes.filter(b =>
      isInsidePolygon(b.location_lat, b.location_lng, zone.coordenadas)
    );

    const monitorParkings = zoneParkings.filter(p => p.monitor);
    const monitorEmpty    = monitorParkings.filter(p => (p.availableCount ?? 0) === 0);
    const pontosEmpty     = zoneParkings.filter(p => (p.availableCount ?? 0) === 0);

    let bikesAvailable = 0, bikesRenting = 0, bikesReserved = 0, bikesUnavailable = 0, bikesOutOfParking = 0;
    for (const b of zoneBikes) {
      const st = classifyBike(b);
      if (!isOperational(st)) { bikesUnavailable++; continue; }
      if (st === 'available')   bikesAvailable++;
      else if (st === 'renting') bikesRenting++;
      else if (st === 'reserved') bikesReserved++;
      else bikesUnavailable++;
      if (!b.parking_id) bikesOutOfParking++;
    }

    const efficiencyPct = monitorParkings.length > 0
      ? Math.round(((monitorParkings.length - monitorEmpty.length) / monitorParkings.length) * 100)
      : 100;

    const emptyMonitors: EmptyPointRef[] = monitorEmpty.map(p => ({
      id: p.id, name: p.name, lat: p.latitude, lng: p.longitude,
    }));

    const redPoints: EmptyPointRef[] = zoneParkings
      .filter(p => colorForParking(p) === 'red')
      .map(p => ({ id: p.id, name: p.name, lat: p.latitude, lng: p.longitude }));

    return {
      zoneId: zone.id,
      zoneName: zone.nome,
      parkingsTotal: zoneParkings.length,
      monitorTotal: monitorParkings.length,
      monitorEmpty: monitorEmpty.length,
      pontosEmpty: pontosEmpty.length,
      bikesTotal: zoneBikes.length,
      bikesAvailable,
      bikesRenting,
      bikesReserved,
      bikesUnavailable,
      bikesOutOfParking,
      efficiencyPct,
      emptyMonitors,
      redPoints,
    };
  });
}

/** Computa stats globais agregando todas as zonas */
export function aggregateStats(zoneStats: ZoneStats[]) {
  return zoneStats.reduce((acc, z) => ({
    parkingsTotal:    acc.parkingsTotal    + z.parkingsTotal,
    monitorTotal:     acc.monitorTotal     + z.monitorTotal,
    monitorEmpty:     acc.monitorEmpty     + z.monitorEmpty,
    bikesTotal:       acc.bikesTotal       + z.bikesTotal,
    bikesAvailable:   acc.bikesAvailable   + z.bikesAvailable,
    bikesRenting:     acc.bikesRenting     + z.bikesRenting,
    bikesReserved:    acc.bikesReserved    + z.bikesReserved,
    bikesUnavailable: acc.bikesUnavailable + z.bikesUnavailable,
    efficiencyPct:    0, // calculado separado
  }), {
    parkingsTotal: 0, monitorTotal: 0, monitorEmpty: 0,
    bikesTotal: 0, bikesAvailable: 0, bikesRenting: 0,
    bikesReserved: 0, bikesUnavailable: 0, efficiencyPct: 0,
  });
}
