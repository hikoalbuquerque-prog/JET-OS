// app-utils.ts — shared utility functions and constants extracted from App.tsx

// Sanitizes photo URLs — filters Drive/Google URLs that cause CORS/403 errors
export function sanitizarFotoUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.includes('drive.google.com')) return null;
  return url;
}

export function fixDriveUrl(url: string): string {
  if (!url) return '';
  const m = url.match(/\/d\/([^/?]+)/);
  if (m && url.includes('drive.google.com')) {
    return 'https://lh3.googleusercontent.com/d/' + m[1];
  }
  return url;
}

// Calculates polygon area in km² (Shoelace formula with geographic coords)
export function calcAreaKm2(pontos: { lat: number; lng: number }[]): number {
  if (pontos.length < 3) return 0;
  const R = 6371; // Earth radius in km
  let area = 0;
  const n = pontos.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = pontos[i].lat * Math.PI / 180;
    const lat2 = pontos[j].lat * Math.PI / 180;
    const dLng = (pontos[j].lng - pontos[i].lng) * Math.PI / 180;
    area += (dLng) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R * R / 2);
}

// Point-in-polygon (ray casting)
export function pontoNoPoli(lat: number, lng: number, pontos: { lat: number; lng: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const xi = pontos[i].lat, yi = pontos[i].lng;
    const xj = pontos[j].lat, yj = pontos[j].lng;
    if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

// City coordinates for map centering
export const COORDS_CIDADES: Record<string, [number, number]> = {
  'São Paulo':              [-23.5505, -46.6333],
  'Curitiba':               [-25.4284, -49.2733],
  'Rio de Janeiro':         [-22.9068, -43.1729],
  'Belo Horizonte':         [-19.9191, -43.9386],
  'Porto Alegre':           [-30.0346, -51.2177],
  'Fortaleza':              [-3.7172,  -38.5433],
  'Recife':                 [-8.0476,  -34.8770],
  'Salvador':               [-12.9714, -38.5014],
  'Manaus':                 [-3.1190,  -60.0217],
  'Brasília':               [-15.7801, -47.9292],
  'Osasco':                 [-23.5329, -46.7919],
  'Guarulhos':              [-23.4543, -46.5338],
  'Campinas':               [-22.9099, -47.0626],
  'São Bernardo do Campo':  [-23.6939, -46.5650],
  'Ciudad de México':       [19.4326,  -99.1332],
  'Guadalajara':            [20.6597,  -103.3496],
  'Monterrey':              [25.6866,  -100.3161],
  'Puebla':                 [19.0414,  -98.2063],
  'Tijuana':                [32.5149,  -117.0382],
  'León':                   [21.1221,  -101.6822],
  'Mérida':                 [20.9674,  -89.5926],
  'Zapopan':                [20.7214,  -103.3907],
  'San Luis Potosí':        [22.1565,  -100.9855],
  'Aguascalientes':         [21.8853,  -102.2916],
  'Medellín':               [6.2476,   -75.5658],
  'Bogotá':                 [4.7110,   -74.0721],
  'Santiago':               [-33.4489, -70.6693],
};

// Available cities by country
export const CIDADES: Record<string, string[]> = {
  BR: ['São Paulo','Curitiba','Rio de Janeiro','Belo Horizonte','Porto Alegre','Fortaleza','Recife','Salvador','Manaus','Brasília','Osasco','Guarulhos','Campinas','São Bernardo do Campo'],
  MX: ['Ciudad de México','Guadalajara','Monterrey','Puebla','Tijuana','León','Mérida','Zapopan','San Luis Potosí','Aguascalientes'],
  CO: ['Medellín','Bogotá'],
  CL: ['Santiago']
};

// Shared Estacao interface
export interface Estacao {
  id: string; codigo: string; lat: number; lng: number;
  cidade: string; bairro: string; endereco: string;
  tipo: string; status: string; pais: string;
  operador?: string;
  consultor?: string;
  larguraFaixa?: number;
  imagens?: { streetView?: string; croqui?: string; foto?: string };
  ia?: { aprovado: boolean; score: number; confianca: string; largura: string; motivo: string };
  croquiStatus: string;
  privado?: {
    nomeLocal?: string; nomeAutorizante?: string; cargoAutorizante?: string;
    telefone?: string; email?: string; assinatura?: string;
  };
}

// Shared Usuario interface
export interface Usuario {
  uid: string
  email: string
  nome: string
  role: string
  paises: string[]
  cidadesPermitidas?: string[]
  cidadesGerenciaLog?: string[]
  cargoPrestador?: string
  tipoCadastro?: string
  statusPrestador?: string
  cidade?: string
}
