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
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

// Versão do termo. Incrementar quando o texto mudar → força novo aceite.
export const LGPD_VERSAO = '1.0';

// ── Textos multilíngues (pt fonte fiel) — padrão do OnboardingWizard: objetos
// { pt, en, es, ru } definidos no componente, sem chaves de arquivo json. ──────
type Lang = 'pt' | 'en' | 'es' | 'ru';
type LocStr = { pt: string; en: string; es: string; ru: string };

const T = {
  titulo: {
    pt: 'Consentimento de Localização',
    en: 'Location Consent',
    es: 'Consentimiento de Ubicación',
    ru: 'Согласие на определение местоположения',
  } as LocStr,
  subtitulo: {
    pt: 'Lei Geral de Proteção de Dados (Lei nº 13.709/2018)',
    en: 'Brazilian General Data Protection Law (LGPD — Law No. 13.709/2018)',
    es: 'Ley General de Protección de Datos de Brasil (LGPD — Ley nº 13.709/2018)',
    ru: 'Бразильский Общий закон о защите данных (LGPD — Закон № 13.709/2018)',
  } as LocStr,
  intro: {
    pt: 'Para a execução das suas atividades operacionais na Jet, o aplicativo JET OS coleta e processa dados da sua localização geográfica (GPS). Leia atentamente as condições abaixo antes de aceitar.',
    en: 'To carry out your operational activities at Jet, the JET OS app collects and processes your geographic location (GPS) data. Please read the conditions below carefully before accepting.',
    es: 'Para la ejecución de tus actividades operativas en Jet, la aplicación JET OS recopila y procesa datos de tu ubicación geográfica (GPS). Lee atentamente las condiciones a continuación antes de aceptar.',
    ru: 'Для выполнения ваших операционных задач в Jet приложение JET OS собирает и обрабатывает данные о вашем географическом местоположении (GPS). Внимательно прочитайте условия ниже перед тем, как принять их.',
  } as LocStr,
  s1_t: {
    pt: '1. Quando a localização é coletada',
    en: '1. When location is collected',
    es: '1. Cuándo se recopila la ubicación',
    ru: '1. Когда собирается местоположение',
  } as LocStr,
  s1_p: {
    pt: 'O rastreamento ocorre estritamente durante a execução de turnos, slots e tarefas — ou seja, a partir do check-in/início da atividade e até o encerramento. Fora desses períodos a coleta não acontece.',
    en: 'Tracking occurs strictly during the performance of shifts, slots and tasks — that is, from check-in/start of the activity until it ends. Outside these periods no collection takes place.',
    es: 'El rastreo ocurre estrictamente durante la ejecución de turnos, slots y tareas — es decir, desde el check-in/inicio de la actividad hasta su finalización. Fuera de esos períodos no se realiza ninguna recopilación.',
    ru: 'Отслеживание происходит исключительно во время выполнения смен, слотов и задач — то есть с момента отметки/начала активности и до её завершения. Вне этих периодов сбор данных не производится.',
  } as LocStr,
  s2_t: {
    pt: '2. Quais dados são coletados',
    en: '2. What data is collected',
    es: '2. Qué datos se recopilan',
    ru: '2. Какие данные собираются',
  } as LocStr,
  s2_p: {
    pt: 'Coordenadas (latitude/longitude), precisão, velocidade, direção, altitude, nível de bateria do dispositivo e data/hora de cada registro. Também é verificada a autenticidade do sinal (detecção de GPS falso/simulado).',
    en: 'Coordinates (latitude/longitude), accuracy, speed, heading, altitude, device battery level and the date/time of each record. The authenticity of the signal is also verified (detection of fake/mock GPS).',
    es: 'Coordenadas (latitud/longitud), precisión, velocidad, dirección, altitud, nivel de batería del dispositivo y fecha/hora de cada registro. También se verifica la autenticidad de la señal (detección de GPS falso/simulado).',
    ru: 'Координаты (широта/долгота), точность, скорость, направление, высота, уровень заряда батареи устройства и дата/время каждой записи. Также проверяется подлинность сигнала (обнаружение поддельного/имитированного GPS).',
  } as LocStr,
  s3_t: {
    pt: '3. Finalidade',
    en: '3. Purpose',
    es: '3. Finalidad',
    ru: '3. Цель',
  } as LocStr,
  s3_p: {
    pt: 'Os dados são usados exclusivamente para: gestão e comprovação da execução das atividades, segurança do operador e dos ativos, otimização logística e atribuição de tarefas por proximidade. Não são utilizados para qualquer outra finalidade, nem para monitoramento fora do horário de trabalho, nem comercializados ou compartilhados com terceiros sem base legal.',
    en: 'The data is used exclusively for: managing and proving the performance of activities, safety of the operator and of assets, logistics optimization and assignment of tasks by proximity. It is not used for any other purpose, nor for monitoring outside working hours, nor sold or shared with third parties without a legal basis.',
    es: 'Los datos se utilizan exclusivamente para: gestión y comprobación de la ejecución de las actividades, seguridad del operador y de los activos, optimización logística y asignación de tareas por proximidad. No se utilizan para ninguna otra finalidad, ni para monitoreo fuera del horario de trabajo, ni se comercializan ni se comparten con terceros sin base legal.',
    ru: 'Данные используются исключительно для: управления и подтверждения выполнения работ, безопасности оператора и активов, оптимизации логистики и назначения задач по близости. Они не используются для каких-либо иных целей, ни для слежения вне рабочего времени, ни продаются и не передаются третьим лицам без правового основания.',
  } as LocStr,
  s4_t: {
    pt: '4. Armazenamento e retenção',
    en: '4. Storage and retention',
    es: '4. Almacenamiento y retención',
    ru: '4. Хранение и срок хранения',
  } as LocStr,
  s4_p: {
    pt: 'Os registros são armazenados de forma segura apenas pelo período necessário ao cumprimento das finalidades acima e de obrigações legais. Não há armazenamento para fins diversos dos aqui descritos.',
    en: 'Records are stored securely only for the period necessary to fulfill the purposes above and legal obligations. There is no storage for purposes other than those described herein.',
    es: 'Los registros se almacenan de forma segura solo por el período necesario para cumplir las finalidades anteriores y las obligaciones legales. No hay almacenamiento para fines distintos a los descritos aquí.',
    ru: 'Записи хранятся безопасно только в течение периода, необходимого для выполнения указанных выше целей и юридических обязательств. Хранение для целей, отличных от описанных здесь, не осуществляется.',
  } as LocStr,
  s5_t: {
    pt: '5. Base legal',
    en: '5. Legal basis',
    es: '5. Base legal',
    ru: '5. Правовое основание',
  } as LocStr,
  s5_p: {
    pt: 'O tratamento se fundamenta no seu consentimento (art. 7º, I) e na execução do contrato/atividade da qual você é parte (art. 7º, V) da LGPD.',
    en: 'The processing is based on your consent (art. 7, I) and on the performance of the contract/activity to which you are a party (art. 7, V) of the LGPD.',
    es: 'El tratamiento se fundamenta en tu consentimiento (art. 7º, I) y en la ejecución del contrato/actividad del cual eres parte (art. 7º, V) de la LGPD.',
    ru: 'Обработка основана на вашем согласии (ст. 7, п. I) и на исполнении договора/деятельности, стороной которой вы являетесь (ст. 7, п. V) LGPD.',
  } as LocStr,
  s6_t: {
    pt: '6. Seus direitos',
    en: '6. Your rights',
    es: '6. Tus derechos',
    ru: '6. Ваши права',
  } as LocStr,
  s6_p: {
    pt: 'Você pode, a qualquer momento, solicitar acesso, correção ou exclusão dos seus dados, bem como revogar este consentimento. A revogação encerra o rastreamento e pode impossibilitar a execução de atividades que dependem da localização. Para exercer seus direitos, contate a gestão da Jet.',
    en: 'You may, at any time, request access to, correction or deletion of your data, as well as revoke this consent. Revocation ends tracking and may make it impossible to perform activities that depend on location. To exercise your rights, contact Jet management.',
    es: 'Puedes, en cualquier momento, solicitar acceso, corrección o eliminación de tus datos, así como revocar este consentimiento. La revocación finaliza el rastreo y puede imposibilitar la ejecución de actividades que dependen de la ubicación. Para ejercer tus derechos, contacta a la gestión de Jet.',
    ru: 'Вы можете в любое время запросить доступ к своим данным, их исправление или удаление, а также отозвать настоящее согласие. Отзыв прекращает отслеживание и может сделать невозможным выполнение задач, зависящих от местоположения. Для реализации своих прав свяжитесь с руководством Jet.',
  } as LocStr,
  versaoNota: {
    pt: `Versão do termo: ${LGPD_VERSAO}. O seu aceite será registrado com data, hora e identificação para fins de comprovação.`,
    en: `Term version: ${LGPD_VERSAO}. Your acceptance will be recorded with date, time and identification for proof purposes.`,
    es: `Versión del término: ${LGPD_VERSAO}. Tu aceptación se registrará con fecha, hora e identificación para fines de comprobación.`,
    ru: `Версия условий: ${LGPD_VERSAO}. Ваше согласие будет зафиксировано с датой, временем и идентификацией в целях подтверждения.`,
  } as LocStr,
  checkbox: {
    pt: 'Li e concordo com a coleta e o tratamento da minha localização nas condições acima, durante turnos, slots e tarefas.',
    en: 'I have read and agree to the collection and processing of my location under the conditions above, during shifts, slots and tasks.',
    es: 'He leído y acepto la recopilación y el tratamiento de mi ubicación en las condiciones anteriores, durante turnos, slots y tareas.',
    ru: 'Я прочитал(а) и согласен(на) на сбор и обработку моего местоположения на указанных выше условиях во время смен, слотов и задач.',
  } as LocStr,
  btnAceitar: {
    pt: 'Aceitar e continuar',
    en: 'Accept and continue',
    es: 'Aceptar y continuar',
    ru: 'Принять и продолжить',
  } as LocStr,
  btnRegistrando: {
    pt: 'Registrando…',
    en: 'Recording…',
    es: 'Registrando…',
    ru: 'Сохранение…',
  } as LocStr,
  btnRecusar: {
    pt: 'Não aceito — sair do app',
    en: 'I do not accept — exit the app',
    es: 'No acepto — salir de la app',
    ru: 'Не принимаю — выйти из приложения',
  } as LocStr,
  erroRegistro: {
    pt: 'Não foi possível registrar o aceite. Verifique a conexão e tente novamente.',
    en: 'Could not record your acceptance. Check your connection and try again.',
    es: 'No fue posible registrar la aceptación. Verifica la conexión e inténtalo de nuevo.',
    ru: 'Не удалось сохранить согласие. Проверьте подключение и попробуйте снова.',
  } as LocStr,
};

// Perfis cuja localização é processada (slots, tarefas, turnos, ocorrências).
// Mantém alinhado com FIELD_ROLES do AndroidPermissionGate + guard (captura pontual).
export const ROLES_RASTREADOS = [
  'logistica', 'campo', 'charger', 'scalt', 'promotor', 'guard',
];

// Decide se o usuário precisa do consentimento de localização.
// ⚠️ Prestadores têm role='prestador'/'prestador_pendente' e a função real
// (charger/scalt/scout) em cargoPrestador — mas SÃO rastreados em background ao
// fazer check-in de slot (SlotsModule.checkIn → gpsBackground.iniciar). Por isso
// não basta olhar o role: todo prestador (aprovado, que chega às telas do app)
// também precisa consentir. Pendentes nem chegam aqui (vão p/ tela de espera).
export function precisaConsentirLocalizacao(u: { role: string; tipoCadastro?: string }): boolean {
  return ROLES_RASTREADOS.includes(u.role) || u.tipoCadastro === 'prestador';
}

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
    const { data } = await supabase
      .from('aceites_termos')
      .select('id')
      .eq('id', `${uid}_lgpd_v${LGPD_VERSAO}`)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

// localStorage override: localStorage.setItem('jet_lgpd_provider', 'supabase')
// Build-time env: VITE_LGPD_PROVIDER=supabase
const lgpdProviderSupabase = (): boolean => {
  try {
    const v = localStorage.getItem('jet_lgpd_provider');
    if (v === 'supabase') return true;
    if (v === 'firebase') return false;
  } catch { /* sem localStorage */ }
  return (import.meta.env.VITE_LGPD_PROVIDER as string) !== 'firebase';
};

async function registrarAceite(p: Props): Promise<void> {
  const { error } = await supabase.from('aceites_termos').upsert({
    id:                  `${p.uid}_lgpd_v${LGPD_VERSAO}`,
    uid:                 p.uid,
    email:               p.email || '',
    nome:                p.nome || '',
    role:                p.role || '',
    versao:              LGPD_VERSAO,
    aceitou_termos:      true,
    aceitou_privacidade: true,
    user_agent:          navigator.userAgent.slice(0, 300),
    plataforma:          navigator.platform,
    idioma:              navigator.language,
  });
  if (error) throw error;

  // Dual-write: gravar tambem na tabela consentimentos_lgpd (behind flag)
  if (lgpdProviderSupabase()) {
    try {
      const versaoInt = parseInt(LGPD_VERSAO, 10) || 1;
      await supabase.from('consentimentos_lgpd').upsert(
        {
          uid:         p.uid,
          email:       p.email || null,
          nome:        p.nome || null,
          role:        p.role || null,
          versao:      versaoInt,
          aceito_em:   new Date().toISOString(),
          dispositivo: navigator.userAgent.slice(0, 300),
          idioma:      navigator.language,
        },
        { onConflict: 'uid,versao' },
      );
    } catch (e) {
      // Nao bloqueia o fluxo — aceites_termos e o registro principal
      console.warn('[LGPD] dual-write consentimentos_lgpd falhou:', e);
    }
  }
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
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: LocStr) => o[lang] ?? o.pt;
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
      setErro(pick(T.erroRegistro));
      setSalvando(false);
    }
  }, [marcado, salvando, props, onAceito, lang]);

  if (estado === 'checando') return null;

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>🛡️</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#dce8ff' }}>
            {pick(T.titulo)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
            {pick(T.subtitulo)}
          </div>
        </div>

        <div style={S.termo}>
          <p>{pick(T.intro)}</p>

          <div style={S.h}>{pick(T.s1_t)}</div>
          <p>{pick(T.s1_p)}</p>

          <div style={S.h}>{pick(T.s2_t)}</div>
          <p>{pick(T.s2_p)}</p>

          <div style={S.h}>{pick(T.s3_t)}</div>
          <p>{pick(T.s3_p)}</p>

          <div style={S.h}>{pick(T.s4_t)}</div>
          <p>{pick(T.s4_p)}</p>

          <div style={S.h}>{pick(T.s5_t)}</div>
          <p>{pick(T.s5_p)}</p>

          <div style={S.h}>{pick(T.s6_t)}</div>
          <p>{pick(T.s6_p)}</p>

          <p style={{ marginTop: 14, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
            {pick(T.versaoNota)}
          </p>
        </div>

        <label style={S.checkboxRow}>
          <input
            type="checkbox"
            checked={marcado}
            onChange={e => setMarcado(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: '#10b981' }}
          />
          <span>{pick(T.checkbox)}</span>
        </label>

        {erro && (
          <div style={{ fontSize: 11.5, color: '#f87171', textAlign: 'center' }}>{erro}</div>
        )}

        <button
          onClick={handleAceitar}
          disabled={!marcado || salvando}
          style={S.aceitar(marcado && !salvando)}
        >
          {salvando ? pick(T.btnRegistrando) : pick(T.btnAceitar)}
        </button>

        <div style={{ textAlign: 'center' }}>
          <button onClick={onRecusado} style={S.recusar}>
            {pick(T.btnRecusar)}
          </button>
        </div>
      </div>
    </div>
  );
}
