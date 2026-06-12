// src/EstacoesCampo.tsx - Stub temporário (VERSÃO COMPILÁVEL)
// Substitua pelo TelaMapa completo quando tiver tempo

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { auth, db } from './lib/firebase';
import 'leaflet/dist/leaflet.css';

interface Usuario {
  uid: string;
  email: string;
  nome: string;
  role: string;
  paises: string[];
  cidadesPermitidas?: string[];
}

interface Props {
  usuario: Usuario;
  onLogout: () => void;
}

export default function EstacoesCampo({ usuario, onLogout }: Props) {
  const { t } = useTranslation();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const [estacoes, setEstacoes] = useState<any[]>([]);

  useEffect(() => {
    // Inicializar mapa
    if (mapRef.current && !leafletRef.current) {
      const map = L.map(mapRef.current).setView([-23.5505, -46.6333], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);
      leafletRef.current = map;
    }
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#0f172a',
        color: 'white',
        padding: '16px 24px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>🗺️ Estações Campo</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
            {usuario.nome} ({usuario.role})
          </p>
        </div>
        <button
          onClick={onLogout}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Logout
        </button>
      </div>

      {/* Mapa */}
      <div ref={mapRef} style={{ flex: 1 }} />

      {/* Footer Info */}
      <div style={{
        backgroundColor: '#1e293b',
        color: '#94a3b8',
        padding: '12px 24px',
        fontSize: '12px',
        borderTop: '1px solid rgba(255,255,255,0.1)'
      }}>
        ⚠️ Esta é uma versão compilável temporária. Para usar a versão completa com todas as funções, integre o TelaMapa do App.tsx original.
      </div>
    </div>
  );
}
