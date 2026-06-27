// frontend/src/lib/edge-functions.ts
// Bridge: redireciona chamadas que antes iam p/ Firebase Cloud Functions
// para Supabase Edge Functions, atrás da flag jet_functions_provider.
// A assinatura emula httpsCallable — { data } como arg, { data } como retorno —
// para minimizar mudanças nos call sites.

import { supabase } from './supabase';

export const functionsProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_functions_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_FUNCTIONS_PROVIDER as string) !== 'firebase';
};

type CallableResult = { data: any };
type CallableFn = (req: { data?: any } | any) => Promise<CallableResult>;

async function invokeEdge(fnName: string, action: string | null, payload: any): Promise<CallableResult> {
  const body = action ? { action, ...payload } : payload;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Edge ${fnName}: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return { data };
}

function edgeCallable(fnName: string, action?: string): () => CallableFn {
  return () => (req: any) => {
    const payload = req?.data ?? req ?? {};
    return invokeEdge(fnName, action ?? null, payload);
  };
}

// Mapeamento Cloud Function → Edge Function + action
const EDGE_MAP: Record<string, () => CallableFn> = {
  gerarCroquiFn:            edgeCallable('croquis', 'gerar'),
  gerarCroquisLoteFn:       edgeCallable('croquis', 'gerar-lote'),
  gerarStreetViewFn:        edgeCallable('streetview', 'fetch'),
  svEstatisticasFn:         edgeCallable('streetview', 'estatisticas'),
  analisarCalcadaFn:        edgeCallable('estacoes', 'analisar-calcada'),
  addEstacaoFn:             edgeCallable('estacoes', 'add'),
  geocodeForwardFn:         edgeCallable('geocode', 'forward'),
  updatePrestadorPositionFn: edgeCallable('estacoes', 'update-position'),
  buscarPOIsFn:             edgeCallable('buscar-pois-osm'),
  buscarPOIsOSMFn:          edgeCallable('buscar-pois-osm'),
  aceitarSlot:              edgeCallable('slots-actions', 'aceitar'),
  notificarOcorrencia:      edgeCallable('slots-actions', 'notificar-ocorrencia'),
  notificarTarefa:          edgeCallable('slots-actions', 'notificar-tarefa'),
  registrarTelegramChatId:  edgeCallable('slots-actions', 'registrar-chat-id'),
  testarTelegram:           edgeCallable('slots-actions', 'testar-telegram'),
  aprovarSolicitacaoFn:     edgeCallable('auth-actions', 'aprovar-solicitacao'),
  revogarAcesso:            edgeCallable('auth-actions', 'revogar-acesso'),
  getUsuario:               edgeCallable('get-usuario'),
  scraperGoJetManual:       edgeCallable('automacao-gojet', 'scraper-manual'),
  gerarSlotsManualFn:       edgeCallable('automacao-tarefas', 'gerar-slots-manual'),
  exportarHistoricoParking: edgeCallable('automacao-tarefas', 'exportar-historico-parking'),
  enviarResumoManual:       edgeCallable('slots-telegram', 'enviar-resumo-manual'),
  relatorioGuardManualFn:   edgeCallable('relatorios', 'guard-manual'),
  enviarRelatorioManual:    edgeCallable('relatorios', 'guard-manual'),
};

export function getEdgeCallable(firebaseFnName: string): (() => CallableFn) | null {
  return EDGE_MAP[firebaseFnName] ?? null;
}
