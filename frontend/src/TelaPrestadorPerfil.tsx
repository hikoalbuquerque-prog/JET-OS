import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from './lib/supabase';
import { escreverUsuarioSupabase, fetchUsuario } from './lib/usuarios-supabase';
import TelegramVinculo from './TelegramVinculo';

interface Usuario {
  uid: string;
  email: string;
  nome: string;
  role: string;
  cargoPrestador?: string;
  tipoCadastro?: string;
  statusPrestador?: string;
  cidade?: string;
}

interface Props {
  usuario: Usuario;
  onFechar: () => void;
  onLogout: () => void;
}

// Valores de PIX gravados no Firestore (pix_tipo) — NÃO traduzir o valor.
// O rótulo exibido é traduzido via T.tiposPix mantendo o value original.
const TIPOS_PIX = ['CPF', 'CNPJ', 'E-mail', 'Telefone', 'Chave aleatória'];

const NIVEIS_GOVBR = ['desconhecido', 'bronze', 'prata', 'ouro'];

// i18n: padrão do TermosUsoGate — objeto T { pt, en, es, ru }, sem json.
// Só TEXTO é traduzido; lógica/queries/campos/enums/estilos/gravação inalterados.
// PT é a fonte fiel ao original.
const T = {
  // Status do prestador
  statusAtivo:     { pt: 'Ativo', en: 'Active', es: 'Activo', ru: 'Активен' },
  statusAguardando:{ pt: 'Aguardando aprovação', en: 'Awaiting approval', es: 'Esperando aprobación', ru: 'Ожидает одобрения' },
  statusInativo:   { pt: 'Inativo', en: 'Inactive', es: 'Inactivo', ru: 'Неактивен' },
  statusTraco:     { pt: '—', en: '—', es: '—', ru: '—' },

  // Cargo
  cargoLogistica: { pt: 'Agente de Logística', en: 'Logistics Agent', es: 'Agente de Logística', ru: 'Логистический агент' },
  cargoPromotor:  { pt: 'Promotor', en: 'Promoter', es: 'Promotor', ru: 'Промоутер' },
  cargoFiscal:    { pt: 'Fiscal', en: 'Inspector', es: 'Fiscal', ru: 'Инспектор' },
  cargoSeguranca: { pt: 'Segurança', en: 'Security', es: 'Seguridad', ru: 'Охрана' },
  cargoPrestador: { pt: 'Prestador', en: 'Provider', es: 'Proveedor', ru: 'Исполнитель' },

  // Procuração
  procPendente: { pt: 'Pendente', en: 'Pending', es: 'Pendiente', ru: 'Ожидает' },
  procAtiva:    { pt: 'Ativa', en: 'Active', es: 'Activa', ru: 'Активна' },
  procRevogada: { pt: 'Revogada', en: 'Revoked', es: 'Revocada', ru: 'Отозвана' },

  // Nível gov.br
  govDesconhecido: { pt: 'Não sei / não informado', en: "Don't know / not provided", es: 'No sé / no informado', ru: 'Не знаю / не указано' },
  govBronze: { pt: 'Bronze', en: 'Bronze', es: 'Bronce', ru: 'Бронза' },
  govPrata:  { pt: 'Prata', en: 'Silver', es: 'Plata', ru: 'Серебро' },
  govOuro:   { pt: 'Ouro', en: 'Gold', es: 'Oro', ru: 'Золото' },

  // Tipos PIX (rótulos)
  pixCPF:        { pt: 'CPF', en: 'CPF', es: 'CPF', ru: 'CPF' },
  pixCNPJ:       { pt: 'CNPJ', en: 'CNPJ', es: 'CNPJ', ru: 'CNPJ' },
  pixEmail:      { pt: 'E-mail', en: 'Email', es: 'Correo electrónico', ru: 'Эл. почта' },
  pixTelefone:   { pt: 'Telefone', en: 'Phone', es: 'Teléfono', ru: 'Телефон' },
  pixAleatoria:  { pt: 'Chave aleatória', en: 'Random key', es: 'Clave aleatoria', ru: 'Случайный ключ' },

  // Header
  meuPerfil: { pt: 'Meu Perfil', en: 'My Profile', es: 'Mi Perfil', ru: 'Мой профиль' },
  sair:      { pt: 'Sair', en: 'Log out', es: 'Salir', ru: 'Выйти' },

  // Tabs
  tabDados:     { pt: '👤 Dados', en: '👤 Details', es: '👤 Datos', ru: '👤 Данные' },
  tabPagamento: { pt: '💳 Pagamento', en: '💳 Payment', es: '💳 Pago', ru: '💳 Оплата' },
  tabFiscal:    { pt: '🧾 Nota Fiscal', en: '🧾 Invoice', es: '🧾 Factura', ru: '🧾 Счёт-фактура' },
  tabTelegram:  { pt: '📲 Telegram', en: '📲 Telegram', es: '📲 Telegram', ru: '📲 Telegram' },

  // Estados
  carregando: { pt: 'Carregando...', en: 'Loading...', es: 'Cargando...', ru: 'Загрузка...' },
  salvando:   { pt: 'Salvando...', en: 'Saving...', es: 'Guardando...', ru: 'Сохранение...' },
  selecioneCidade: { pt: 'Selecione a cidade...', en: 'Select a city...', es: 'Seleccione la ciudad...', ru: 'Выберите город...' },

  // Aba Dados
  nomeCompleto:     { pt: 'NOME COMPLETO', en: 'FULL NAME', es: 'NOMBRE COMPLETO', ru: 'ПОЛНОЕ ИМЯ' },
  phNomeCompleto:   { pt: 'Seu nome completo', en: 'Your full name', es: 'Su nombre completo', ru: 'Ваше полное имя' },
  email:            { pt: 'E-MAIL', en: 'EMAIL', es: 'CORREO ELECTRÓNICO', ru: 'ЭЛ. ПОЧТА' },
  cargo:            { pt: 'CARGO', en: 'ROLE', es: 'CARGO', ru: 'ДОЛЖНОСТЬ' },
  cidadeAtuacao:    { pt: 'CIDADE DE ATUAÇÃO', en: 'CITY OF OPERATION', es: 'CIUDAD DE ACTUACIÓN', ru: 'ГОРОД РАБОТЫ' },
  tipoContrato:     { pt: 'TIPO DE CONTRATO', en: 'CONTRACT TYPE', es: 'TIPO DE CONTRATO', ru: 'ТИП ДОГОВОРА' },
  cpfCnpj:          { pt: 'CPF / CNPJ', en: 'CPF / CNPJ', es: 'CPF / CNPJ', ru: 'CPF / CNPJ' },
  phCpfCnpj:        { pt: '000.000.000-00 ou 00.000.000/0001-00', en: '000.000.000-00 or 00.000.000/0001-00', es: '000.000.000-00 o 00.000.000/0001-00', ru: '000.000.000-00 или 00.000.000/0001-00' },
  salvarDados:      { pt: 'Salvar dados', en: 'Save details', es: 'Guardar datos', ru: 'Сохранить данные' },

  // Aba Pagamento
  pagamentoInfo: {
    pt: 'Seus dados de pagamento são usados para processar repasses e pagamentos dos serviços prestados.',
    en: 'Your payment details are used to process transfers and payments for the services provided.',
    es: 'Sus datos de pago se utilizan para procesar transferencias y pagos de los servicios prestados.',
    ru: 'Ваши платёжные данные используются для обработки переводов и оплаты оказанных услуг.',
  },
  tipoChavePix: { pt: 'TIPO DA CHAVE PIX', en: 'PIX KEY TYPE', es: 'TIPO DE CLAVE PIX', ru: 'ТИП КЛЮЧА PIX' },
  chavePix:     { pt: 'CHAVE PIX', en: 'PIX KEY', es: 'CLAVE PIX', ru: 'КЛЮЧ PIX' },
  phPixCpf:     { pt: '000.000.000-00', en: '000.000.000-00', es: '000.000.000-00', ru: '000.000.000-00' },
  phPixCnpj:    { pt: '00.000.000/0001-00', en: '00.000.000/0001-00', es: '00.000.000/0001-00', ru: '00.000.000/0001-00' },
  phPixEmail:   { pt: 'seu@email.com', en: 'your@email.com', es: 'su@email.com', ru: 'your@email.com' },
  phPixTelefone:{ pt: '+55 (11) 99999-9999', en: '+55 (11) 99999-9999', es: '+55 (11) 99999-9999', ru: '+55 (11) 99999-9999' },
  phPixAleatoria:{ pt: 'Cole a chave aleatória', en: 'Paste the random key', es: 'Pegue la clave aleatoria', ru: 'Вставьте случайный ключ' },
  cpfCnpjTitular: { pt: 'CPF / CNPJ TITULAR', en: 'ACCOUNT HOLDER CPF / CNPJ', es: 'CPF / CNPJ DEL TITULAR', ru: 'CPF / CNPJ ВЛАДЕЛЬЦА' },
  phCpfCnpjTitular: { pt: 'Documento do titular da conta Pix', en: 'Document of the Pix account holder', es: 'Documento del titular de la cuenta Pix', ru: 'Документ владельца счёта Pix' },
  salvarPagamento: { pt: 'Salvar dados de pagamento', en: 'Save payment details', es: 'Guardar datos de pago', ru: 'Сохранить платёжные данные' },

  // Aba Fiscal
  fiscalInfoP1: { pt: 'Estes dados permitem que a Jet emita a sua ', en: 'These details allow Jet to issue your ', es: 'Estos datos permiten que Jet emita su ', ru: 'Эти данные позволяют Jet выставлять ваш ' },
  fiscalNfse:   { pt: 'Nota Fiscal de Serviço (NFS-e)', en: 'Service Invoice (NFS-e)', es: 'Factura de Servicio (NFS-e)', ru: 'счёт-фактуру за услуги (NFS-e)' },
  fiscalInfoP2: {
    pt: ' automaticamente a cada semana, sem você precisar emitir manualmente. Preencha com os dados do seu ',
    en: ' automatically every week, without you needing to issue it manually. Fill in with your ',
    es: ' automáticamente cada semana, sin que usted tenga que emitirla manualmente. Complete con los datos de su ',
    ru: ' автоматически каждую неделю, без необходимости выставлять его вручную. Заполните данными вашего ',
  },
  fiscalMei:    { pt: 'MEI', en: 'MEI', es: 'MEI', ru: 'MEI' },
  fiscalInfoP3: { pt: '.', en: '.', es: '.', ru: '.' },

  procuracaoTitulo: { pt: 'PROCURAÇÃO P/ EMISSÃO', en: 'POWER OF ATTORNEY FOR ISSUANCE', es: 'PODER P/ EMISIÓN', ru: 'ДОВЕРЕННОСТЬ НА ВЫСТАВЛЕНИЕ' },
  procuracaoSub:    { pt: 'Concedida no gov.br / e-CAC', en: 'Granted on gov.br / e-CAC', es: 'Concedida en gov.br / e-CAC', ru: 'Предоставлена на gov.br / e-CAC' },

  cnpjMei:        { pt: 'CNPJ (MEI)', en: 'CNPJ (MEI)', es: 'CNPJ (MEI)', ru: 'CNPJ (MEI)' },
  razaoSocial:    { pt: 'RAZÃO SOCIAL', en: 'COMPANY NAME', es: 'RAZÓN SOCIAL', ru: 'НАИМЕНОВАНИЕ КОМПАНИИ' },
  phRazaoSocial:  { pt: 'Nome empresarial do MEI', en: 'Business name of the MEI', es: 'Nombre empresarial del MEI', ru: 'Юридическое наименование MEI' },
  cpfResponsavel: { pt: 'CPF DO RESPONSÁVEL', en: 'CPF OF THE RESPONSIBLE PERSON', es: 'CPF DEL RESPONSABLE', ru: 'CPF ОТВЕТСТВЕННОГО ЛИЦА' },
  inscricaoMunicipal: { pt: 'INSCRIÇÃO MUNICIPAL', en: 'MUNICIPAL REGISTRATION', es: 'INSCRIPCIÓN MUNICIPAL', ru: 'МУНИЦИПАЛЬНАЯ РЕГИСТРАЦИЯ' },
  phInscricaoMunicipal: { pt: 'Inscrição na prefeitura (se houver)', en: 'City hall registration (if any)', es: 'Inscripción en el ayuntamiento (si la hay)', ru: 'Регистрация в мэрии (если есть)' },
  emailFiscal:    { pt: 'E-MAIL FISCAL', en: 'TAX EMAIL', es: 'CORREO FISCAL', ru: 'НАЛОГОВАЯ ЭЛ. ПОЧТА' },
  phEmailFiscal:  { pt: 'onde você recebe a nota', en: 'where you receive the invoice', es: 'donde recibe la factura', ru: 'куда вы получаете счёт-фактуру' },
  nivelGovbr:     { pt: 'NÍVEL DA CONTA GOV.BR', en: 'GOV.BR ACCOUNT LEVEL', es: 'NIVEL DE LA CUENTA GOV.BR', ru: 'УРОВЕНЬ АККАУНТА GOV.BR' },
  govbrNotaP1:    { pt: 'A procuração exige nível ', en: 'The power of attorney requires ', es: 'El poder requiere nivel ', ru: 'Доверенность требует уровня ' },
  govbrNotaPrata: { pt: 'prata', en: 'silver', es: 'plata', ru: 'серебро' },
  govbrNotaOu:    { pt: ' ou ', en: ' or ', es: ' u ', ru: ' или ' },
  govbrNotaOuro:  { pt: 'ouro', en: 'gold', es: 'oro', ru: 'золото' },
  govbrNotaP2:    {
    pt: '. Subir de bronze é grátis (pelo banco ou reconhecimento facial no app gov.br).',
    en: ' level. Upgrading from bronze is free (through your bank or facial recognition in the gov.br app).',
    es: '. Subir desde bronce es gratis (a través del banco o reconocimiento facial en la app gov.br).',
    ru: '. Повышение с бронзы бесплатно (через банк или распознавание лица в приложении gov.br).',
  },
  salvarFiscal:   { pt: 'Salvar dados fiscais', en: 'Save tax details', es: 'Guardar datos fiscales', ru: 'Сохранить налоговые данные' },

  // Toasts
  nomeObrigatorio: { pt: 'Nome é obrigatório', en: 'Name is required', es: 'El nombre es obligatorio', ru: 'Имя обязательно' },
  dadosSalvos:     { pt: 'Dados salvos com sucesso!', en: 'Details saved successfully!', es: '¡Datos guardados con éxito!', ru: 'Данные успешно сохранены!' },
  erroSalvar:      { pt: 'Erro ao salvar. Tente novamente.', en: 'Error saving. Please try again.', es: 'Error al guardar. Inténtelo de nuevo.', ru: 'Ошибка сохранения. Попробуйте снова.' },
  dadosFiscaisSalvos: { pt: 'Dados fiscais salvos!', en: 'Tax details saved!', es: '¡Datos fiscales guardados!', ru: 'Налоговые данные сохранены!' },
  erroSalvarFiscais:  { pt: 'Erro ao salvar dados fiscais.', en: 'Error saving tax details.', es: 'Error al guardar los datos fiscales.', ru: 'Ошибка сохранения налоговых данных.' },
};

// Status da procuração (definido pela verificação automática / gestor — read-only aqui)
const PROCURACAO_COR: Record<string, string> = {
  pendente: '#fbbf24',
  ativa: '#4ade80',
  revogada: '#ef4444',
};

const COR_STATUS: Record<string, string> = {
  ativo: '#4ade80',
  pendente_aprovacao: '#fbbf24',
  pendente: '#fbbf24',
  inativo: '#ef4444',
};

const inp: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box',
  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
  color: '#fff', fontSize: 13, outline: 'none',
};

const lbl: React.CSSProperties = {
  display: 'block', color: 'rgba(255,255,255,.45)', fontSize: 10,
  fontWeight: 600, marginBottom: 5, letterSpacing: '.05em',
};

export default function TelaPrestadorPerfil({ usuario, onFechar, onLogout }: Props) {
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;

  const [tab, setTab] = useState<'dados' | 'pagamento' | 'fiscal' | 'telegram'>('dados');
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Dados pessoais
  const [nome, setNome] = useState(usuario.nome || '');
  const [cidade, setCidade] = useState(usuario.cidade || '');

  // CPF/CNPJ e dados fiscais
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [tipoContrato, setTipoContrato] = useState('');

  // PIX
  const [tipoPix, setTipoPix] = useState('CPF');
  const [chavePix, setChavePix] = useState('');

  // Fiscal / NFS-e (coleção prestadores_fiscal) — campos auto-declarados pelo prestador.
  // Os sensíveis (codigo_servico, aliquota_iss, etc.) NÃO entram aqui: são definidos
  // por gestor/Edge Fn. procuracaoStatus é apenas exibido (read-only).
  const [cnpjFiscal, setCnpjFiscal] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [cpfResponsavel, setCpfResponsavel] = useState('');
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('');
  const [emailFiscal, setEmailFiscal] = useState('');
  const [nivelGovbr, setNivelGovbr] = useState('desconhecido');
  const [procuracaoStatus, setProcuracaoStatus] = useState('pendente');

  // Cidades disponíveis
  const [cidadesDisponiveis, setCidadesDisponiveis] = useState<string[]>([]);

  // Rótulos traduzidos para mapas dinâmicos (valor/enum permanece igual ao gravado).
  const cargoLabel = (k: string | undefined): string | undefined => {
    switch (k) {
      case 'logistica': return pick(T.cargoLogistica);
      case 'promotor':  return pick(T.cargoPromotor);
      case 'fiscal':    return pick(T.cargoFiscal);
      case 'seguranca': return pick(T.cargoSeguranca);
      default:          return undefined;
    }
  };
  const procuracaoLabel = (k: string): string | undefined => {
    switch (k) {
      case 'pendente': return pick(T.procPendente);
      case 'ativa':    return pick(T.procAtiva);
      case 'revogada': return pick(T.procRevogada);
      default:         return undefined;
    }
  };
  const nivelGovbrLabel = (k: string): string => {
    switch (k) {
      case 'bronze': return pick(T.govBronze);
      case 'prata':  return pick(T.govPrata);
      case 'ouro':   return pick(T.govOuro);
      default:       return pick(T.govDesconhecido);
    }
  };
  const tipoPixLabel = (k: string): string => {
    switch (k) {
      case 'CPF':             return pick(T.pixCPF);
      case 'CNPJ':            return pick(T.pixCNPJ);
      case 'E-mail':          return pick(T.pixEmail);
      case 'Telefone':        return pick(T.pixTelefone);
      case 'Chave aleatória': return pick(T.pixAleatoria);
      default:                return k;
    }
  };

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      // Carregar dados do usuário via Supabase
      const d = await fetchUsuario(usuario.uid);
      if (d) {
        setNome(d.nome || usuario.nome || '');
        setCidade(d.cidade || usuario.cidade || '');
        if (d.cpf_cnpj) setCpfCnpj(d.cpf_cnpj);
        if (d.pix_tipo) setTipoPix(d.pix_tipo);
        if (d.pix_chave) setChavePix(d.pix_chave);
        if (d.tipo_contrato) setTipoContrato(d.tipo_contrato);
      }

      // Dados fiscais (NFS-e) — tabela prestadores_fiscal
      const { data: fiscalData } = await supabase
        .from('prestadores_fiscal')
        .select('*')
        .eq('firebase_uid', usuario.uid)
        .limit(1)
        .maybeSingle();
      if (fiscalData) {
        setCnpjFiscal(fiscalData.cnpj || '');
        setRazaoSocial(fiscalData.razao_social || '');
        setCpfResponsavel(fiscalData.cpf_responsavel || '');
        setInscricaoMunicipal(fiscalData.inscricao_municipal || '');
        setEmailFiscal(fiscalData.email_fiscal || '');
        setNivelGovbr(fiscalData.nivel_govbr || 'desconhecido');
        setProcuracaoStatus(fiscalData.procuracao_status || 'pendente');
      }

      // Complementa com solicitação de cadastro se não tiver pix/cpf ainda
      const { data: solData } = await supabase
        .from('solicitacoes_prestadores')
        .select('*')
        .eq('firebase_uid', usuario.uid)
        .limit(1)
        .maybeSingle();
      if (solData) {
        if (solData.cpf_cnpj) setCpfCnpj(prev => prev || solData.cpf_cnpj);
        if (solData.pix_chave) setChavePix(prev => prev || solData.pix_chave);
        if (solData.pix_tipo) setTipoPix(solData.pix_tipo);
        if (solData.tipo_contrato) setTipoContrato(prev => prev || solData.tipo_contrato);
      }

      // Buscar cidades reais das estações
      const { data: estData } = await supabase
        .from('estacoes')
        .select('cidade');
      const cidSet = new Set<string>();
      (estData ?? []).forEach((r: any) => { if (r.cidade) cidSet.add(r.cidade.trim()); });
      setCidadesDisponiveis(Array.from(cidSet).sort());
    } catch (e) {
      console.error('[perfil prestador] erro ao carregar:', e);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.uid]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const salvar = async () => {
    if (!nome.trim()) { showToast(pick(T.nomeObrigatorio)); return; }
    setSalvando(true);
    try {
      const patch = {
        nome: nome.trim(),
        cidade: cidade.trim(),
        cpf_cnpj: cpfCnpj.trim(),
        pix_tipo: tipoPix,
        pix_chave: chavePix.trim(),
      };
      await escreverUsuarioSupabase(usuario.uid, patch);

      // Espelha na solicitação de cadastro para o gestor ver dados atualizados
      await supabase
        .from('solicitacoes_prestadores')
        .update(patch)
        .eq('firebase_uid', usuario.uid);

      showToast(pick(T.dadosSalvos));
    } catch (e) {
      console.error(e);
      showToast(pick(T.erroSalvar));
    } finally {
      setSalvando(false);
    }
  };

  // Salva SÓ os campos fiscais auto-declarados em prestadores_fiscal/{uid}.
  // Não toca nos campos sensíveis (codigo_servico, aliquota_iss, procuracao_status,
  // faturamento_ano, ultimo_ndps) — a regra Firestore bloqueia o prestador de alterá-los.
  const salvarFiscal = async () => {
    setSalvando(true);
    try {
      await supabase
        .from('prestadores_fiscal')
        .upsert({
          firebase_uid:        usuario.uid,
          cnpj:                cnpjFiscal.trim(),
          razao_social:        razaoSocial.trim(),
          cpf_responsavel:     cpfResponsavel.trim(),
          inscricao_municipal: inscricaoMunicipal.trim(),
          email_fiscal:        emailFiscal.trim(),
          nivel_govbr:         nivelGovbr,
          regime_tributario:   'MEI',
        }, { onConflict: 'firebase_uid' });
      showToast(pick(T.dadosFiscaisSalvos));
    } catch (e) {
      console.error('[perfil fiscal] erro ao salvar:', e);
      showToast(pick(T.erroSalvarFiscais));
    } finally {
      setSalvando(false);
    }
  };

  const statusLabel = usuario.statusPrestador === 'ativo' ? pick(T.statusAtivo)
    : usuario.statusPrestador === 'pendente_aprovacao' || usuario.statusPrestador === 'pendente' ? pick(T.statusAguardando)
    : usuario.statusPrestador === 'inativo' ? pick(T.statusInativo)
    : pick(T.statusTraco);

  const statusCor = COR_STATUS[usuario.statusPrestador ?? ''] ?? '#7a8ba8';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2100,
      background: '#0d121e', display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, sans-serif', overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.07)',
        background: '#0d121e', position: 'sticky', top: 0, zIndex: 1,
        flexShrink: 0,
      }}>
        <button onClick={onFechar} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,.5)',
          fontSize: 20, cursor: 'pointer', padding: 4, lineHeight: 1,
        }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#dce8ff' }}>{pick(T.meuPerfil)}</div>
          <div style={{ fontSize: 11, color: '#7a8ba8' }}>
            {cargoLabel(usuario.cargoPrestador) ?? usuario.cargoPrestador ?? pick(T.cargoPrestador)}
          </div>
        </div>
        <button onClick={carregar} style={{
          background:'none', border:'none', color:'rgba(255,255,255,.4)',
          fontSize:18, cursor:'pointer', padding:4
        }}>↻</button>
        <button onClick={onLogout} style={{
          background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
          color: '#ef4444', borderRadius: 8, padding: '6px 12px',
          fontSize: 12, cursor: 'pointer', fontWeight: 600,
        }}>{pick(T.sair)}</button>
      </div>

      {/* Status card */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <div style={{
          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
          borderRadius: 12, padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(26,111,212,.15)', border: '1px solid rgba(26,111,212,.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, flexShrink: 0,
          }}>👤</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#dce8ff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nome || usuario.nome}</div>
            <div style={{ fontSize: 11, color: '#7a8ba8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{usuario.email}</div>
          </div>
          <div style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
            background: statusCor + '18', color: statusCor,
            border: `1px solid ${statusCor}44`, whiteSpace: 'nowrap', flexShrink: 0,
          }}>{statusLabel}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: '0 16px 12px',
        flexShrink: 0,
      }}>
        {([
          { k: 'dados',    label: pick(T.tabDados) },
          { k: 'pagamento', label: pick(T.tabPagamento) },
          { k: 'fiscal',   label: pick(T.tabFiscal) },
          { k: 'telegram', label: pick(T.tabTelegram) },
        ] as { k: typeof tab; label: string }[]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, border: 'none',
            background: tab === t.k ? 'rgba(26,111,212,.2)' : 'rgba(255,255,255,.04)',
            color: tab === t.k ? '#60a5fa' : 'rgba(255,255,255,.4)',
            outline: tab === t.k ? '1px solid rgba(26,111,212,.4)' : '1px solid rgba(255,255,255,.07)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '0 16px 24px', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#7a8ba8', paddingTop: 40, fontSize: 13 }}>
            {pick(T.carregando)}
          </div>
        ) : tab === 'dados' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={lbl}>{pick(T.nomeCompleto)}</label>
              <input style={inp} value={nome} onChange={e => setNome(e.target.value)}
                placeholder={pick(T.phNomeCompleto)} />
            </div>
            <div>
              <label style={lbl}>{pick(T.email)}</label>
              <input style={{ ...inp, opacity: 0.5, cursor: 'not-allowed' }}
                value={usuario.email} readOnly />
            </div>
            <div>
              <label style={lbl}>{pick(T.cargo)}</label>
              <input style={{ ...inp, opacity: 0.5, cursor: 'not-allowed' }}
                value={cargoLabel(usuario.cargoPrestador) ?? usuario.cargoPrestador ?? '—'} readOnly />
            </div>
            <div>
              <label style={lbl}>{pick(T.cidadeAtuacao)}</label>
              <select style={{ ...inp, appearance: 'none' as any }} value={cidade} onChange={e => setCidade(e.target.value)}>
                <option value="">{pick(T.selecioneCidade)}</option>
                {cidadesDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>{pick(T.tipoContrato)}</label>
              <input style={{ ...inp, opacity: 0.5, cursor: 'not-allowed' }}
                value={tipoContrato || '—'} readOnly />
            </div>
            <div>
              <label style={lbl}>{pick(T.cpfCnpj)}</label>
              <input style={inp} value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)}
                placeholder={pick(T.phCpfCnpj)} />
            </div>
            <button onClick={salvar} disabled={salvando} style={{
              padding: '12px', borderRadius: 10, border: 'none',
              background: salvando ? 'rgba(26,111,212,.3)' : '#1a6fd4',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}>{salvando ? pick(T.salvando) : pick(T.salvarDados)}</button>
          </div>
        ) : tab === 'pagamento' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.15)',
              borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#6ee7b7', lineHeight: 1.5,
            }}>
              {pick(T.pagamentoInfo)}
            </div>
            <div>
              <label style={lbl}>{pick(T.tipoChavePix)}</label>
              <select style={{ ...inp, appearance: 'none' as const }} value={tipoPix}
                onChange={e => setTipoPix(e.target.value)}>
                {TIPOS_PIX.map(t => <option key={t} value={t}>{tipoPixLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>{pick(T.chavePix)}</label>
              <input style={inp} value={chavePix} onChange={e => setChavePix(e.target.value)}
                placeholder={
                  tipoPix === 'CPF' ? pick(T.phPixCpf)
                  : tipoPix === 'CNPJ' ? pick(T.phPixCnpj)
                  : tipoPix === 'E-mail' ? pick(T.phPixEmail)
                  : tipoPix === 'Telefone' ? pick(T.phPixTelefone)
                  : pick(T.phPixAleatoria)
                } />
            </div>
            <div>
              <label style={lbl}>{pick(T.cpfCnpjTitular)}</label>
              <input style={inp} value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)}
                placeholder={pick(T.phCpfCnpjTitular)} />
            </div>
            <button onClick={salvar} disabled={salvando} style={{
              padding: '12px', borderRadius: 10, border: 'none',
              background: salvando ? 'rgba(16,185,129,.3)' : '#059669',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}>{salvando ? pick(T.salvando) : pick(T.salvarPagamento)}</button>
          </div>
        ) : tab === 'fiscal' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.15)',
              borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#a5b4fc', lineHeight: 1.5,
            }}>
              {pick(T.fiscalInfoP1)}<strong>{pick(T.fiscalNfse)}</strong>{pick(T.fiscalInfoP2)}<strong>{pick(T.fiscalMei)}</strong>{pick(T.fiscalInfoP3)}
            </div>

            {/* Status da procuração — read-only (definido pela verificação automática) */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
              borderRadius: 10, padding: '10px 14px',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', fontWeight: 600 }}>{pick(T.procuracaoTitulo)}</div>
                <div style={{ fontSize: 10, color: '#7a8ba8', marginTop: 2 }}>{pick(T.procuracaoSub)}</div>
              </div>
              <div style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: (PROCURACAO_COR[procuracaoStatus] ?? '#7a8ba8') + '18',
                color: PROCURACAO_COR[procuracaoStatus] ?? '#7a8ba8',
                border: `1px solid ${(PROCURACAO_COR[procuracaoStatus] ?? '#7a8ba8')}44`,
              }}>{procuracaoLabel(procuracaoStatus) ?? '—'}</div>
            </div>

            <div>
              <label style={lbl}>{pick(T.cnpjMei)}</label>
              <input style={inp} value={cnpjFiscal} onChange={e => setCnpjFiscal(e.target.value)}
                placeholder="00.000.000/0001-00" />
            </div>
            <div>
              <label style={lbl}>{pick(T.razaoSocial)}</label>
              <input style={inp} value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)}
                placeholder={pick(T.phRazaoSocial)} />
            </div>
            <div>
              <label style={lbl}>{pick(T.cpfResponsavel)}</label>
              <input style={inp} value={cpfResponsavel} onChange={e => setCpfResponsavel(e.target.value)}
                placeholder="000.000.000-00" />
            </div>
            <div>
              <label style={lbl}>{pick(T.inscricaoMunicipal)}</label>
              <input style={inp} value={inscricaoMunicipal} onChange={e => setInscricaoMunicipal(e.target.value)}
                placeholder={pick(T.phInscricaoMunicipal)} />
            </div>
            <div>
              <label style={lbl}>{pick(T.emailFiscal)}</label>
              <input style={inp} type="email" value={emailFiscal} onChange={e => setEmailFiscal(e.target.value)}
                placeholder={pick(T.phEmailFiscal)} />
            </div>
            <div>
              <label style={lbl}>{pick(T.nivelGovbr)}</label>
              <select style={{ ...inp, appearance: 'none' as const }} value={nivelGovbr}
                onChange={e => setNivelGovbr(e.target.value)}>
                {NIVEIS_GOVBR.map(n => <option key={n} value={n}>{nivelGovbrLabel(n)}</option>)}
              </select>
              <div style={{ fontSize: 10, color: '#7a8ba8', marginTop: 5, lineHeight: 1.4 }}>
                {pick(T.govbrNotaP1)}<strong>{pick(T.govbrNotaPrata)}</strong>{pick(T.govbrNotaOu)}<strong>{pick(T.govbrNotaOuro)}</strong>{pick(T.govbrNotaP2)}
              </div>
            </div>
            <button onClick={salvarFiscal} disabled={salvando} style={{
              padding: '12px', borderRadius: 10, border: 'none',
              background: salvando ? 'rgba(99,102,241,.3)' : '#6366f1',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}>{salvando ? pick(T.salvando) : pick(T.salvarFiscal)}</button>
          </div>
        ) : (
          <TelegramVinculo
            usuario={usuario}
            modo="inline"
            onVinculado={() => {}}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1a6fd4', color: '#fff', borderRadius: 20,
          padding: '10px 20px', fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,.4)', zIndex: 9999,
          whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}
    </div>
  );
}
