// src/components/POIPanel.tsx — Overpass API (OSM) gratuita, sem Cloud Function
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

// ── I18N (padrão objeto T, sem json) ─────────────────────────────
type Lang = 'pt' | 'en' | 'es' | 'ru';
type Tr = { pt: string; en: string; es: string; ru: string };

const T = {
  estacoesJetProximas: { pt: 'Estações JET próximas', en: 'Nearby JET stations', es: 'Estaciones JET cercanas', ru: 'Ближайшие станции JET' },
  estacao:             { pt: 'Estação', en: 'Station', es: 'Estación', ru: 'Станция' },
  adicionarEstacao:    { pt: 'Adicionar estação aqui', en: 'Add station here', es: 'Agregar estación aquí', ru: 'Добавить станцию здесь' },
  adicionarEstacaoSub: { pt: 'Abre o drawer com este local', en: 'Opens the drawer with this location', es: 'Abre el panel con este lugar', ru: 'Открывает панель с этим местом' },
  streetView:          { pt: 'Street View', en: 'Street View', es: 'Street View', ru: 'Street View' },
  streetViewInline:    { pt: 'Abrir inline no app', en: 'Open inline in the app', es: 'Abrir dentro de la app', ru: 'Открыть внутри приложения' },
  streetViewMaps:      { pt: 'Abre no Google Maps', en: 'Opens in Google Maps', es: 'Abre en Google Maps', ru: 'Открыть в Google Maps' },
  verGoogleMaps:       { pt: 'Ver no Google Maps', en: 'View on Google Maps', es: 'Ver en Google Maps', ru: 'Смотреть в Google Maps' },
  copiarCoordenadas:   { pt: 'Copiar coordenadas', en: 'Copy coordinates', es: 'Copiar coordenadas', ru: 'Скопировать координаты' },
  poisProximos:        { pt: 'POIs próximos', en: 'Nearby POIs', es: 'POIs cercanos', ru: 'Ближайшие точки' },
  buscandoOSM:         { pt: 'buscando OSM...', en: 'searching OSM...', es: 'buscando OSM...', ru: 'поиск OSM...' },
  todos:               { pt: 'Todos', en: 'All', es: 'Todos', ru: 'Все' },
  nenhum:              { pt: 'Nenhum', en: 'None', es: 'Ninguno', ru: 'Нет' },
  nenhumPOI:           { pt: 'Nenhum POI encontrado', en: 'No POI found', es: 'Ningún POI encontrado', ru: 'Точки не найдены' },
  overpassIndisponivel:{ pt: 'Overpass indisponível. Tente novamente.', en: 'Overpass unavailable. Please try again.', es: 'Overpass no disponible. Inténtalo de nuevo.', ru: 'Overpass недоступен. Попробуйте снова.' },
} satisfies Record<string, Tr>;

// Categorias exibidas (labels de POI_META) — chaveadas por tipo
const POI_LABELS: Record<string, Tr> = {
  subway_entrance:  { pt: 'Metrô', en: 'Subway', es: 'Metro', ru: 'Метро' },
  station:          { pt: 'Estação', en: 'Station', es: 'Estación', ru: 'Станция' },
  bus_stop:         { pt: 'Ônibus', en: 'Bus stop', es: 'Autobús', ru: 'Автобус' },
  bus_station:      { pt: 'Terminal', en: 'Bus terminal', es: 'Terminal', ru: 'Автовокзал' },
  taxi:             { pt: 'Táxi', en: 'Taxi', es: 'Taxi', ru: 'Такси' },
  ferry_terminal:   { pt: 'Balsa', en: 'Ferry', es: 'Ferry', ru: 'Паром' },
  bicycle_rental:   { pt: 'Bicicleta', en: 'Bike share', es: 'Bicicleta', ru: 'Велопрокат' },
  parking:          { pt: 'Estacionamento', en: 'Parking', es: 'Estacionamiento', ru: 'Парковка' },
  mall:             { pt: 'Shopping', en: 'Mall', es: 'Centro comercial', ru: 'ТЦ' },
  marketplace:      { pt: 'Mercado', en: 'Market', es: 'Mercado', ru: 'Рынок' },
  supermarket:      { pt: 'Supermercado', en: 'Supermarket', es: 'Supermercado', ru: 'Супермаркет' },
  convenience:      { pt: 'Conveniência', en: 'Convenience', es: 'Tienda', ru: 'Магазин у дома' },
  bakery:           { pt: 'Padaria', en: 'Bakery', es: 'Panadería', ru: 'Пекарня' },
  pharmacy:         { pt: 'Farmácia', en: 'Pharmacy', es: 'Farmacia', ru: 'Аптека' },
  bank:             { pt: 'Banco', en: 'Bank', es: 'Banco', ru: 'Банк' },
  atm:              { pt: 'ATM', en: 'ATM', es: 'Cajero', ru: 'Банкомат' },
  fuel:             { pt: 'Posto', en: 'Gas station', es: 'Gasolinera', ru: 'АЗС' },
  restaurant:       { pt: 'Restaurante', en: 'Restaurant', es: 'Restaurante', ru: 'Ресторан' },
  cafe:             { pt: 'Café', en: 'Café', es: 'Café', ru: 'Кафе' },
  fast_food:        { pt: 'Fast Food', en: 'Fast food', es: 'Comida rápida', ru: 'Фастфуд' },
  bar:              { pt: 'Bar', en: 'Bar', es: 'Bar', ru: 'Бар' },
  food_court:       { pt: 'Praça Alimentar', en: 'Food court', es: 'Patio de comidas', ru: 'Фуд-корт' },
  ice_cream:        { pt: 'Sorvete', en: 'Ice cream', es: 'Heladería', ru: 'Мороженое' },
  university:       { pt: 'Universidade', en: 'University', es: 'Universidad', ru: 'Университет' },
  school:           { pt: 'Escola', en: 'School', es: 'Escuela', ru: 'Школа' },
  college:          { pt: 'Faculdade', en: 'College', es: 'Instituto', ru: 'Колледж' },
  library:          { pt: 'Biblioteca', en: 'Library', es: 'Biblioteca', ru: 'Библиотека' },
  kindergarten:     { pt: 'Creche', en: 'Daycare', es: 'Guardería', ru: 'Детский сад' },
  hospital:         { pt: 'Hospital', en: 'Hospital', es: 'Hospital', ru: 'Больница' },
  clinic:           { pt: 'Clínica', en: 'Clinic', es: 'Clínica', ru: 'Клиника' },
  doctors:          { pt: 'Médico', en: 'Doctor', es: 'Médico', ru: 'Врач' },
  dentist:          { pt: 'Dentista', en: 'Dentist', es: 'Dentista', ru: 'Стоматолог' },
  veterinary:       { pt: 'Veterinário', en: 'Vet', es: 'Veterinario', ru: 'Ветеринар' },
  park:             { pt: 'Parque', en: 'Park', es: 'Parque', ru: 'Парк' },
  playground:       { pt: 'Playground', en: 'Playground', es: 'Parque infantil', ru: 'Детская площадка' },
  fitness_centre:   { pt: 'Academia', en: 'Gym', es: 'Gimnasio', ru: 'Спортзал' },
  sports_centre:    { pt: 'Esporte', en: 'Sports', es: 'Deportes', ru: 'Спорт' },
  swimming_pool:    { pt: 'Piscina', en: 'Pool', es: 'Piscina', ru: 'Бассейн' },
  stadium:          { pt: 'Estádio', en: 'Stadium', es: 'Estadio', ru: 'Стадион' },
  cinema:           { pt: 'Cinema', en: 'Cinema', es: 'Cine', ru: 'Кинотеатр' },
  theatre:          { pt: 'Teatro', en: 'Theatre', es: 'Teatro', ru: 'Театр' },
  nightclub:        { pt: 'Balada', en: 'Nightclub', es: 'Discoteca', ru: 'Клуб' },
  townhall:         { pt: 'Prefeitura', en: 'City hall', es: 'Ayuntamiento', ru: 'Мэрия' },
  police:           { pt: 'Polícia', en: 'Police', es: 'Policía', ru: 'Полиция' },
  fire_station:     { pt: 'Bombeiros', en: 'Fire station', es: 'Bomberos', ru: 'Пожарная часть' },
  post_office:      { pt: 'Correios', en: 'Post office', es: 'Correos', ru: 'Почта' },
  courthouse:       { pt: 'Fórum', en: 'Courthouse', es: 'Juzgado', ru: 'Суд' },
  embassy:          { pt: 'Consulado', en: 'Embassy', es: 'Consulado', ru: 'Консульство' },
  social_facility:  { pt: 'Assistência', en: 'Social services', es: 'Asistencia social', ru: 'Соцслужба' },
  place_of_worship: { pt: 'Igreja', en: 'Place of worship', es: 'Iglesia', ru: 'Храм' },
  museum:           { pt: 'Museu', en: 'Museum', es: 'Museo', ru: 'Музей' },
  art_gallery:      { pt: 'Galeria', en: 'Gallery', es: 'Galería', ru: 'Галерея' },
  hotel:            { pt: 'Hotel', en: 'Hotel', es: 'Hotel', ru: 'Отель' },
  hostel:           { pt: 'Hostel', en: 'Hostel', es: 'Hostal', ru: 'Хостел' },
  tourism:          { pt: 'Turismo', en: 'Tourism', es: 'Turismo', ru: 'Туризм' },
  viewpoint:        { pt: 'Mirante', en: 'Viewpoint', es: 'Mirador', ru: 'Смотровая площадка' },
  charging_station: { pt: 'Elétrico', en: 'EV charging', es: 'Cargador eléctrico', ru: 'Электрозарядка' },
  drinking_water:   { pt: 'Água', en: 'Water', es: 'Agua', ru: 'Вода' },
  toilets:          { pt: 'Banheiro', en: 'Toilets', es: 'Baño', ru: 'Туалет' },
};

function useI18n() {
  const { i18n } = useTranslation();
  const lang = ((i18n.language || 'pt').slice(0, 2)) as Lang;
  const pick = (o: Tr) => o[lang] ?? o.pt;
  return { lang, pick };
}

// ── TIPOS ────────────────────────────────────────────────────────
export interface POI {
  id: string; nome: string; tipo: string;
  lat: number; lng: number; endereco: string;
  distancia: number; tags: Record<string, string>;
}

// ── MAPEAMENTO OSM → META ────────────────────────────────────────
export const POI_META: Record<string, { icon: string; label: string; color: string }> = {
  // Transporte
  subway_entrance:    { icon: '🚇', label: 'Metrô',         color: '#3b82f6' },
  station:            { icon: '🚆', label: 'Estação',       color: '#6366f1' },
  bus_stop:           { icon: '🚌', label: 'Ônibus',        color: '#06b6d4' },
  bus_station:        { icon: '🚌', label: 'Terminal',      color: '#0284c7' },
  taxi:               { icon: '🚕', label: 'Táxi',          color: '#f59e0b' },
  ferry_terminal:     { icon: '⛴',  label: 'Balsa',        color: '#0ea5e9' },
  bicycle_rental:     { icon: '🚲', label: 'Bicicleta',     color: '#22c55e' },
  parking:            { icon: '🅿',  label: 'Estacionamento',color: '#64748b' },
  // Comércio
  mall:               { icon: '🛍',  label: 'Shopping',     color: '#f59e0b' },
  marketplace:        { icon: '🏪', label: 'Mercado',       color: '#eab308' },
  supermarket:        { icon: '🛒', label: 'Supermercado',  color: '#10b981' },
  convenience:        { icon: '🏬', label: 'Conveniência',  color: '#34d399' },
  bakery:             { icon: '🥐', label: 'Padaria',       color: '#d97706' },
  pharmacy:           { icon: '💊', label: 'Farmácia',      color: '#14b8a6' },
  bank:               { icon: '🏦', label: 'Banco',         color: '#64748b' },
  atm:                { icon: '💳', label: 'ATM',           color: '#94a3b8' },
  fuel:               { icon: '⛽', label: 'Posto',         color: '#f97316' },
  // Alimentação
  restaurant:         { icon: '🍽',  label: 'Restaurante',  color: '#f97316' },
  cafe:               { icon: '☕', label: 'Café',          color: '#d97706' },
  fast_food:          { icon: '🍔', label: 'Fast Food',     color: '#ef4444' },
  bar:                { icon: '🍺', label: 'Bar',           color: '#f59e0b' },
  food_court:         { icon: '🍱', label: 'Praça Alimentar',color: '#fb923c' },
  ice_cream:          { icon: '🍦', label: 'Sorvete',       color: '#f9a8d4' },
  // Educação
  university:         { icon: '🎓', label: 'Universidade',  color: '#6366f1' },
  school:             { icon: '🏫', label: 'Escola',        color: '#a78bfa' },
  college:            { icon: '🎓', label: 'Faculdade',     color: '#8b5cf6' },
  library:            { icon: '📚', label: 'Biblioteca',    color: '#7c3aed' },
  kindergarten:       { icon: '🧒', label: 'Creche',        color: '#c4b5fd' },
  // Saúde
  hospital:           { icon: '🏥', label: 'Hospital',      color: '#ef4444' },
  clinic:             { icon: '🏥', label: 'Clínica',       color: '#f87171' },
  doctors:            { icon: '👨‍⚕️', label: 'Médico',    color: '#fca5a5' },
  dentist:            { icon: '🦷', label: 'Dentista',      color: '#fb7185' },
  veterinary:         { icon: '🐾', label: 'Veterinário',   color: '#f9a8d4' },
  // Lazer / Esporte
  park:               { icon: '🌳', label: 'Parque',        color: '#22c55e' },
  playground:         { icon: '🛝', label: 'Playground',    color: '#4ade80' },
  fitness_centre:     { icon: '💪', label: 'Academia',      color: '#ec4899' },
  sports_centre:      { icon: '⚽', label: 'Esporte',       color: '#f43f5e' },
  swimming_pool:      { icon: '🏊', label: 'Piscina',       color: '#38bdf8' },
  stadium:            { icon: '🏟',  label: 'Estádio',      color: '#fb923c' },
  cinema:             { icon: '🎬', label: 'Cinema',        color: '#a855f7' },
  theatre:            { icon: '🎭', label: 'Teatro',        color: '#d946ef' },
  nightclub:          { icon: '🎵', label: 'Balada',        color: '#e879f9' },
  // Serviços públicos
  townhall:           { icon: '🏛',  label: 'Prefeitura',   color: '#64748b' },
  police:             { icon: '👮', label: 'Polícia',        color: '#1d4ed8' },
  fire_station:       { icon: '🚒', label: 'Bombeiros',     color: '#dc2626' },
  post_office:        { icon: '📮', label: 'Correios',      color: '#f59e0b' },
  courthouse:         { icon: '⚖',  label: 'Fórum',        color: '#475569' },
  embassy:            { icon: '🏳',  label: 'Consulado',    color: '#94a3b8' },
  social_facility:    { icon: '🤝', label: 'Assistência',   color: '#6ee7b7' },
  // Religioso / Cultural
  place_of_worship:   { icon: '⛪', label: 'Igreja',        color: '#a78bfa' },
  museum:             { icon: '🏛',  label: 'Museu',        color: '#c084fc' },
  art_gallery:        { icon: '🖼',  label: 'Galeria',      color: '#d8b4fe' },
  // Turismo / Hospedagem
  hotel:              { icon: '🏨', label: 'Hotel',         color: '#fbbf24' },
  hostel:             { icon: '🛏',  label: 'Hostel',       color: '#fcd34d' },
  tourism:            { icon: '📸', label: 'Turismo',       color: '#fb923c' },
  viewpoint:          { icon: '🔭', label: 'Mirante',       color: '#7dd3fc' },
  // Outros úteis
  charging_station:   { icon: '⚡', label: 'Elétrico',      color: '#facc15' },
  drinking_water:     { icon: '💧', label: 'Água',          color: '#38bdf8' },
  toilets:            { icon: '🚻', label: 'Banheiro',      color: '#94a3b8' },
};

// ── OVERPASS QUERY ────────────────────────────────────────────────
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const FALLBACK_URL = 'https://overpass.kumi.systems/api/interpreter';

// Query unificada — busca TODOS os POIs de uma vez
function buildQuery(lat: number, lng: number, raio: number): string {
  const r = raio;
  const c = `${lat},${lng}`;
  return `[out:json][timeout:25];
(
  node["railway"="subway_entrance"](around:${r},${c});
  node["railway"="station"](around:${r},${c});
  node["highway"="bus_stop"](around:${r},${c});
  node["amenity"="bus_station"](around:${r},${c});
  node["amenity"="taxi"](around:${r},${c});
  node["amenity"="ferry_terminal"](around:${r},${c});
  node["amenity"="bicycle_rental"](around:${r},${c});
  node["amenity"="parking"](around:${r},${c});
  node["shop"="mall"](around:${r},${c});
  way["shop"="mall"](around:${r},${c});
  node["amenity"="marketplace"](around:${r},${c});
  node["shop"="supermarket"](around:${r},${c});
  node["shop"="convenience"](around:${r},${c});
  node["shop"="bakery"](around:${r},${c});
  node["amenity"="pharmacy"](around:${r},${c});
  node["amenity"="bank"](around:${r},${c});
  node["amenity"="atm"](around:${r},${c});
  node["amenity"="fuel"](around:${r},${c});
  node["amenity"="restaurant"](around:${r},${c});
  node["amenity"="cafe"](around:${r},${c});
  node["amenity"="fast_food"](around:${r},${c});
  node["amenity"="bar"](around:${r},${c});
  node["amenity"="food_court"](around:${r},${c});
  node["amenity"="ice_cream"](around:${r},${c});
  node["amenity"="university"](around:${r},${c});
  way["amenity"="university"](around:${r},${c});
  node["amenity"="school"](around:${r},${c});
  node["amenity"="college"](around:${r},${c});
  node["amenity"="library"](around:${r},${c});
  node["amenity"="kindergarten"](around:${r},${c});
  node["amenity"="hospital"](around:${r},${c});
  way["amenity"="hospital"](around:${r},${c});
  node["amenity"="clinic"](around:${r},${c});
  node["amenity"="doctors"](around:${r},${c});
  node["amenity"="dentist"](around:${r},${c});
  node["amenity"="veterinary"](around:${r},${c});
  node["leisure"="park"](around:${r},${c});
  way["leisure"="park"](around:${r},${c});
  node["leisure"="playground"](around:${r},${c});
  node["leisure"="fitness_centre"](around:${r},${c});
  node["leisure"="sports_centre"](around:${r},${c});
  node["leisure"="swimming_pool"](around:${r},${c});
  node["leisure"="stadium"](around:${r},${c});
  node["amenity"="cinema"](around:${r},${c});
  node["amenity"="theatre"](around:${r},${c});
  node["amenity"="nightclub"](around:${r},${c});
  node["amenity"="townhall"](around:${r},${c});
  node["amenity"="police"](around:${r},${c});
  node["amenity"="fire_station"](around:${r},${c});
  node["amenity"="post_office"](around:${r},${c});
  node["amenity"="courthouse"](around:${r},${c});
  node["amenity"="embassy"](around:${r},${c});
  node["amenity"="social_facility"](around:${r},${c});
  node["amenity"="place_of_worship"](around:${r},${c});
  node["tourism"="museum"](around:${r},${c});
  node["tourism"="gallery"](around:${r},${c});
  node["tourism"="hotel"](around:${r},${c});
  node["tourism"="hostel"](around:${r},${c});
  node["tourism"="attraction"](around:${r},${c});
  node["tourism"="viewpoint"](around:${r},${c});
  node["amenity"="charging_station"](around:${r},${c});
  node["amenity"="drinking_water"](around:${r},${c});
  node["amenity"="toilets"](around:${r},${c});
);
out center qt 200;`;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function detectTipo(tags: Record<string, string>): string {
  const checks: [string, string, string][] = [
    ['railway',  'subway_entrance', 'subway_entrance'],
    ['railway',  'station',         'station'],
    ['highway',  'bus_stop',        'bus_stop'],
    ['amenity',  'bus_station',     'bus_station'],
    ['amenity',  'taxi',            'taxi'],
    ['amenity',  'ferry_terminal',  'ferry_terminal'],
    ['amenity',  'bicycle_rental',  'bicycle_rental'],
    ['amenity',  'parking',         'parking'],
    ['shop',     'mall',            'mall'],
    ['amenity',  'marketplace',     'marketplace'],
    ['shop',     'supermarket',     'supermarket'],
    ['shop',     'convenience',     'convenience'],
    ['shop',     'bakery',          'bakery'],
    ['amenity',  'pharmacy',        'pharmacy'],
    ['amenity',  'bank',            'bank'],
    ['amenity',  'atm',             'atm'],
    ['amenity',  'fuel',            'fuel'],
    ['amenity',  'restaurant',      'restaurant'],
    ['amenity',  'cafe',            'cafe'],
    ['amenity',  'fast_food',       'fast_food'],
    ['amenity',  'bar',             'bar'],
    ['amenity',  'food_court',      'food_court'],
    ['amenity',  'ice_cream',       'ice_cream'],
    ['amenity',  'university',      'university'],
    ['amenity',  'school',          'school'],
    ['amenity',  'college',         'college'],
    ['amenity',  'library',         'library'],
    ['amenity',  'kindergarten',    'kindergarten'],
    ['amenity',  'hospital',        'hospital'],
    ['amenity',  'clinic',          'clinic'],
    ['amenity',  'doctors',         'doctors'],
    ['amenity',  'dentist',         'dentist'],
    ['amenity',  'veterinary',      'veterinary'],
    ['leisure',  'park',            'park'],
    ['leisure',  'playground',      'playground'],
    ['leisure',  'fitness_centre',  'fitness_centre'],
    ['leisure',  'sports_centre',   'sports_centre'],
    ['leisure',  'swimming_pool',   'swimming_pool'],
    ['leisure',  'stadium',         'stadium'],
    ['amenity',  'cinema',          'cinema'],
    ['amenity',  'theatre',         'theatre'],
    ['amenity',  'nightclub',       'nightclub'],
    ['amenity',  'townhall',        'townhall'],
    ['amenity',  'police',          'police'],
    ['amenity',  'fire_station',    'fire_station'],
    ['amenity',  'post_office',     'post_office'],
    ['amenity',  'courthouse',      'courthouse'],
    ['amenity',  'embassy',         'embassy'],
    ['amenity',  'social_facility', 'social_facility'],
    ['amenity',  'place_of_worship','place_of_worship'],
    ['tourism',  'museum',          'museum'],
    ['tourism',  'gallery',         'art_gallery'],
    ['tourism',  'hotel',           'hotel'],
    ['tourism',  'hostel',          'hostel'],
    ['tourism',  'attraction',      'tourism'],
    ['tourism',  'viewpoint',       'viewpoint'],
    ['amenity',  'charging_station','charging_station'],
    ['amenity',  'drinking_water',  'drinking_water'],
    ['amenity',  'toilets',         'toilets'],
  ];
  for (const [key, val, tipo] of checks) {
    if (tags[key] === val) return tipo;
  }
  return 'outros';
}

async function fetchOverpass(query: string): Promise<any[]> {
  const body = 'data=' + encodeURIComponent(query);
  try {
    const r = await fetch(OVERPASS_URL, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!r.ok) throw new Error('status ' + r.status);
    const json = await r.json();
    return json.elements || [];
  } catch {
    // Fallback
    const r = await fetch(FALLBACK_URL, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const json = await r.json();
    return json.elements || [];
  }
}

// ── HOOK PRINCIPAL ───────────────────────────────────────────────
export function usePOIs(lat: number, lng: number, raio = 1000) {
  const { pick } = useI18n();
  const [pois, setPOIs] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiposFiltro, setTiposFiltro] = useState<Set<string>>(new Set(Object.keys(POI_META)));
  const cacheRef = useRef<Record<string, POI[]>>({});

  const buscar = useCallback(async () => {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)},${raio}`;
    if (cacheRef.current[key]) { setPOIs(cacheRef.current[key]); return; }
    setLoading(true); setError(null);
    try {
      const elements = await fetchOverpass(buildQuery(lat, lng, raio));
      const result: POI[] = [];
      const seen = new Set<string>();
      for (const el of elements) {
        const elLat = el.lat ?? el.center?.lat;
        const elLng = el.lon ?? el.center?.lon;
        if (!elLat || !elLng) continue;
        const tags = el.tags || {};
        const nome = tags.name || tags['name:pt'] || tags['name:en'] || '';
        if (!nome) continue;
        const tipo = detectTipo(tags);
        if (tipo === 'outros') continue;
        const uid = `${el.type}-${el.id}`;
        if (seen.has(uid)) continue;
        seen.add(uid);
        const addr = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ')
          || tags['addr:full'] || '';
        result.push({
          id: uid, nome, tipo, lat: elLat, lng: elLng,
          endereco: addr, distancia: haversine(lat, lng, elLat, elLng),
          tags,
        });
      }
      result.sort((a, b) => a.distancia - b.distancia);
      cacheRef.current[key] = result;
      setPOIs(result);
    } catch (e: any) {
      setError(pick(T.overpassIndisponivel));
    }
    setLoading(false);
  }, [lat, lng, raio, pick]);

  useEffect(() => { buscar(); }, [lat, lng, raio]);

  const poisFiltrados = pois.filter(p => tiposFiltro.has(p.tipo));
  return { pois: poisFiltrados, allPois: pois, loading, error, tiposFiltro, setTiposFiltro, buscar };
}

// ── POPUP DE AÇÕES ───────────────────────────────────────────────
export function POIActionsPopup({
  poi, estacoes, onAddEstacao, onStreetView, onClose,
}: {
  poi: POI;
  estacoes: { lat: number; lng: number; codigo?: string; bairro?: string }[];
  onAddEstacao: (lat: number, lng: number) => void;
  onStreetView?: (lat: number, lng: number, nome: string) => void;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  const meta = POI_META[poi.tipo] || { icon: '📍', label: poi.tipo, color: '#64748b' };
  const metaLabel = POI_LABELS[poi.tipo] ? pick(POI_LABELS[poi.tipo]) : meta.label;

  // Distância até estações JET próximas
  const nearest = estacoes
    .map(e => ({ ...e, dist: haversine(poi.lat, poi.lng, e.lat, e.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);

  const svUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${poi.lat},${poi.lng}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lng}`;
  const coords = `${poi.lat.toFixed(6)}, ${poi.lng.toFixed(6)}`;

  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 8, cursor: 'pointer', fontSize: 12, color: '#dce8ff',
    width: '100%', textAlign: 'left', transition: 'all .12s',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: '#0c1018', border: '1px solid #1c2535', borderRadius: 12,
        padding: 20, width: 320, maxWidth: '92vw',
        boxShadow: '0 20px 60px rgba(0,0,0,.8)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 28 }}>{meta.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#dce8ff' }}>{poi.nome}</div>
            <div style={{ fontSize: 10, color: meta.color }}>{metaLabel} · {poi.distancia}m</div>
            {poi.endereco && <div style={{ fontSize: 10, color: '#4a5a7a', marginTop: 2 }}>{poi.endereco}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a5a7a', cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        {/* Estações próximas */}
        {nearest.length > 0 && (
          <div style={{ marginBottom: 14, padding: 10, background: 'rgba(61,155,255,.06)', borderRadius: 8, border: '1px solid rgba(61,155,255,.15)' }}>
            <div style={{ fontSize: 9, color: '#3d9bff', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8, marginBottom: 6 }}>{pick(T.estacoesJetProximas)}</div>
            {nearest.map((e, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#dce8ff', marginBottom: 3 }}>
                <span style={{ color: '#4a5a7a' }}>{e.codigo || pick(T.estacao)} {e.bairro ? '· ' + e.bairro : ''}</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: e.dist < 150 ? '#2ecc71' : e.dist < 300 ? '#f5c842' : '#ff4757' }}>
                  {e.dist}m
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Ações */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button style={btn}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(61,155,255,.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.05)')}
            onClick={() => { onAddEstacao(poi.lat, poi.lng); onClose(); }}>
            <span style={{ fontSize: 16 }}>📍</span>
            <div>
              <div style={{ fontWeight: 600 }}>{pick(T.adicionarEstacao)}</div>
              <div style={{ fontSize: 10, color: '#4a5a7a' }}>{pick(T.adicionarEstacaoSub)}</div>
            </div>
          </button>

          <button style={btn}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.05)')}
            onClick={() => onStreetView ? onStreetView(poi.lat, poi.lng, poi.nome) : window.open(svUrl, '_blank')}>
            <span style={{ fontSize: 16 }}>🌐</span>
            <div>
              <div style={{ fontWeight: 600 }}>{pick(T.streetView)}</div>
              <div style={{ fontSize: 10, color: '#4a5a7a' }}>
                {onStreetView ? pick(T.streetViewInline) : pick(T.streetViewMaps)}
              </div>
            </div>
          </button>

          <button style={btn}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251,191,36,.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.05)')}
            onClick={() => window.open(mapsUrl, '_blank')}>
            <span style={{ fontSize: 16 }}>🗺</span>
            <div>
              <div style={{ fontWeight: 600 }}>{pick(T.verGoogleMaps)}</div>
              <div style={{ fontSize: 10, color: '#4a5a7a' }}>{poi.lat.toFixed(5)}, {poi.lng.toFixed(5)}</div>
            </div>
          </button>

          <button style={btn}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.05)')}
            onClick={() => { navigator.clipboard.writeText(coords); onClose(); }}>
            <span style={{ fontSize: 16 }}>📋</span>
            <div>
              <div style={{ fontWeight: 600 }}>{pick(T.copiarCoordenadas)}</div>
              <div style={{ fontSize: 10, color: '#4a5a7a' }}>{coords}</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PAINEL LATERAL ───────────────────────────────────────────────
export function POIPanel({
  lat, lng, raio = 1000,
  onSugerirEndereco,
  compact = false,
}: {
  lat: number; lng: number; raio?: number;
  onSugerirEndereco?: (endereco: string, nome: string) => void;
  compact?: boolean;
}) {
  const { pick } = useI18n();
  const { pois, loading, error, tiposFiltro, setTiposFiltro } = usePOIs(lat, lng, raio);
  const tiposPresentes = [...new Set(pois.map(p => p.tipo))];

  const s: Record<string, React.CSSProperties> = {
    wrap:  { display: 'flex', flexDirection: 'column', gap: 8 },
    chips: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
    list:  { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: compact ? 160 : 260, overflowY: 'auto' },
    item:  { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: 'rgba(255,255,255,.04)', borderRadius: 6, border: '1px solid rgba(255,255,255,.07)', cursor: 'pointer', transition: 'all .12s' },
  };

  return (
    <div style={s.wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.7)', textTransform: 'uppercase', letterSpacing: .8 }}>
          {pick(T.poisProximos)} ({pois.length})
        </div>
        {loading && <div style={{ fontSize: 9, color: '#3d9bff' }}>{pick(T.buscandoOSM)}</div>}
        {error && <div style={{ fontSize: 9, color: '#ef4444' }}>{error}</div>}
      </div>

      {!compact && tiposPresentes.length > 0 && (
        <div style={s.chips}>
          <div onClick={() => setTiposFiltro(new Set(Object.keys(POI_META)))}
            style={{ padding: '2px 7px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 10, color: 'rgba(255,255,255,.4)' }}>
            {pick(T.todos)}
          </div>
          {tiposPresentes.map(t => {
            const m = POI_META[t] || { icon: '📍', label: t, color: '#64748b' };
            const label = POI_LABELS[t] ? pick(POI_LABELS[t]) : m.label;
            const on = tiposFiltro.has(t);
            return (
              <div key={t} onClick={() => setTiposFiltro(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; })}
                style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 10, border: `1px solid ${on ? m.color : 'rgba(255,255,255,.1)'}`, cursor: 'pointer', fontSize: 10, background: on ? m.color + '22' : 'transparent', color: on ? m.color : 'rgba(255,255,255,.35)', transition: 'all .12s' }}>
                {m.icon} {label}
              </div>
            );
          })}
        </div>
      )}

      <div style={s.list}>
        {pois.length === 0 && !loading && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.3)', textAlign: 'center', padding: '16px 0' }}>{pick(T.nenhumPOI)}</div>}
        {pois.map(poi => {
          const m = POI_META[poi.tipo] || { icon: '📍', label: poi.tipo, color: '#64748b' };
          return (
            <div key={poi.id} style={s.item}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.04)')}
              onClick={() => onSugerirEndereco?.(poi.endereco, poi.nome)}
              title={poi.endereco}>
              <div style={{ fontSize: 16, flexShrink: 0 }}>{m.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{poi.nome}</div>
                {poi.endereco && <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{poi.endereco}</div>}
              </div>
              <div style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: '#3d9bff', flexShrink: 0 }}>{poi.distancia}m</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FILTRO DO MAPA PRINCIPAL ──────────────────────────────────────
export function POIMapFilter({
  tiposAtivos, onChange,
}: {
  tiposAtivos: Set<string>;
  onChange: (tipos: Set<string>) => void;
}) {
  const { pick } = useI18n();
  const allTypes = Object.keys(POI_META);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 12px', background: 'rgba(8,11,18,.92)', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)', maxWidth: '80vw', maxHeight: 140, overflowY: 'auto' }}>
      <div onClick={() => onChange(new Set(allTypes))}
        style={{ padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(255,255,255,.2)', cursor: 'pointer', fontSize: 10, color: 'rgba(255,255,255,.5)' }}>
        {pick(T.todos)}
      </div>
      <div onClick={() => onChange(new Set())}
        style={{ padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(255,255,255,.1)', cursor: 'pointer', fontSize: 10, color: 'rgba(255,255,255,.3)' }}>
        {pick(T.nenhum)}
      </div>
      {allTypes.map(t => {
        const m = POI_META[t];
        const label = POI_LABELS[t] ? pick(POI_LABELS[t]) : m.label;
        const on = tiposAtivos.has(t);
        return (
          <div key={t} onClick={() => { const n = new Set(tiposAtivos); n.has(t) ? n.delete(t) : n.add(t); onChange(n); }}
            style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 10, border: `1px solid ${on ? m.color : 'rgba(255,255,255,.08)'}`, background: on ? m.color + '22' : 'transparent', color: on ? m.color : 'rgba(255,255,255,.25)', cursor: 'pointer', fontSize: 10, transition: 'all .12s' }}>
            {m.icon} {label}
          </div>
        );
      })}
    </div>
  );
}
