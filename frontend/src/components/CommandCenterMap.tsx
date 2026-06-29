import { useEffect, useRef } from 'react';
import L from 'leaflet';

interface MapParking {
  id: string;
  nome: string;
  lat: number;
  lng: number;
  bikes_count: number;
  target: number | null;
  is_monitor: boolean;
  zona?: string;
}

interface MapScout {
  uid: string;
  nome: string;
  lat: number;
  lng: number;
  status: string;
}

interface MapTarefa {
  id: string;
  lat: number;
  lng: number;
  titulo: string;
  rota_osrm?: string | null;
  slaRatio?: number; // 0=on time, 1=at SLA, >1=overdue, >3=critical
}

interface Props {
  parkings: MapParking[];
  scouts?: MapScout[];
  tarefas?: MapTarefa[];
  center?: [number, number];
}

function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export default function CommandCenterMap({ parkings, scouts, tarefas, center }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const defaultCenter = center || [-23.55, -46.63];
    const map = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    mapInstance.current = map;
    layerGroup.current = L.layerGroup().addTo(map);

    return () => { map.remove(); mapInstance.current = null; };
  }, []);

  useEffect(() => {
    if (!mapInstance.current || !layerGroup.current) return;
    const lg = layerGroup.current;
    lg.clearLayers();

    // Parkings
    for (const p of parkings) {
      if (!p.lat || !p.lng) continue;
      const isEmpty = p.bikes_count === 0;
      const limit = p.is_monitor ? (p.target ?? 3) : 3;
      const isExcess = p.bikes_count > limit;
      const color = isEmpty ? '#ef4444' : isExcess ? '#f59e0b' : '#22c55e';
      const radius = p.is_monitor ? 6 : 4;

      L.circleMarker([p.lat, p.lng], {
        radius,
        fillColor: color,
        fillOpacity: 0.8,
        color: color,
        weight: 1,
      }).bindTooltip(`${p.nome}\n${p.bikes_count} bikes${p.target ? ` / meta ${p.target}` : ''}`, {
        className: 'cc-tooltip',
      }).addTo(lg);
    }

    // Scouts
    for (const s of (scouts ?? [])) {
      if (!s.lat || !s.lng) continue;
      const color = s.status === 'em_tarefa' ? '#3b82f6' : '#6b7280';
      L.circleMarker([s.lat, s.lng], {
        radius: 7,
        fillColor: color,
        fillOpacity: 0.9,
        color: '#fff',
        weight: 2,
      }).bindTooltip(`👤 ${s.nome} (${s.status})`, { className: 'cc-tooltip' }).addTo(lg);
    }

    // Tarefas com rotas OSRM + SLA visual
    for (const t of (tarefas ?? [])) {
      if (!t.lat || !t.lng) continue;
      const sla = t.slaRatio ?? 0;
      const slaClass = sla > 3 ? 'cc-sla-critical' : sla > 1 ? 'cc-sla-warn' : '';
      const emoji = sla > 3 ? '🔴' : sla > 1 ? '🟡' : '🎯';
      L.marker([t.lat, t.lng], {
        icon: L.divIcon({
          html: `<span class="${slaClass}">${emoji}</span>`,
          className: 'cc-task-icon',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).bindTooltip(`${t.titulo}${sla > 1 ? ` · SLA ${Math.round(sla)}×` : ''}`, { className: 'cc-tooltip' }).addTo(lg);

      if (t.rota_osrm) {
        try {
          const points = decodePolyline(t.rota_osrm);
          L.polyline(points, { color: '#8b5cf6', weight: 3, opacity: 0.7, dashArray: '8 4' }).addTo(lg);
        } catch { /* invalid polyline */ }
      }
    }

    // Fit bounds
    const allPoints: [number, number][] = [
      ...parkings.filter(p => p.lat && p.lng).map(p => [p.lat, p.lng] as [number, number]),
      ...(scouts ?? []).filter(s => s.lat && s.lng).map(s => [s.lat, s.lng] as [number, number]),
    ];
    if (allPoints.length > 1) {
      mapInstance.current!.fitBounds(L.latLngBounds(allPoints), { padding: [20, 20] });
    }
  }, [parkings, scouts, tarefas]);

  return (
    <>
      <style>{`
        .cc-tooltip { background: #1a1f2e !important; border: 1px solid rgba(255,255,255,.1) !important;
          color: #dce8ff !important; font-size: 10px !important; border-radius: 6px !important;
          padding: 4px 8px !important; box-shadow: 0 4px 12px rgba(0,0,0,.4) !important; }
        .cc-tooltip::before { border-top-color: #1a1f2e !important; }
        .cc-task-icon { background: none !important; border: none !important; font-size: 14px; }
        .cc-sla-warn { animation: ccPulse 1.5s ease-in-out infinite; }
        .cc-sla-critical { animation: ccPulse 0.6s ease-in-out infinite; }
        @keyframes ccPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }
      `}</style>
      <div ref={mapRef} style={{ width: '100%', height: 300, borderRadius: 10, overflow: 'hidden' }} />
    </>
  );
}
