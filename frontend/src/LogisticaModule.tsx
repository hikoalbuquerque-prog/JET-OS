import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';

// ===== i18n (pt fonte fiel) =====
type TStr = { pt: string; en: string; es: string; ru: string };
const curLang = (): 'pt' | 'en' | 'es' | 'ru' => (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
const mpick = (o: TStr) => o[curLang()] ?? o.pt;

const T = {
  cpf11Digitos: { pt: 'CPF deve ter 11 dígitos', en: 'CPF must have 11 digits', es: 'El CPF debe tener 11 dígitos', ru: 'CPF должен содержать 11 цифр' },
  cpfInvalido: { pt: 'CPF inválido', en: 'Invalid CPF', es: 'CPF inválido', ru: 'Недействительный CPF' },
  cnpj14Digitos: { pt: 'CNPJ deve ter 14 dígitos', en: 'CNPJ must have 14 digits', es: 'El CNPJ debe tener 14 dígitos', ru: 'CNPJ должен содержать 14 цифр' },
  cnpjInvalido: { pt: 'CNPJ inválido', en: 'Invalid CNPJ', es: 'CNPJ inválido', ru: 'Недействительный CNPJ' },
  chavePixObrigatoria: { pt: 'Chave Pix obrigatória', en: 'Pix key is required', es: 'Clave Pix obligatoria', ru: 'Требуется ключ Pix' },
  emailInvalido: { pt: 'Email inválido', en: 'Invalid email', es: 'Correo electrónico inválido', ru: 'Недействительный email' },
  telefoneInvalido: { pt: 'Telefone inválido (11 dígitos)', en: 'Invalid phone (11 digits)', es: 'Teléfono inválido (11 dígitos)', ru: 'Недействительный телефон (11 цифр)' },
  telegramDigitos: { pt: 'Telegram deve ter 7-13 dígitos', en: 'Telegram must have 7-13 digits', es: 'Telegram debe tener 7-13 dígitos', ru: 'Telegram должен содержать 7-13 цифр' },
  moduloLogistica: { pt: '📦 Módulo de Logística', en: '📦 Logistics Module', es: '📦 Módulo de Logística', ru: '📦 Модуль логистики' },
  tabDashboard: { pt: '📊 Dashboard', en: '📊 Dashboard', es: '📊 Panel', ru: '📊 Панель' },
  tabOperacoes: { pt: '✓ Operações', en: '✓ Operations', es: '✓ Operaciones', ru: '✓ Операции' },
  tabRotas: { pt: '🛣️ Rotas', en: '🛣️ Routes', es: '🛣️ Rutas', ru: '🛣️ Маршруты' },
  tabSlots: { pt: '⏰ Slots', en: '⏰ Slots', es: '⏰ Franjas', ru: '⏰ Слоты' },
  tabMonitores: { pt: '📍 Monitores', en: '📍 Monitors', es: '📍 Monitores', ru: '📍 Мониторы' },
  operacoesAtivas: { pt: 'Operações Ativas', en: 'Active Operations', es: 'Operaciones Activas', ru: 'Активные операции' },
  concluidasHoje: { pt: 'Concluídas Hoje', en: 'Completed Today', es: 'Completadas Hoy', ru: 'Завершено сегодня' },
  proximasRotas: { pt: 'Próximas Rotas', en: 'Upcoming Routes', es: 'Próximas Rutas', ru: 'Предстоящие маршруты' },
  tarefas: { pt: 'tarefas', en: 'tasks', es: 'tareas', ru: 'задач' },
  criarNovaOperacao: { pt: 'CRIAR NOVA OPERAÇÃO', en: 'CREATE NEW OPERATION', es: 'CREAR NUEVA OPERACIÓN', ru: 'СОЗДАТЬ НОВУЮ ОПЕРАЦИЮ' },
  rebalanceamento: { pt: 'Rebalanceamento', en: 'Rebalancing', es: 'Reequilibrio', ru: 'Перебалансировка' },
  reparo: { pt: 'Reparo', en: 'Repair', es: 'Reparación', ru: 'Ремонт' },
  coleta: { pt: 'Coleta', en: 'Pickup', es: 'Recogida', ru: 'Сбор' },
  entrega: { pt: 'Entrega', en: 'Delivery', es: 'Entrega', ru: 'Доставка' },
  manutencao: { pt: 'Manutenção', en: 'Maintenance', es: 'Mantenimiento', ru: 'Обслуживание' },
  quantidade: { pt: 'Quantidade', en: 'Quantity', es: 'Cantidad', ru: 'Количество' },
  descricao: { pt: 'Descrição', en: 'Description', es: 'Descripción', ru: 'Описание' },
  criarOperacao: { pt: '+ Criar Operação', en: '+ Create Operation', es: '+ Crear Operación', ru: '+ Создать операцию' },
  operacoes: { pt: 'Operações', en: 'Operations', es: 'Operaciones', ru: 'Операции' },
  unidades: { pt: 'unidades', en: 'units', es: 'unidades', ru: 'единиц' },
  gerarRotaOtimizada: { pt: '🛣️ Gerar Rota Otimizada', en: '🛣️ Generate Optimized Route', es: '🛣️ Generar Ruta Optimizada', ru: '🛣️ Создать оптимизированный маршрут' },
  rota: { pt: 'Rota', en: 'Route', es: 'Ruta', ru: 'Маршрут' },
  distancia: { pt: 'Distância', en: 'Distance', es: 'Distancia', ru: 'Расстояние' },
  tempo: { pt: 'Tempo', en: 'Time', es: 'Tiempo', ru: 'Время' },
  status: { pt: 'Status', en: 'Status', es: 'Estado', ru: 'Статус' },
  novoSlot: { pt: '⏰ Novo Slot', en: '⏰ New Slot', es: '⏰ Nueva Franja', ru: '⏰ Новый слот' },
  atual: { pt: 'Atual', en: 'Current', es: 'Actual', ru: 'Текущее' },
  ideal: { pt: 'Ideal', en: 'Ideal', es: 'Ideal', ru: 'Идеальное' },
};

interface Operacao {
  id: string;
  tipo: 'coleta' | 'entrega' | 'rebalanceamento' | 'reparo' | 'manutencao';
  status: 'pendente' | 'em_progresso' | 'concluida' | 'cancelada';
  prioridade: 1 | 2 | 3 | 4 | 5;
  estacao: { nome: string; lat: number; lng: number; id: string };
  quantidade: number;
  descricao: string;
  dataCriacao: Date;
  dataVencimento: Date;
  responsavel?: string;
  coordenadas?: { lat: number; lng: number };
  distancia?: number;
}

interface Slot {
  id: string;
  tipo: 'automatico' | 'manual';
  horario: string;
  tarefas: string[];
  status: 'ativo' | 'pausado' | 'concluido';
  repeticao: 'diaria' | 'semanal' | 'mensal' | 'unica';
  proximaExecucao: Date;
}

interface Monitor {
  id: string;
  nome: string;
  cidade: string;
  pais: string;
  quantidadeIdeal: number;
  quantidadeAtual: number;
  latitude: number;
  longitude: number;
  tipo: 'publica' | 'privada' | 'parceria';
}

interface Rota {
  id: string;
  tarefas: Operacao[];
  distanciaTotal: number;
  tempoEstimado: number;
  status: 'planejamento' | 'ativa' | 'concluida';
  prioridade: number;
  coordenadas: { lat: number; lng: number }[];
}

interface ValidacaoCampo {
  valido: boolean;
  erro?: string;
}

// VALIDAÇÕES
const validarCPF = (cpf: string): ValidacaoCampo => {
  cpf = cpf.replace(/[^\d]/g, '');
  if (cpf.length !== 11) return { valido: false, erro: mpick(T.cpf11Digitos) };
  const regex = /^(\d)\1{10}$/;
  if (regex.test(cpf)) return { valido: false, erro: mpick(T.cpfInvalido) };
  let soma = 0;
  let resto = 0;
  for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(9, 10))) return { valido: false, erro: mpick(T.cpfInvalido) };
  soma = 0;
  for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(10, 11))) return { valido: false, erro: mpick(T.cpfInvalido) };
  return { valido: true };
};

const validarCNPJ = (cnpj: string): ValidacaoCampo => {
  cnpj = cnpj.replace(/[^\d]/g, '');
  if (cnpj.length !== 14) return { valido: false, erro: mpick(T.cnpj14Digitos) };
  const regex = /^(\d)\1{13}$/;
  if (regex.test(cnpj)) return { valido: false, erro: mpick(T.cnpjInvalido) };
  let tamanho = cnpj.length - 2;
  let numeros = cnpj.substring(0, tamanho);
  let digitos = cnpj.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i)) * pos;
    pos -= 1;
    if (pos < 2) pos = 9;
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(0))) return { valido: false, erro: mpick(T.cnpjInvalido) };
  tamanho += 1;
  numeros = cnpj.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i)) * pos;
    pos -= 1;
    if (pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(1))) return { valido: false, erro: mpick(T.cnpjInvalido) };
  return { valido: true };
};

const validarChavePix = (chave: string, tipo: string): ValidacaoCampo => {
  if (!chave.trim()) return { valido: false, erro: mpick(T.chavePixObrigatoria) };
  if (tipo === 'CPF') {
    return validarCPF(chave);
  } else if (tipo === 'CNPJ') {
    return validarCNPJ(chave);
  } else if (tipo === 'EMAIL') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(chave) ? { valido: true } : { valido: false, erro: mpick(T.emailInvalido) };
  } else if (tipo === 'TELEFONE') {
    const telRegex = /^\d{11}$/;
    return telRegex.test(chave.replace(/[^\d]/g, '')) ? { valido: true } : { valido: false, erro: mpick(T.telefoneInvalido) };
  }
  return { valido: true };
};

const validarTelegram = (numero: string): ValidacaoCampo => {
  const telegramRegex = /^\d{7,13}$/;
  const limpo = numero.replace(/[^\d]/g, '');
  if (!telegramRegex.test(limpo)) return { valido: false, erro: mpick(T.telegramDigitos) };
  return { valido: true };
};

// ALGORITMO DE ROTA OTIMIZADA (Greedy + Haversine)
const calcularDistancia = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.asin(Math.sqrt(a));
};

const otimizarRota = (operacoes: Operacao[], pontoPartida: { lat: number; lng: number }): Rota => {
  const tarefasOrdenadas: Operacao[] = [];
  let posicaoAtual = pontoPartida;
  const tarefasRestantes = [...operacoes];
  let distanciaTotal = 0;

  while (tarefasRestantes.length > 0) {
    let proximaTarefa = tarefasRestantes[0];
    let menorDistancia = calcularDistancia(posicaoAtual.lat, posicaoAtual.lng,
      proximaTarefa.estacao.lat, proximaTarefa.estacao.lng);

    for (let i = 1; i < tarefasRestantes.length; i++) {
      const dist = calcularDistancia(posicaoAtual.lat, posicaoAtual.lng,
        tarefasRestantes[i].estacao.lat, tarefasRestantes[i].estacao.lng);
      if (dist < menorDistancia) {
        menorDistancia = dist;
        proximaTarefa = tarefasRestantes[i];
      }
    }

    tarefasOrdenadas.push(proximaTarefa);
    distanciaTotal += menorDistancia;
    posicaoAtual = { lat: proximaTarefa.estacao.lat, lng: proximaTarefa.estacao.lng };
    tarefasRestantes.splice(tarefasRestantes.indexOf(proximaTarefa), 1);
  }

  return {
    id: 'rota_' + Date.now(),
    tarefas: tarefasOrdenadas,
    distanciaTotal,
    tempoEstimado: Math.ceil(distanciaTotal / 30 * 60),
    status: 'planejamento',
    prioridade: Math.max(...operacoes.map(o => o.prioridade)),
    coordenadas: tarefasOrdenadas.map(t => ({ lat: t.estacao.lat, lng: t.estacao.lng }))
  };
};

// COMPONENTE PRINCIPAL
export default function LogisticaModule({ usuario, onFechar }: any) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
  const [abas, setAbas] = useState<'dashboard' | 'operacoes' | 'rotas' | 'slots' | 'monitores'>('dashboard');
  const [operacoes, setOperacoes] = useState<Operacao[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [monitores, setMonitores] = useState<Monitor[]>([]);
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [novaOp, setNovaOp] = useState({ tipo: 'rebalanceamento' as any, quantidade: 10, descricao: '' });
  const [validacoes, setValidacoes] = useState<any>({});

  const inp = { width: '100%', padding: '10px 12px', borderRadius: 8, boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff', fontSize: 13, outline: 'none' };

  const lbl = { display: 'block' as const, color: 'rgba(255,255,255,.45)', fontSize: 10, fontWeight: 600 as const, marginBottom: 5 };

  return (
    <div style={{
      position: 'fixed', top: 60, right: 12, zIndex: 1400,
      width: 520, maxHeight: '85vh', background: '#0a0f1e',
      borderRadius: 14, border: '1px solid rgba(16, 185, 129, 0.1)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.7)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden'
    }}>
      {/* HEADER */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'rgba(16, 185, 129, 0.1)', flexShrink: 0
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>{pick(T.moduloLogistica)}</div>
        <button onClick={onFechar} style={{
          background: 'none', border: 'none', color: 'rgba(255, 255, 255, 0.4)',
          cursor: 'pointer', fontSize: 18
        }}>✕</button>
      </div>

      {/* ABAS */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.1)',
        overflowX: 'auto', scrollbarWidth: 'none' as any
      }}>
        {[
          { k: 'dashboard', l: pick(T.tabDashboard) },
          { k: 'operacoes', l: pick(T.tabOperacoes) },
          { k: 'rotas', l: pick(T.tabRotas) },
          { k: 'slots', l: pick(T.tabSlots) },
          { k: 'monitores', l: pick(T.tabMonitores) }
        ].map(a => (
          <button key={a.k} onClick={() => setAbas(a.k as any)} style={{
            padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: abas === a.k ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${abas === a.k ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255,255,255,.08)'}`,
            color: abas === a.k ? '#10b981' : 'rgba(255,255,255,.4)', cursor: 'pointer',
            whiteSpace: 'nowrap' as const
          }}>{a.l}</button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, color: '#dce8ff', fontSize: 12 }}>

        {/* DASHBOARD */}
        {abas === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ padding: 12, background: 'rgba(16,185,129,.1)', borderRadius: 8, border: '1px solid rgba(16,185,129,.2)' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)' }}>{pick(T.operacoesAtivas)}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981', marginTop: 4 }}>{operacoes.filter(o => o.status === 'em_progresso').length}</div>
              </div>
              <div style={{ padding: 12, background: 'rgba(59,130,246,.1)', borderRadius: 8, border: '1px solid rgba(59,130,246,.2)' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)' }}>{pick(T.concluidasHoje)}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6', marginTop: 4 }}>{operacoes.filter(o => o.status === 'concluida').length}</div>
              </div>
            </div>
            <div style={{ padding: 12, background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{pick(T.proximasRotas)}</div>
              {rotas.slice(0, 3).map(r => (
                <div key={r.id} style={{ fontSize: 10, padding: 4, marginBottom: 4, background: 'rgba(255,255,255,.02)', borderRadius: 4 }}>
                  {r.tarefas.length} {pick(T.tarefas)} • {r.distanciaTotal.toFixed(1)}km • {r.tempoEstimado}min
                </div>
              ))}
            </div>
          </div>
        )}

        {/* OPERAÇÕES */}
        {abas === 'operacoes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={lbl}>{pick(T.criarNovaOperacao)}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select value={novaOp.tipo} onChange={e => setNovaOp({...novaOp, tipo: e.target.value})} style={inp as any}>
                  <option value="rebalanceamento">{pick(T.rebalanceamento)}</option>
                  <option value="reparo">{pick(T.reparo)}</option>
                  <option value="coleta">{pick(T.coleta)}</option>
                  <option value="entrega">{pick(T.entrega)}</option>
                  <option value="manutencao">{pick(T.manutencao)}</option>
                </select>
                <input type="number" placeholder={pick(T.quantidade)} value={novaOp.quantidade} onChange={e => setNovaOp({...novaOp, quantidade: parseInt(e.target.value)})} style={inp}/>
                <input type="text" placeholder={pick(T.descricao)} value={novaOp.descricao} onChange={e => setNovaOp({...novaOp, descricao: e.target.value})} style={inp}/>
                <button onClick={() => {}} style={{
                  padding: '8px 12px', background: '#10b981', border: 'none', borderRadius: 6,
                  color: '#fff', fontWeight: 600, cursor: 'pointer'
                }}>{pick(T.criarOperacao)}</button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: '#10b981' }}>{pick(T.operacoes)}</div>
              {operacoes.map(o => (
                <div key={o.id} style={{ fontSize: 10, padding: 8, marginBottom: 6, background: 'rgba(255,255,255,.02)', borderRadius: 6, border: '1px solid rgba(255,255,255,.05)' }}>
                  <div style={{ fontWeight: 600 }}>{o.tipo} • {o.status}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{o.estacao.nome} • {o.quantidade} {pick(T.unidades)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ROTAS */}
        {abas === 'rotas' && (
          <div>
            <button onClick={() => {}} style={{
              width: '100%', padding: '8px', background: '#10b981', border: 'none', borderRadius: 6,
              color: '#fff', fontWeight: 600, cursor: 'pointer', marginBottom: 12
            }}>{pick(T.gerarRotaOtimizada)}</button>
            {rotas.map(r => (
              <div key={r.id} style={{ fontSize: 10, padding: 10, marginBottom: 8, background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{pick(T.rota)} {r.tarefas.length} {pick(T.tarefas)}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.5)' }}>
                  {pick(T.distancia)}: {r.distanciaTotal.toFixed(1)}km | {pick(T.tempo)}: {r.tempoEstimado}min | {pick(T.status)}: {r.status}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SLOTS */}
        {abas === 'slots' && (
          <div>
            <button onClick={() => {}} style={{
              width: '100%', padding: '8px', background: '#10b981', border: 'none', borderRadius: 6,
              color: '#fff', fontWeight: 600, cursor: 'pointer', marginBottom: 12
            }}>{pick(T.novoSlot)}</button>
            {slots.map(s => (
              <div key={s.id} style={{ fontSize: 10, padding: 10, marginBottom: 8, background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                <div style={{ fontWeight: 600 }}>{s.tipo} • {s.horario} • {s.repeticao}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{s.tarefas.length} {pick(T.tarefas)} • {s.status}</div>
              </div>
            ))}
          </div>
        )}

        {/* MONITORES */}
        {abas === 'monitores' && (
          <div>
            {monitores.map(m => (
              <div key={m.id} style={{ fontSize: 10, padding: 10, marginBottom: 8, background: 'rgba(255,255,255,.03)', borderRadius: 6 }}>
                <div style={{ fontWeight: 600 }}>{m.nome}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>
                  {pick(T.atual)}: {m.quantidadeAtual} / {pick(T.ideal)}: {m.quantidadeIdeal} • {m.tipo}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
