import { describe, it, expect } from 'vitest';
import {
  sanitizarFotoUrl,
  fixDriveUrl,
  calcAreaKm2,
  pontoNoPoli,
  COORDS_CIDADES,
  CIDADES,
} from './app-utils';

// ─── sanitizarFotoUrl ─────────────────────────────────────────────────────────

describe('sanitizarFotoUrl', () => {
  it('retorna null para undefined/null', () => {
    expect(sanitizarFotoUrl(undefined)).toBeNull();
    expect(sanitizarFotoUrl(null)).toBeNull();
  });

  it('bloqueia URLs do Google Drive', () => {
    expect(sanitizarFotoUrl('https://drive.google.com/file/d/abc123')).toBeNull();
  });

  it('bloqueia URLs lh3.googleusercontent.com', () => {
    expect(sanitizarFotoUrl('https://lh3.googleusercontent.com/abc')).toBeNull();
  });

  it('passa URLs normais sem alteração', () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/jet-os-1/o/foto.jpg';
    expect(sanitizarFotoUrl(url)).toBe(url);
  });
});

// ─── fixDriveUrl ──────────────────────────────────────────────────────────────

describe('fixDriveUrl', () => {
  it('converte URL de visualização do Drive para URL de download direto', () => {
    const url = 'https://drive.google.com/file/d/1xyzABC/view';
    expect(fixDriveUrl(url)).toBe('https://drive.google.com/uc?export=view&id=1xyzABC');
  });

  it('retorna string vazia para input vazio', () => {
    expect(fixDriveUrl('')).toBe('');
  });

  it('não altera URLs que não são do Drive', () => {
    const url = 'https://example.com/foto.jpg';
    expect(fixDriveUrl(url)).toBe(url);
  });
});

// ─── calcAreaKm2 ──────────────────────────────────────────────────────────────

describe('calcAreaKm2', () => {
  it('retorna 0 para menos de 3 pontos', () => {
    expect(calcAreaKm2([])).toBe(0);
    expect(calcAreaKm2([{ lat: 0, lng: 0 }])).toBe(0);
    expect(calcAreaKm2([{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }])).toBe(0);
  });

  it('retorna valor positivo para triângulo válido', () => {
    const triangulo = [
      { lat: -23.5, lng: -46.6 },
      { lat: -23.6, lng: -46.6 },
      { lat: -23.5, lng: -46.7 },
    ];
    expect(calcAreaKm2(triangulo)).toBeGreaterThan(0);
  });

  it('retorna valor positivo independente da orientação (CW ou CCW)', () => {
    const cw  = [{ lat: -23.5, lng: -46.6 }, { lat: -23.5, lng: -46.7 }, { lat: -23.6, lng: -46.6 }];
    const ccw = [{ lat: -23.5, lng: -46.6 }, { lat: -23.6, lng: -46.6 }, { lat: -23.5, lng: -46.7 }];
    expect(calcAreaKm2(cw)).toBeGreaterThan(0);
    expect(calcAreaKm2(ccw)).toBeGreaterThan(0);
  });
});

// ─── pontoNoPoli ──────────────────────────────────────────────────────────────

describe('pontoNoPoli', () => {
  const quadrado = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
    { lat: 1, lng: 0 },
  ];

  it('retorna true para ponto dentro do polígono', () => {
    expect(pontoNoPoli(0.5, 0.5, quadrado)).toBe(true);
  });

  it('retorna false para ponto fora do polígono', () => {
    expect(pontoNoPoli(2, 2, quadrado)).toBe(false);
    expect(pontoNoPoli(-1, -1, quadrado)).toBe(false);
  });

  it('retorna false para polígono vazio', () => {
    expect(pontoNoPoli(0, 0, [])).toBe(false);
  });
});

// ─── COORDS_CIDADES / CIDADES ─────────────────────────────────────────────────

describe('COORDS_CIDADES', () => {
  it('contém São Paulo com coordenadas corretas', () => {
    expect(COORDS_CIDADES['São Paulo']).toEqual([-23.5505, -46.6333]);
  });

  it('contém cidades do Brasil e México', () => {
    expect(COORDS_CIDADES['Ciudad de México']).toBeDefined();
    expect(COORDS_CIDADES['Curitiba']).toBeDefined();
  });
});

describe('CIDADES', () => {
  it('contém países BR e MX', () => {
    expect(CIDADES.BR).toBeDefined();
    expect(CIDADES.MX).toBeDefined();
  });

  it('São Paulo está em BR', () => {
    expect(CIDADES.BR).toContain('São Paulo');
  });

  it('Ciudad de México está em MX', () => {
    expect(CIDADES.MX).toContain('Ciudad de México');
  });
});
