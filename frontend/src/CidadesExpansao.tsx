// src/components/CidadesExpansao.tsx
// Planejamento de expansão para novas cidades

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from './lib/firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { supabase } from './lib/supabase';

const T = {
  statusEmAnalise:    { pt: 'Em análise',     en: 'Under review',      es: 'En análisis',      ru: 'На рассмотрении' },
  statusAprovada:     { pt: 'Aprovada',        en: 'Approved',          es: 'Aprobada',         ru: 'Одобрено' },
  statusEmImplantacao:{ pt: 'Em implantação',  en: 'In deployment',     es: 'En implementación',ru: 'Внедрение' },
  statusAtiva:        { pt: 'Ativa',           en: 'Active',            es: 'Activa',           ru: 'Активно' },
  statusDescartada:   { pt: 'Descartada',      en: 'Discarded',         es: 'Descartada',       ru: 'Отклонено' },

  geocodeFirst:       { pt: 'Geocode a cidade primeiro (clique em 📍)', en: 'Geocode the city first (click 📍)', es: 'Geocodifica la ciudad primero (haz clic en 📍)', ru: 'Сначала геокодируйте город (нажмите 📍)' },
  poisInRadius:       { pt: 'POIs num raio 5km: ', en: 'POIs within 5km radius: ', es: 'POIs en un radio de 5km: ', ru: 'POI в радиусе 5 км: ' },
  poisFetchError:     { pt: 'POIs: erro ao buscar', en: 'POIs: fetch error', es: 'POIs: error al buscar', ru: 'POI: ошибка загрузки' },
  cyclewaySegments:   { pt: 'Trechos de ciclovia: ', en: 'Cycleway segments: ', es: 'Tramos de ciclovía: ', ru: 'Участки велодорожек: ' },
  cyclewayFetchError: { pt: 'Ciclovias: erro ao buscar', en: 'Cycleways: fetch error', es: 'Ciclovías: error al buscar', ru: 'Велодорожки: ошибка загрузки' },
  scorePOIs:          { pt: 'Score POIs: ', en: 'POIs score: ', es: 'Puntuación POIs: ', ru: 'Оценка POI: ' },
  scoreMobility:      { pt: 'Score mobilidade: ', en: 'Mobility score: ', es: 'Puntuación de movilidad: ', ru: 'Оценка мобильности: ' },
  scorePopulation:    { pt: 'Score população: ', en: 'Population score: ', es: 'Puntuación de población: ', ru: 'Оценка населения: ' },
  benchmarkHigh:      { pt: 'Perfil similar a bairros centrais de SP (Pinheiros, Vila Madalena)', en: 'Profile similar to central SP districts (Pinheiros, Vila Madalena)', es: 'Perfil similar a barrios centrales de SP (Pinheiros, Vila Madalena)', ru: 'Профиль похож на центральные районы Сан-Паулу (Пиньейрос, Вила-Мадалена)' },
  benchmarkMid:       { pt: 'Perfil similar a bairros intermediários de SP (Tatuapé, Santo André)', en: 'Profile similar to intermediate SP districts (Tatuapé, Santo André)', es: 'Perfil similar a barrios intermedios de SP (Tatuapé, Santo André)', ru: 'Профиль похож на промежуточные районы Сан-Паулу (Татуапе, Санту-Андре)' },
  benchmarkLow:       { pt: 'Mercado menor — recomendado piloto com 10-20 estações', en: 'Smaller market — pilot with 10-20 stations recommended', es: 'Mercado menor — se recomienda piloto con 10-20 estaciones', ru: 'Меньший рынок — рекомендуется пилот с 10-20 станциями' },
  estStations:        { pt: 'Estações estimadas: ', en: 'Estimated stations: ', es: 'Estaciones estimadas: ', ru: 'Оценка станций: ' },
  estRidesPerDay:     { pt: 'Corridas/dia est.: ', en: 'Est. rides/day: ', es: 'Viajes/día est.: ', ru: 'Поездок/день (оценка): ' },
  analysisError:      { pt: 'Erro na análise: ', en: 'Analysis error: ', es: 'Error en el análisis: ', ru: 'Ошибка анализа: ' },

  enterCityName:      { pt: 'Informe o nome da cidade', en: 'Enter the city name', es: 'Indica el nombre de la ciudad', ru: 'Укажите название города' },
  enterCoords:        { pt: 'Informe as coordenadas', en: 'Enter the coordinates', es: 'Indica las coordenadas', ru: 'Укажите координаты' },
  cityUpdated:        { pt: 'Cidade atualizada', en: 'City updated', es: 'Ciudad actualizada', ru: 'Город обновлён' },
  cityAdded:          { pt: 'Cidade adicionada ao planejamento', en: 'City added to planning', es: 'Ciudad añadida a la planificación', ru: 'Город добавлен в план' },
  errorPrefix:        { pt: 'Erro: ', en: 'Error: ', es: 'Error: ', ru: 'Ошибка: ' },
  confirmDelete:      { pt: 'Excluir "{n}"?', en: 'Delete "{n}"?', es: '¿Eliminar "{n}"?', ru: 'Удалить «{n}»?' },
  cityRemoved:        { pt: 'Cidade removida', en: 'City removed', es: 'Ciudad eliminada', ru: 'Город удалён' },

  editCity:           { pt: '✏ Editar cidade', en: '✏ Edit city', es: '✏ Editar ciudad', ru: '✏ Редактировать город' },
  newCity:            { pt: '🌍 Nova cidade — Expansão', en: '🌍 New city — Expansion', es: '🌍 Nueva ciudad — Expansión', ru: '🌍 Новый город — Расширение' },
  statusLabel:        { pt: 'Status', en: 'Status', es: 'Estado', ru: 'Статус' },
  cityNameLabel:      { pt: 'Nome da cidade *', en: 'City name *', es: 'Nombre de la ciudad *', ru: 'Название города *' },
  cityNamePlaceholder:{ pt: 'Ex: Curitiba', en: 'E.g.: Curitiba', es: 'Ej.: Curitiba', ru: 'Напр.: Куритиба' },
  searchCoords:       { pt: 'Buscar coordenadas', en: 'Search coordinates', es: 'Buscar coordenadas', ru: 'Найти координаты' },
  countryLabel:       { pt: 'País', en: 'Country', es: 'País', ru: 'Страна' },
  latitudeLabel:      { pt: 'Latitude', en: 'Latitude', es: 'Latitud', ru: 'Широта' },
  longitudeLabel:     { pt: 'Longitude', en: 'Longitude', es: 'Longitud', ru: 'Долгота' },
  populationLabel:    { pt: 'População', en: 'Population', es: 'Población', ru: 'Население' },
  populationPlaceholder:{ pt: 'hab.', en: 'inhab.', es: 'hab.', ru: 'чел.' },
  ridesPerMonthLabel: { pt: 'Corridas/mês est.', en: 'Est. rides/month', es: 'Viajes/mes est.', ru: 'Поездок/мес (оценка)' },
  investmentLabel:    { pt: 'Investimento R$', en: 'Investment R$', es: 'Inversión R$', ru: 'Инвестиции R$' },
  plannedDateLabel:   { pt: 'Data prevista', en: 'Planned date', es: 'Fecha prevista', ru: 'Планируемая дата' },
  ownerLabel:         { pt: 'Responsável', en: 'Owner', es: 'Responsable', ru: 'Ответственный' },
  ownerPlaceholder:   { pt: 'Nome', en: 'Name', es: 'Nombre', ru: 'Имя' },
  notesLabel:         { pt: 'Observações', en: 'Notes', es: 'Observaciones', ru: 'Примечания' },
  notesPlaceholder:   { pt: 'Contexto, parceiros, riscos...', en: 'Context, partners, risks...', es: 'Contexto, socios, riesgos...', ru: 'Контекст, партнёры, риски...' },
  analyzingOSM:       { pt: '⏳ Analisando via OSM...', en: '⏳ Analyzing via OSM...', es: '⏳ Analizando vía OSM...', ru: '⏳ Анализ через OSM...' },
  analyzePotential:   { pt: '🤖 Analisar potencial da cidade', en: '🤖 Analyze city potential', es: '🤖 Analizar potencial de la ciudad', ru: '🤖 Оценить потенциал города' },
  potentialScore:     { pt: 'Score de potencial', en: 'Potential score', es: 'Puntuación de potencial', ru: 'Оценка потенциала' },
  kpiPOIs:            { pt: 'POIs', en: 'POIs', es: 'POIs', ru: 'POI' },
  kpiCycleways:       { pt: 'Ciclovias', en: 'Cycleways', es: 'Ciclovías', ru: 'Велодорожки' },
  kpiSegmentsSuffix:  { pt: ' trechos', en: ' segments', es: ' tramos', ru: ' участков' },
  kpiEstRidesMonth:   { pt: 'Est. corridas/mês', en: 'Est. rides/month', es: 'Viajes/mes est.', ru: 'Поездок/мес (оценка)' },
  autoFilledNote:     { pt: 'Estimativa preenchida em "Corridas/mês est." automaticamente.', en: 'Estimate auto-filled into "Est. rides/month".', es: 'Estimación rellenada automáticamente en "Viajes/mes est.".', ru: 'Оценка автоматически внесена в «Поездок/мес (оценка)».' },
  cancel:             { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  saving:             { pt: 'Salvando...', en: 'Saving...', es: 'Guardando...', ru: 'Сохранение...' },
  save:               { pt: 'Salvar', en: 'Save', es: 'Guardar', ru: 'Сохранить' },
  add:                { pt: 'Adicionar', en: 'Add', es: 'Añadir', ru: 'Добавить' },
};

export type StatusExpansao = 'em_analise' | 'aprovada' | 'em_implantacao' | 'ativa' | 'descartada';

export interface CidadeExpansao {
  id: string;
  nome: string;
  pais: string;
  lat: number;
  lng: number;
  populacao?: number;
  mercadoEst?: number;       // corridas/mês estimadas
  investimentoEst?: number;  // R$
  status: StatusExpansao;
  dataPrevista?: string;     // YYYY-MM-DD
  responsavel?: string;
  obs?: string;
  criadoEm?: any;
  atualizadoEm?: any;
}

export const STATUS_META: Record<StatusExpansao, { label: { pt: string; en: string; es: string; ru: string }; cor: string; icon: string }> = {
  em_analise:      { label: { pt: 'Em análise',    en: 'Under review',   es: 'En análisis',      ru: 'На рассмотрении' }, cor: '#60a5fa', icon: '🔍' },
  aprovada:        { label: { pt: 'Aprovada',      en: 'Approved',       es: 'Aprobada',         ru: 'Одобрен' },         cor: '#2ecc71', icon: '✅' },
  em_implantacao:  { label: { pt: 'Em implantação',en: 'In deployment',  es: 'En implantación',  ru: 'Внедрение' },       cor: '#f5c842', icon: '🚧' },
  ativa:           { label: { pt: 'Ativa',         en: 'Active',         es: 'Activa',           ru: 'Активный' },        cor: '#34d399', icon: '🟢' },
  descartada:      { label: { pt: 'Descartada',    en: 'Discarded',      es: 'Descartada',       ru: 'Отклонён' },        cor: '#6b7280', icon: '❌' },
};

export function useCidadesExpansao() {
  const [cidades, setCidades] = useState<CidadeExpansao[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'cidades_expansao'), orderBy('criadoEm', 'desc'));
    return onSnapshot(q, snap => {
      setCidades(snap.docs.map(d => ({ id: d.id, ...d.data() } as CidadeExpansao)));
    });
  }, []);
  return cidades;
}

// ── MODAL CADASTRO/EDIÇÃO ─────────────────────────────────────────
export function CidadeExpansaoModal({
  editando, latLng, onFechar, showToast,
}: {
  editando?: CidadeExpansao | null;
  latLng?: { lat: number; lng: number };
  onFechar: () => void;
  showToast: (msg: string, type?: string) => void;
}) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const pickLabel = (s: StatusExpansao) => pick(STATUS_META[s].label);
  const [nome,            setNome]            = useState(editando?.nome || '');
  const [pais,            setPais]            = useState(editando?.pais || 'BR');
  const [lat,             setLat]             = useState(editando?.lat || latLng?.lat || 0);
  const [lng,             setLng]             = useState(editando?.lng || latLng?.lng || 0);
  const [status,          setStatus]          = useState<StatusExpansao>(editando?.status || 'em_analise');
  const [populacao,       setPopulacao]       = useState(String(editando?.populacao || ''));
  const [mercadoEst,      setMercadoEst]      = useState(String(editando?.mercadoEst || ''));
  const [investimentoEst, setInvestimentoEst] = useState(String(editando?.investimentoEst || ''));
  const [dataPrevista,    setDataPrevista]    = useState(editando?.dataPrevista || '');
  const [responsavel,     setResponsavel]     = useState(editando?.responsavel || '');
  const [obs,             setObs]             = useState(editando?.obs || '');
  const [busy,            setBusy]            = useState(false);
  const [analisando,      setAnalisando]      = useState(false);
  const [analise,         setAnalise]         = useState<{
    score: number; pois: number; ciclovias: number; estimativa: number;
    detalhe: string[]; benchmark: string;
  } | null>(null);

  // Geocode cidade pelo nome
  const geocodeCidade = async () => {
    if (!nome.trim()) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(nome)}&format=json&limit=1`);
      const d = await r.json();
      if (d[0]) { setLat(parseFloat(d[0].lat)); setLng(parseFloat(d[0].lon)); }
    } catch {}
  };

  const analisarCidade = async () => {
    if (!lat || !lng) { showToast(pick(T.geocodeFirst), 'error'); return; }
    setAnalisando(true); setAnalise(null);
    const detalhe: string[] = [];
    try {
      // ── 1. POIs via Overpass ──────────────────────────────────
      const radius = 5000; // 5km do centro
      const overpassQ = `[out:json][timeout:20];(
        node["amenity"~"university|college|school"](around:${radius},${lat},${lng});
        node["shop"="mall"](around:${radius},${lat},${lng});
        node["public_transport"="station"](around:${radius},${lat},${lng});
        node["railway"~"subway_entrance|station"](around:${radius},${lat},${lng});
        node["amenity"~"restaurant|cafe|bar"](around:${radius},${lat},${lng});
        way["leisure"="park"](around:${radius},${lat},${lng});
      );out count;`;
      let pois = 0;
      try {
        const r = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST', body: overpassQ,
        });
        const d = await r.json();
        pois = d.elements?.[0]?.tags?.total || 0;
        detalhe.push(pick(T.poisInRadius) + pois);
      } catch { detalhe.push(pick(T.poisFetchError)); }

      // ── 2. Ciclovias via Overpass ─────────────────────────────
      const ciclQ = `[out:json][timeout:15];(
        way["highway"="cycleway"](around:10000,${lat},${lng});
        way["bicycle"="designated"](around:10000,${lat},${lng});
      );out count;`;
      let ciclovias = 0;
      try {
        const r2 = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST', body: ciclQ,
        });
        const d2 = await r2.json();
        ciclovias = d2.elements?.[0]?.tags?.total || 0;
        detalhe.push(pick(T.cyclewaySegments) + ciclovias);
      } catch { detalhe.push(pick(T.cyclewayFetchError)); }

      // ── 3. Score 0-100 ────────────────────────────────────────
      // Benchmark SP: ~8000 POIs, ~400 ciclovias, 4865 corridas/dia
      const SP_POIS = 8000; const SP_CICL = 400;
      const scorePOI   = Math.min(100, Math.round((pois / SP_POIS) * 100));
      const scoreCicl  = Math.min(100, Math.round((ciclovias / SP_CICL) * 100));
      const pop = Number(populacao) || 0;
      const SP_POP = 12300000;
      const scorePop   = pop > 0 ? Math.min(100, Math.round((pop / SP_POP) * 100)) : 30;
      const score = Math.round(scorePOI * 0.45 + scoreCicl * 0.25 + scorePop * 0.30);
      detalhe.push(pick(T.scorePOIs) + scorePOI + '/100');
      detalhe.push(pick(T.scoreMobility) + scoreCicl + '/100');
      detalhe.push(pick(T.scorePopulation) + scorePop + '/100');

      // ── 4. Estimativa corridas/mês ────────────────────────────
      // SP: ~4500 corridas/dia média → ~135.000/mês para ~1200 estações
      // Corridas por estação/dia = 4500/1200 ≈ 3.75
      // Estima estações necessárias: 1 a cada 400m numa área de 10km²
      // Área útil ≈ score% do raio de 5km
      const areaKm2 = Math.PI * 5 * 5 * (score / 100);
      const estacoesEst = Math.round(areaKm2 * 4); // ~4 est/km² em SP
      const corridasDia = Math.round(estacoesEst * 3.75 * (score / 100));
      const estimativa = corridasDia * 30;

      const benchmark = score >= 70
        ? pick(T.benchmarkHigh)
        : score >= 40
        ? pick(T.benchmarkMid)
        : pick(T.benchmarkLow);

      detalhe.push(pick(T.estStations) + estacoesEst);
      detalhe.push(pick(T.estRidesPerDay) + corridasDia);

      setAnalise({ score, pois, ciclovias, estimativa, detalhe, benchmark });
      if (!mercadoEst) setMercadoEst(String(estimativa));
    } catch (e: any) { showToast(pick(T.analysisError) + e.message, 'error'); }
    setAnalisando(false);
  };

  const salvar = async () => {
    if (!nome.trim()) { showToast(pick(T.enterCityName), 'error'); return; }
    if (!lat || !lng)  { showToast(pick(T.enterCoords), 'error'); return; }
    setBusy(true);
    try {
      const raw: Record<string, any> = {
        nome: nome.trim(), pais, lat, lng, status,
        atualizadoEm: serverTimestamp(),
      };
      if (populacao)       raw.populacao       = Number(populacao);
      if (mercadoEst)      raw.mercadoEst      = Number(mercadoEst);
      if (investimentoEst) raw.investimentoEst = Number(investimentoEst);
      if (dataPrevista)    raw.dataPrevista    = dataPrevista;
      if (responsavel)     raw.responsavel     = responsavel;
      if (obs)             raw.obs             = obs;

      const supaRow = {
        nome: nome.trim(), pais, lat, lng, status,
        populacao: populacao ? Number(populacao) : null,
        mercado_est: mercadoEst ? Number(mercadoEst) : null,
        investimento_est: investimentoEst ? Number(investimentoEst) : null,
        data_prevista: dataPrevista || null,
        responsavel: responsavel || null, obs: obs || null,
        atualizado_em: new Date().toISOString(),
      };
      if (editando) {
        await updateDoc(doc(db, 'cidades_expansao', editando.id), raw);
        // dual-write Supabase
        supabase.from('cidades_expansao').upsert({ id: editando.id, ...supaRow }, { onConflict: 'id' }).then(({ error }) => { if (error) console.error('[CidadesExp] upsert cidades_expansao:', error.message); });
        showToast(pick(T.cityUpdated), 'success');
      } else {
        const docRef = await addDoc(collection(db, 'cidades_expansao'), { ...raw, criadoEm: serverTimestamp() });
        // dual-write Supabase
        supabase.from('cidades_expansao').upsert({ id: docRef.id, ...supaRow, criado_em: new Date().toISOString() }, { onConflict: 'id' }).then(({ error }) => { if (error) console.error('[CidadesExp] insert cidades_expansao:', error.message); });
        showToast(pick(T.cityAdded), 'success');
      }
      onFechar();
    } catch (e: any) { showToast(pick(T.errorPrefix) + e.message, 'error'); }
    setBusy(false);
  };

  const excluir = async () => {
    if (!editando || !confirm(pick(T.confirmDelete).replace('{n}', editando.nome))) return;
    await deleteDoc(doc(db, 'cidades_expansao', editando.id));
    // dual-write Supabase
    supabase.from('cidades_expansao').delete().eq('id', editando.id).then(({ error }) => { if (error) console.error('[CidadesExp] delete cidades_expansao:', error.message); });
    showToast(pick(T.cityRemoved), 'success');
    onFechar();
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,.06)',
    border: '1px solid rgba(255,255,255,.1)', borderRadius: 7,
    color: '#fff', fontSize: 12, outline: 'none', fontFamily: 'inherit',
  };
  const lbl: React.CSSProperties = { fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 3, display: 'block' };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)' }}
      onClick={onFechar}>
      <div style={{ background:'#0c1018', border:'1px solid #1c2535', borderRadius:12, width:380, maxWidth:'94vw', maxHeight:'90vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 24px 80px rgba(0,0,0,.9)' }}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:'1px solid #1c2535', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#dce8ff' }}>
            {editando ? pick(T.editCity) : pick(T.newCity)}
          </div>
          <button onClick={onFechar} style={{ background:'none', border:'none', color:'#4a5a7a', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        {/* Form */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 18px', display:'flex', flexDirection:'column', gap:12 }}>

          {/* Status */}
          <div>
            <label style={lbl}>{pick(T.statusLabel)}</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
              {(Object.keys(STATUS_META) as StatusExpansao[]).map(s => {
                const m = STATUS_META[s];
                return (
                  <button key={s} onClick={() => setStatus(s)} style={{
                    padding:'5px 10px', borderRadius:8, border:'none', cursor:'pointer', fontSize:11, fontWeight:600,
                    background: status===s ? m.cor+'22' : 'rgba(255,255,255,.04)',
                    color: status===s ? m.cor : 'rgba(255,255,255,.3)',
                    outline: status===s ? `1px solid ${m.cor}66` : '1px solid rgba(255,255,255,.08)',
                  }}>{m.icon} {pickLabel(s)}</button>
                );
              })}
            </div>
          </div>

          {/* Nome + geocode */}
          <div>
            <label style={lbl}>{pick(T.cityNameLabel)}</label>
            <div style={{ display:'flex', gap:6 }}>
              <input value={nome} onChange={e=>setNome(e.target.value)}
                placeholder={pick(T.cityNamePlaceholder)} style={{ ...inp, flex:1 }} />
              <button onClick={geocodeCidade} title={pick(T.searchCoords)}
                style={{ padding:'8px 10px', borderRadius:7, border:'1px solid rgba(61,155,255,.3)', background:'rgba(61,155,255,.1)', color:'#3d9bff', cursor:'pointer', fontSize:12 }}>
                📍
              </button>
            </div>
          </div>

          {/* País + Coords */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            <div>
              <label style={lbl}>{pick(T.countryLabel)}</label>
              <input value={pais} onChange={e=>setPais(e.target.value)} placeholder="BR" style={inp} />
            </div>
            <div>
              <label style={lbl}>{pick(T.latitudeLabel)}</label>
              <input type="number" value={lat} onChange={e=>setLat(parseFloat(e.target.value))} step="0.0001" style={inp} />
            </div>
            <div>
              <label style={lbl}>{pick(T.longitudeLabel)}</label>
              <input type="number" value={lng} onChange={e=>setLng(parseFloat(e.target.value))} step="0.0001" style={inp} />
            </div>
          </div>

          {/* Métricas */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            <div>
              <label style={lbl}>{pick(T.populationLabel)}</label>
              <input type="number" value={populacao} onChange={e=>setPopulacao(e.target.value)} placeholder={pick(T.populationPlaceholder)} style={inp} />
            </div>
            <div>
              <label style={lbl}>{pick(T.ridesPerMonthLabel)}</label>
              <input type="number" value={mercadoEst} onChange={e=>setMercadoEst(e.target.value)} placeholder="0" style={inp} />
            </div>
            <div>
              <label style={lbl}>{pick(T.investmentLabel)}</label>
              <input type="number" value={investimentoEst} onChange={e=>setInvestimentoEst(e.target.value)} placeholder="0" style={inp} />
            </div>
          </div>

          {/* Data + Responsável */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <div>
              <label style={lbl}>{pick(T.plannedDateLabel)}</label>
              <input type="date" value={dataPrevista} onChange={e=>setDataPrevista(e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>{pick(T.ownerLabel)}</label>
              <input value={responsavel} onChange={e=>setResponsavel(e.target.value)} placeholder={pick(T.ownerPlaceholder)} style={inp} />
            </div>
          </div>

          {/* Obs */}
          <div>
            <label style={lbl}>{pick(T.notesLabel)}</label>
            <textarea value={obs} onChange={e=>setObs(e.target.value)} rows={3}
              placeholder={pick(T.notesPlaceholder)} style={{ ...inp, resize:'vertical' as any }} />
          </div>
        </div>

        {/* Análise automática */}
        <div>
          <button onClick={analisarCidade} disabled={analisando || !lat || !lng} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: analisando || !lat || !lng ? 'not-allowed' : 'pointer',
            background: analisando ? 'rgba(99,102,241,.3)' : 'linear-gradient(135deg,rgba(99,102,241,.8),rgba(139,92,246,.8))',
            color: '#fff', fontSize: 12, fontWeight: 700,
          }}>
            {analisando ? pick(T.analyzingOSM) : pick(T.analyzePotential)}
          </button>

          {analise && (
            <div style={{ marginTop: 10, padding: 12, borderRadius: 8,
              background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)' }}>

              {/* Score */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" style={{ width: 56, height: 56, transform: 'rotate(-90deg)' }}>
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3"/>
                    <circle cx="18" cy="18" r="15.9" fill="none"
                      stroke={analise.score >= 70 ? '#2ecc71' : analise.score >= 40 ? '#f5c842' : '#f87171'}
                      strokeWidth="3" strokeDasharray={`${analise.score} ${100 - analise.score}`}
                      strokeLinecap="round"/>
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 13, fontWeight: 800,
                    color: analise.score >= 70 ? '#2ecc71' : analise.score >= 40 ? '#f5c842' : '#f87171',
                    fontFamily: "'IBM Plex Mono',monospace" }}>{analise.score}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#dce8ff', marginBottom: 3 }}>
                    {pick(T.potentialScore)}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', lineHeight: 1.4 }}>
                    {analise.benchmark}
                  </div>
                </div>
              </div>

              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
                {([
                  [pick(T.kpiPOIs), analise.pois.toLocaleString('pt-BR'), '#60a5fa'],
                  [pick(T.kpiCycleways), analise.ciclovias + pick(T.kpiSegmentsSuffix), '#2ecc71'],
                  [pick(T.kpiEstRidesMonth), analise.estimativa.toLocaleString('pt-BR'), '#f5c842'],
                ] as [string,string,string][]).map(([l,v,c]) => (
                  <div key={l} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 6,
                    padding: '7px 6px', textAlign: 'center', border: '1px solid rgba(255,255,255,.06)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: c,
                      fontFamily: "'IBM Plex Mono',monospace" }}>{v}</div>
                    <div style={{ fontSize: 9, color: '#4a5a7a', marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Detalhes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {analise.detalhe.map((d, i) => (
                  <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,.35)',
                    display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ color: '#818cf8', flexShrink: 0 }}>›</span>{d}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,.25)', fontStyle: 'italic' }}>
                {pick(T.autoFilledNote)}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 18px', borderTop:'1px solid #1c2535', display:'flex', gap:8 }}>
          {editando && (
            <button onClick={excluir} style={{ padding:'10px 12px', borderRadius:8, border:'1px solid rgba(239,68,68,.3)', background:'rgba(239,68,68,.08)', color:'#ef4444', cursor:'pointer', fontSize:12 }}>🗑</button>
          )}
          <button onClick={onFechar} style={{ flex:1, padding:'10px', borderRadius:8, border:'1px solid rgba(255,255,255,.08)', background:'rgba(255,255,255,.04)', color:'rgba(255,255,255,.4)', cursor:'pointer', fontSize:12 }}>{pick(T.cancel)}</button>
          <button onClick={salvar} disabled={busy} style={{ flex:2, padding:'10px', borderRadius:8, border:'none', background: busy?'rgba(48,127,226,.3)':'linear-gradient(135deg,#1a6fd4,#307FE2)', color:'#fff', fontSize:13, fontWeight:700, cursor: busy?'not-allowed':'pointer' }}>
            {busy ? pick(T.saving) : editando ? pick(T.save) : pick(T.add)}
          </button>
        </div>
      </div>
    </div>
  );
}
