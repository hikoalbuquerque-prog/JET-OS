// frontend/src/components/LgpdConsentGate.tsx
// Tela de consentimento LGPD para rastreamento de localização (segurança jurídica).
//
// Exibida para perfis de campo (rastreados) ANTES do permission gate, em web e APK.
// O aceite é gravado de forma IMUTÁVEL no Firestore (coleção consentimentos_lgpd),
// com data/hora, versão do termo, identidade e dispositivo — constituindo prova do
// consentimento informado nos termos do art. 8º da Lei 13.709/2018 (LGPD).
//
// Para reapresentar o termo após uma revisão jurídica, basta incrementar LGPD_VERSAO:
// o id do registro inclui a versão, então um novo aceite será exigido.

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Versão do termo. Incrementar quando o texto mudar → força novo aceite.
export const LGPD_VERSAO = '1.0';

// Perfis cuja localização é processada (slots, tarefas, turnos, ocorrências).
// Mantém alinhado com FIELD_ROLES do AndroidPermissionGate + guard (captura pontual).
export const ROLES_RASTREADOS = [
  'logistica', 'campo', 'charger', 'scalt', 'promotor', 'guard',
];

interface Props {
  uid: string;
  email: string;
  nome: string;
  role: string;
  onAceito: () => void;   // todas as condições ok → segue para o app
  onRecusado: () => void; // recusou → logout (não pode operar sem consentir)
}

// Verifica se já existe aceite da versão atual para este usuário.
async function jaConsentiu(uid: string): Promise<boolean> {
  try {
    const ref = doc(db, 'consentimentos_lgpd', `${uid}_v${LGPD_VERSAO}`);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch {
    // Falha de rede/permissão: por segurança, reapresenta o termo (não bloqueia o fluxo legal).
    return false;
  }
}

async function registrarAceite(p: Props): Promise<void> {
  const ref = doc(db, 'consentimentos_lgpd', `${p.uid}_v${LGPD_VERSAO}`);
  await setDoc(ref, {
    uid:        p.uid,
    email:      p.email || '',
    nome:       p.nome || '',
    role:       p.role || '',
    versao:     LGPD_VERSAO,
    aceito:     true,
    aceitoEm:   serverTimestamp(),
    aceitoEmTs: Date.now(),
    userAgent:  navigator.userAgent.slice(0, 300),
    plataforma: navigator.platform,
    idioma:     navigator.language,
  });
}

const S = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 9100,
    background: '#080e1a',
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    padding: '24px 18px',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    width: '100%', maxWidth: 440, maxHeight: '92vh',
    background: '#0f1929',
    border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 20, padding: '24px 22px',
    display: 'flex', flexDirection: 'column' as const, gap: 16,
  },
  termo: {
    background: 'rgba(255,255,255,.03)',
    border: '1px solid rgba(255,255,255,.08)',
    borderRadius: 12, padding: '14px 16px',
    overflowY: 'auto' as const, flex: 1, minHeight: 0,
    fontSize: 12.5, lineHeight: 1.6, color: 'rgba(255,255,255,.72)',
  },
  h: { color: '#dce8ff', fontWeight: 700, fontSize: 13, margin: '14px 0 4px' } as React.CSSProperties,
  checkboxRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    fontSize: 12.5, color: '#dce8ff', lineHeight: 1.45, cursor: 'pointer',
  } as React.CSSProperties,
  aceitar: (active: boolean) => ({
    width: '100%', padding: 14, borderRadius: 10, border: 'none',
    cursor: active ? 'pointer' : 'default', fontWeight: 700, fontSize: 14,
    background: active ? 'linear-gradient(135deg,#10b981,#059669)' : 'rgba(255,255,255,.08)',
    color: active ? '#fff' : 'rgba(255,255,255,.3)',
  } as React.CSSProperties),
  recusar: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,.3)',
    fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
  } as React.CSSProperties,
};

export default function LgpdConsentGate(props: Props) {
  const { uid, onAceito, onRecusado } = props;
  const [estado, setEstado] = useState<'checando' | 'termo'>('checando');
  const [marcado, setMarcado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    jaConsentiu(uid).then(ok => {
      if (!vivo) return;
      if (ok) onAceito();
      else setEstado('termo');
    });
    return () => { vivo = false; };
  }, [uid]);

  const handleAceitar = useCallback(async () => {
    if (!marcado || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await registrarAceite(props);
      onAceito();
    } catch (e: any) {
      console.error('[LGPD] erro ao registrar aceite:', e);
      setErro('Não foi possível registrar o aceite. Verifique a conexão e tente novamente.');
      setSalvando(false);
    }
  }, [marcado, salvando, props, onAceito]);

  if (estado === 'checando') return null;

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>🛡️</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#dce8ff' }}>
            Consentimento de Localização
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
            Lei Geral de Proteção de Dados (Lei nº 13.709/2018)
          </div>
        </div>

        <div style={S.termo}>
          <p>
            Para a execução das suas atividades operacionais na Jet, o aplicativo
            <strong> JET OS</strong> coleta e processa dados da sua localização
            geográfica (GPS). Leia atentamente as condições abaixo antes de aceitar.
          </p>

          <div style={S.h}>1. Quando a localização é coletada</div>
          <p>
            O rastreamento ocorre <strong>estritamente durante a execução de turnos,
            slots e tarefas</strong> — ou seja, a partir do check-in/início da atividade
            e até o encerramento. <strong>Fora desses períodos a coleta não acontece.</strong>
          </p>

          <div style={S.h}>2. Quais dados são coletados</div>
          <p>
            Coordenadas (latitude/longitude), precisão, velocidade, direção, altitude,
            nível de bateria do dispositivo e data/hora de cada registro. Também é
            verificada a autenticidade do sinal (detecção de GPS falso/simulado).
          </p>

          <div style={S.h}>3. Finalidade</div>
          <p>
            Os dados são usados <strong>exclusivamente</strong> para: gestão e
            comprovação da execução das atividades, segurança do operador e dos ativos,
            otimização logística e atribuição de tarefas por proximidade.
            <strong> Não são utilizados para qualquer outra finalidade</strong>, nem
            para monitoramento fora do horário de trabalho, nem comercializados ou
            compartilhados com terceiros sem base legal.
          </p>

          <div style={S.h}>4. Armazenamento e retenção</div>
          <p>
            Os registros são armazenados de forma segura apenas pelo período necessário
            ao cumprimento das finalidades acima e de obrigações legais. Não há
            armazenamento para fins diversos dos aqui descritos.
          </p>

          <div style={S.h}>5. Base legal</div>
          <p>
            O tratamento se fundamenta no seu <strong>consentimento</strong> (art. 7º, I)
            e na execução do contrato/atividade da qual você é parte (art. 7º, V) da LGPD.
          </p>

          <div style={S.h}>6. Seus direitos</div>
          <p>
            Você pode, a qualquer momento, solicitar acesso, correção ou exclusão dos
            seus dados, bem como revogar este consentimento. A revogação encerra o
            rastreamento e pode impossibilitar a execução de atividades que dependem da
            localização. Para exercer seus direitos, contate a gestão da Jet.
          </p>

          <p style={{ marginTop: 14, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
            Versão do termo: {LGPD_VERSAO}. O seu aceite será registrado com data, hora e
            identificação para fins de comprovação.
          </p>
        </div>

        <label style={S.checkboxRow}>
          <input
            type="checkbox"
            checked={marcado}
            onChange={e => setMarcado(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: '#10b981' }}
          />
          <span>
            Li e <strong>concordo</strong> com a coleta e o tratamento da minha
            localização nas condições acima, durante turnos, slots e tarefas.
          </span>
        </label>

        {erro && (
          <div style={{ fontSize: 11.5, color: '#f87171', textAlign: 'center' }}>{erro}</div>
        )}

        <button
          onClick={handleAceitar}
          disabled={!marcado || salvando}
          style={S.aceitar(marcado && !salvando)}
        >
          {salvando ? 'Registrando…' : 'Aceitar e continuar'}
        </button>

        <div style={{ textAlign: 'center' }}>
          <button onClick={onRecusado} style={S.recusar}>
            Não aceito — sair do app
          </button>
        </div>
      </div>
    </div>
  );
}
