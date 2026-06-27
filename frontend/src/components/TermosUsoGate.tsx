// frontend/src/components/TermosUsoGate.tsx
// Aceite dos TERMOS DE USO + POLÍTICA DE PRIVACIDADE do app (segurança jurídica).
//
// Diferente do LgpdConsentGate (que é o consentimento ESPECÍFICO de localização/GPS,
// só para perfis rastreados), este gate é GERAL e exibido para TODOS os usuários no
// primeiro acesso (web e APK), antes de qualquer tela do app.
//
// O aceite é gravado de forma IMUTÁVEL no Firestore (coleção aceites_termos), com
// data/hora, versão, identidade e dispositivo — constituindo prova do aceite informado.
//
// Para reapresentar após uma revisão jurídica, basta incrementar TERMOS_VERSAO:
// o id do registro inclui a versão, então um novo aceite será exigido.
//
// ⚠️ TEXTO-BASE: redigido para revisão do jurídico da Jet. Ajuste razão social, CNPJ,
// canal do encarregado (DPO) e prazos antes de produção; depois incremente a versão.
//
// i18n: padrão do OnboardingWizard — texto definido em objetos { pt, en, es, ru }
// e selecionado pelo idioma atual (sem chaves json). A referência legal LGPD
// (Lei nº 13.709/2018) é mantida em todos os idiomas (base legal BR).

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

// Versão dos termos. Incrementar quando o texto mudar → força novo aceite.
export const TERMOS_VERSAO = '1.0';

type Lang = 'pt' | 'en' | 'es' | 'ru';
type L = { pt: string; en: string; es: string; ru: string };

interface Props {
  uid: string;
  email: string;
  nome: string;
  role: string;
  tipoCadastro?: string;
  onAceito: () => void;   // aceitou → segue para os próximos gates / app
  onRecusado: () => void; // recusou → logout (não pode usar sem aceitar)
}

async function jaAceitou(uid: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('aceites_termos')
      .select('id')
      .eq('id', `${uid}_v${TERMOS_VERSAO}`)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

async function registrarAceite(p: Props): Promise<void> {
  const { error } = await supabase.from('aceites_termos').upsert({
    id:                  `${p.uid}_v${TERMOS_VERSAO}`,
    uid:                 p.uid,
    email:               p.email || '',
    nome:                p.nome || '',
    role:                p.role || '',
    tipo_cadastro:       p.tipoCadastro || '',
    versao:              TERMOS_VERSAO,
    aceitou_termos:      true,
    aceitou_privacidade: true,
    user_agent:          navigator.userAgent.slice(0, 300),
    plataforma:          navigator.platform,
    idioma:              navigator.language,
  });
  if (error) throw error;
}

// ─────────────────────────── Textos (pt / en / es / ru) ───────────────────────────
const T = {
  titulo: {
    pt: 'Termos de Uso e Privacidade',
    en: 'Terms of Use and Privacy',
    es: 'Términos de Uso y Privacidad',
    ru: 'Условия использования и конфиденциальность',
  },
  subtitulo: {
    pt: 'Leia antes de continuar',
    en: 'Read before continuing',
    es: 'Lea antes de continuar',
    ru: 'Прочитайте перед продолжением',
  },

  secaoTermos: {
    pt: 'TERMOS DE USO',
    en: 'TERMS OF USE',
    es: 'TÉRMINOS DE USO',
    ru: 'УСЛОВИЯ ИСПОЛЬЗОВАНИЯ',
  },
  secaoPrivacidade: {
    pt: 'POLÍTICA DE PRIVACIDADE',
    en: 'PRIVACY POLICY',
    es: 'POLÍTICA DE PRIVACIDAD',
    ru: 'ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ',
  },

  checkbox: {
    pt: 'Concordo com os Termos de Uso e a Política de Privacidade do JET OS.',
    en: 'I agree to the JET OS Terms of Use and Privacy Policy.',
    es: 'Acepto los Términos de Uso y la Política de Privacidad de JET OS.',
    ru: 'Я соглашаюсь с Условиями использования и Политикой конфиденциальности JET OS.',
  },
  checkboxLi: {
    pt: 'Li e ',
    en: 'I have read and ',
    es: 'He leído y ',
    ru: 'Я прочитал(а) и ',
  },
  checkboxConcordo: {
    pt: 'concordo',
    en: 'agree',
    es: 'acepto',
    ru: 'соглашаюсь',
  },
  checkboxResto: {
    pt: ' com os Termos de Uso e a Política de Privacidade do JET OS.',
    en: ' to the JET OS Terms of Use and Privacy Policy.',
    es: ' los Términos de Uso y la Política de Privacidad de JET OS.',
    ru: ' с Условиями использования и Политикой конфиденциальности JET OS.',
  },

  btnAceitar: {
    pt: 'Aceitar e continuar',
    en: 'Accept and continue',
    es: 'Aceptar y continuar',
    ru: 'Принять и продолжить',
  },
  btnRegistrando: {
    pt: 'Registrando…',
    en: 'Saving…',
    es: 'Registrando…',
    ru: 'Сохранение…',
  },
  btnRecusar: {
    pt: 'Não aceito — sair do app',
    en: 'I do not accept — exit the app',
    es: 'No acepto — salir de la app',
    ru: 'Не принимаю — выйти из приложения',
  },
  erro: {
    pt: 'Não foi possível registrar o aceite. Verifique a conexão e tente novamente.',
    en: 'Unable to register your acceptance. Check your connection and try again.',
    es: 'No fue posible registrar la aceptación. Verifique la conexión e inténtelo de nuevo.',
    ru: 'Не удалось зарегистрировать согласие. Проверьте подключение и повторите попытку.',
  },
  versao: {
    pt: 'O seu aceite será registrado com data, hora e identificação para fins de comprovação.',
    en: 'Your acceptance will be recorded with date, time and identification for proof purposes.',
    es: 'Su aceptación se registrará con fecha, hora e identificación para fines de comprobación.',
    ru: 'Ваше согласие будет зафиксировано с указанием даты, времени и идентификации в качестве доказательства.',
  },
};

// Cada bloco de termo: cabeçalho (h) opcional + parágrafo (p), com <strong> via dangerouslySetInnerHTML.
type Bloco = { h?: L; p: L };

const BOASVINDAS: L = {
  pt: 'Bem-vindo(a) ao <strong>JET OS</strong>. Para usar o aplicativo, você precisa ler e concordar com os <strong>Termos de Uso</strong> e com a <strong>Política de Privacidade</strong> abaixo.',
  en: 'Welcome to <strong>JET OS</strong>. To use the application, you must read and agree to the <strong>Terms of Use</strong> and the <strong>Privacy Policy</strong> below.',
  es: 'Bienvenido(a) a <strong>JET OS</strong>. Para usar la aplicación, debe leer y aceptar los <strong>Términos de Uso</strong> y la <strong>Política de Privacidad</strong> a continuación.',
  ru: 'Добро пожаловать в <strong>JET OS</strong>. Чтобы пользоваться приложением, вы должны прочитать и принять <strong>Условия использования</strong> и <strong>Политику конфиденциальности</strong> ниже.',
};

const TERMOS: Bloco[] = [
  {
    h: { pt: '1. Objeto', en: '1. Purpose', es: '1. Objeto', ru: '1. Предмет' },
    p: {
      pt: 'O JET OS é um aplicativo corporativo da Jet destinado à gestão operacional (slots, tarefas, turnos, ocorrências, pagamentos e logística). O acesso é pessoal e vinculado à sua atuação junto à Jet.',
      en: 'JET OS is a corporate application by Jet intended for operational management (slots, tasks, shifts, incidents, payments and logistics). Access is personal and tied to your activity with Jet.',
      es: 'JET OS es una aplicación corporativa de Jet destinada a la gestión operativa (slots, tareas, turnos, incidencias, pagos y logística). El acceso es personal y está vinculado a su actuación con Jet.',
      ru: 'JET OS — это корпоративное приложение Jet, предназначенное для оперативного управления (слоты, задачи, смены, инциденты, платежи и логистика). Доступ является персональным и связан с вашей деятельностью в Jet.',
    },
  },
  {
    h: {
      pt: '2. Conta e responsabilidade',
      en: '2. Account and responsibility',
      es: '2. Cuenta y responsabilidad',
      ru: '2. Учётная запись и ответственность',
    },
    p: {
      pt: 'Suas credenciais são <strong>pessoais e intransferíveis</strong>. Você é responsável pela veracidade dos dados informados e pelas ações realizadas na sua conta. Comunique imediatamente qualquer uso não autorizado.',
      en: 'Your credentials are <strong>personal and non-transferable</strong>. You are responsible for the accuracy of the information provided and for the actions taken on your account. Report any unauthorized use immediately.',
      es: 'Sus credenciales son <strong>personales e intransferibles</strong>. Usted es responsable de la veracidad de los datos informados y de las acciones realizadas en su cuenta. Comunique de inmediato cualquier uso no autorizado.',
      ru: 'Ваши учётные данные являются <strong>личными и не подлежат передаче</strong>. Вы несёте ответственность за достоверность предоставленных данных и за действия, совершённые с вашей учётной записи. Немедленно сообщайте о любом несанкционированном использовании.',
    },
  },
  {
    h: { pt: '3. Uso adequado', en: '3. Proper use', es: '3. Uso adecuado', ru: '3. Надлежащее использование' },
    p: {
      pt: 'Você concorda em usar o app apenas para fins operacionais legítimos, sem inserir dados falsos, sem burlar registros (inclusive de localização) e sem comprometer a segurança ou a disponibilidade do sistema.',
      en: 'You agree to use the app only for legitimate operational purposes, without entering false data, without circumventing records (including location records) and without compromising the security or availability of the system.',
      es: 'Usted acepta usar la app solo para fines operativos legítimos, sin introducir datos falsos, sin eludir los registros (incluidos los de ubicación) y sin comprometer la seguridad o la disponibilidad del sistema.',
      ru: 'Вы соглашаетесь использовать приложение только в законных операционных целях, не вводить ложные данные, не обходить записи (в том числе данные о местоположении) и не нарушать безопасность или доступность системы.',
    },
  },
  {
    h: { pt: '4. Disponibilidade', en: '4. Availability', es: '4. Disponibilidad', ru: '4. Доступность' },
    p: {
      pt: 'O serviço pode passar por manutenções e atualizações. A Jet busca a maior disponibilidade possível, mas não garante operação ininterrupta.',
      en: 'The service may undergo maintenance and updates. Jet strives for the highest possible availability but does not guarantee uninterrupted operation.',
      es: 'El servicio puede pasar por mantenimientos y actualizaciones. Jet procura la mayor disponibilidad posible, pero no garantiza un funcionamiento ininterrumpido.',
      ru: 'Сервис может проходить техническое обслуживание и обновления. Jet стремится обеспечить максимально возможную доступность, но не гарантирует бесперебойную работу.',
    },
  },
  {
    h: { pt: '5. Encerramento', en: '5. Termination', es: '5. Terminación', ru: '5. Прекращение' },
    p: {
      pt: 'O acesso pode ser suspenso ou encerrado em caso de descumprimento destes termos ou de término da relação com a Jet.',
      en: 'Access may be suspended or terminated in the event of a breach of these terms or the end of the relationship with Jet.',
      es: 'El acceso puede ser suspendido o terminado en caso de incumplimiento de estos términos o de finalización de la relación con Jet.',
      ru: 'Доступ может быть приостановлен или прекращён в случае нарушения настоящих условий или прекращения отношений с Jet.',
    },
  },
];

const PRIVACIDADE: Bloco[] = [
  {
    h: {
      pt: '1. Quais dados tratamos',
      en: '1. What data we process',
      es: '1. Qué datos tratamos',
      ru: '1. Какие данные мы обрабатываем',
    },
    p: {
      pt: '<strong>Cadastro:</strong> nome, e-mail, telefone, CPF e função. <strong>Operacionais:</strong> registros de slots/tarefas/turnos, fotos enviadas (ex.: ocorrências e entregas), e <strong>localização (GPS)</strong> durante a execução de atividades. <strong>Técnicos:</strong> dispositivo, sistema, idioma e registros de acesso.',
      en: '<strong>Registration:</strong> name, e-mail, phone, tax ID and role. <strong>Operational:</strong> slot/task/shift records, uploaded photos (e.g. incidents and deliveries), and <strong>location (GPS)</strong> during the execution of activities. <strong>Technical:</strong> device, system, language and access logs.',
      es: '<strong>Registro:</strong> nombre, correo electrónico, teléfono, documento de identidad y función. <strong>Operativos:</strong> registros de slots/tareas/turnos, fotos enviadas (p. ej., incidencias y entregas), y <strong>ubicación (GPS)</strong> durante la ejecución de actividades. <strong>Técnicos:</strong> dispositivo, sistema, idioma y registros de acceso.',
      ru: '<strong>Регистрация:</strong> имя, эл. почта, телефон, идентификационный номер и должность. <strong>Операционные:</strong> записи о слотах/задачах/сменах, загруженные фотографии (например, инциденты и доставки) и <strong>местоположение (GPS)</strong> во время выполнения работ. <strong>Технические:</strong> устройство, система, язык и журналы доступа.',
    },
  },
  {
    h: { pt: '2. Para que usamos', en: '2. What we use it for', es: '2. Para qué los usamos', ru: '2. Для чего мы их используем' },
    p: {
      pt: 'Para operar o app e comprovar a execução das atividades, gerir pagamentos, zelar pela segurança de pessoas e ativos, otimizar a logística e cumprir obrigações legais. <strong>Não vendemos seus dados.</strong>',
      en: 'To operate the app and prove the execution of activities, manage payments, ensure the safety of people and assets, optimize logistics and comply with legal obligations. <strong>We do not sell your data.</strong>',
      es: 'Para operar la app y comprobar la ejecución de las actividades, gestionar pagos, velar por la seguridad de las personas y los activos, optimizar la logística y cumplir obligaciones legales. <strong>No vendemos sus datos.</strong>',
      ru: 'Для работы приложения и подтверждения выполнения работ, управления платежами, обеспечения безопасности людей и активов, оптимизации логистики и выполнения юридических обязательств. <strong>Мы не продаём ваши данные.</strong>',
    },
  },
  {
    h: { pt: '3. Localização', en: '3. Location', es: '3. Ubicación', ru: '3. Местоположение' },
    p: {
      pt: 'O rastreamento por GPS ocorre <strong>somente durante turnos, slots e tarefas</strong> e é objeto de um <strong>consentimento específico</strong> apresentado à parte para os perfis rastreados, nos termos da LGPD (Lei nº 13.709/2018).',
      en: 'GPS tracking occurs <strong>only during shifts, slots and tasks</strong> and is subject to a <strong>specific consent</strong> presented separately for tracked profiles, under the LGPD (Brazilian Law No. 13,709/2018).',
      es: 'El rastreo por GPS ocurre <strong>solo durante turnos, slots y tareas</strong> y es objeto de un <strong>consentimiento específico</strong> presentado aparte para los perfiles rastreados, conforme a la LGPD (Ley n.º 13.709/2018).',
      ru: 'Отслеживание по GPS происходит <strong>только во время смен, слотов и задач</strong> и является предметом <strong>отдельного согласия</strong>, предоставляемого отдельно для отслеживаемых профилей, в соответствии с LGPD (Закон Бразилии № 13.709/2018).',
    },
  },
  {
    h: { pt: '4. Compartilhamento', en: '4. Sharing', es: '4. Compartición', ru: '4. Передача данных' },
    p: {
      pt: 'Dados podem ser tratados por prestadores de tecnologia (ex.: provedores de nuvem) estritamente para viabilizar o serviço, sob obrigações de segurança e confidencialidade, e compartilhados quando houver base legal ou exigência legal/regulatória.',
      en: 'Data may be processed by technology providers (e.g. cloud providers) strictly to enable the service, under security and confidentiality obligations, and shared when there is a legal basis or a legal/regulatory requirement.',
      es: 'Los datos pueden ser tratados por proveedores de tecnología (p. ej., proveedores de nube) estrictamente para viabilizar el servicio, bajo obligaciones de seguridad y confidencialidad, y compartidos cuando exista una base legal o una exigencia legal/regulatoria.',
      ru: 'Данные могут обрабатываться технологическими поставщиками (например, облачными провайдерами) исключительно для обеспечения работы сервиса, при соблюдении обязательств по безопасности и конфиденциальности, и передаваться при наличии правового основания или юридического/нормативного требования.',
    },
  },
  {
    h: {
      pt: '5. Retenção e segurança',
      en: '5. Retention and security',
      es: '5. Retención y seguridad',
      ru: '5. Хранение и безопасность',
    },
    p: {
      pt: 'Os dados são guardados apenas pelo tempo necessário às finalidades acima e ao cumprimento de obrigações legais, com medidas de segurança adequadas.',
      en: 'Data is kept only for as long as necessary for the purposes above and to comply with legal obligations, with appropriate security measures.',
      es: 'Los datos se conservan solo durante el tiempo necesario para las finalidades anteriores y para el cumplimiento de obligaciones legales, con medidas de seguridad adecuadas.',
      ru: 'Данные хранятся только в течение времени, необходимого для указанных выше целей и выполнения юридических обязательств, с применением надлежащих мер безопасности.',
    },
  },
  {
    h: { pt: '6. Seus direitos', en: '6. Your rights', es: '6. Sus derechos', ru: '6. Ваши права' },
    p: {
      pt: 'Você pode solicitar acesso, correção, exclusão, portabilidade e informações sobre o tratamento, além de revogar consentimentos. Para exercer seus direitos ou falar com o encarregado (DPO), contate a gestão da Jet.',
      en: 'You may request access, correction, deletion, portability and information about the processing, as well as revoke consents. To exercise your rights or contact the data protection officer (DPO), reach out to Jet management.',
      es: 'Usted puede solicitar acceso, corrección, eliminación, portabilidad e información sobre el tratamiento, además de revocar consentimientos. Para ejercer sus derechos o hablar con el encargado (DPO), contacte a la gestión de Jet.',
      ru: 'Вы можете запросить доступ, исправление, удаление, переносимость и информацию об обработке, а также отозвать согласия. Чтобы реализовать свои права или связаться с ответственным за защиту данных (DPO), обратитесь к руководству Jet.',
    },
  },
];

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
  secao: { color: '#9fd0ff', fontWeight: 800, fontSize: 12.5, margin: '16px 0 6px', letterSpacing: .3 } as React.CSSProperties,
  h: { color: '#dce8ff', fontWeight: 700, fontSize: 12.5, margin: '12px 0 4px' } as React.CSSProperties,
  checkboxRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    fontSize: 12.5, color: '#dce8ff', lineHeight: 1.45, cursor: 'pointer',
  } as React.CSSProperties,
  aceitar: (active: boolean) => ({
    width: '100%', padding: 14, borderRadius: 10, border: 'none',
    cursor: active ? 'pointer' : 'default', fontWeight: 700, fontSize: 14,
    background: active ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : 'rgba(255,255,255,.08)',
    color: active ? '#fff' : 'rgba(255,255,255,.3)',
  } as React.CSSProperties),
  recusar: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,.3)',
    fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
  } as React.CSSProperties,
};

export default function TermosUsoGate(props: Props) {
  const { uid, onAceito, onRecusado } = props;
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as Lang);
  const pick = (o: L) => o[lang] ?? o.pt;

  const [estado, setEstado] = useState<'checando' | 'termo'>('checando');
  const [marcado, setMarcado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    jaAceitou(uid).then(ok => {
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
      console.error('[Termos] erro ao registrar aceite:', e);
      setErro(pick(T.erro));
      setSalvando(false);
    }
  }, [marcado, salvando, props, onAceito, lang]);

  if (estado === 'checando') return null;

  const renderBlocos = (blocos: Bloco[]) =>
    blocos.map((b, i) => (
      <div key={i}>
        {b.h && <div style={S.h}>{pick(b.h)}</div>}
        <p dangerouslySetInnerHTML={{ __html: pick(b.p) }} />
      </div>
    ));

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>📄</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#dce8ff' }}>
            {pick(T.titulo)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
            {pick(T.subtitulo)}
          </div>
        </div>

        <div style={S.termo}>
          <p dangerouslySetInnerHTML={{ __html: pick(BOASVINDAS) }} />

          {/* ───────────────── TERMOS DE USO ───────────────── */}
          <div style={S.secao}>{pick(T.secaoTermos)}</div>
          {renderBlocos(TERMOS)}

          {/* ──────────────── POLÍTICA DE PRIVACIDADE ──────────────── */}
          <div style={S.secao}>{pick(T.secaoPrivacidade)}</div>
          {renderBlocos(PRIVACIDADE)}

          <p style={{ marginTop: 14, fontSize: 11, color: 'rgba(255,255,255,.4)' }}>
            {pick({
              pt: `Versão: ${TERMOS_VERSAO}. `,
              en: `Version: ${TERMOS_VERSAO}. `,
              es: `Versión: ${TERMOS_VERSAO}. `,
              ru: `Версия: ${TERMOS_VERSAO}. `,
            })}
            {pick(T.versao)}
          </p>
        </div>

        <label style={S.checkboxRow}>
          <input
            type="checkbox"
            checked={marcado}
            onChange={e => setMarcado(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: '#3b82f6' }}
          />
          <span>
            {pick(T.checkboxLi)}
            <strong>{pick(T.checkboxConcordo)}</strong>
            {pick(T.checkboxResto)}
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
