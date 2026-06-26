// src/GuiaPanel.tsx — Guia interativo do JET OS
// Atualizado: Jun/2026 — Guard v2: timeline, dano oficina, dashboard mobile, filtros cidade, notif Telegram
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props { role: string; onFechar: () => void; }

const TOPICOS_META = [
  { id: 'mapa',             icone: '🗺',  roles: ['admin','gestor','gestor_log','supergestor','gestor_seg','campo','guard','viewer','logistica'] },
  { id: 'add-estacao',      icone: '➕',  roles: ['admin','gestor','supergestor','campo'] },
  { id: 'foto-medidas',     icone: '📐',  roles: ['admin','gestor','supergestor','campo'] },
  { id: 'guard',            icone: '🛡',  roles: ['admin','gestor','supergestor','gestor_seg','campo'] },
  { id: 'ocorrencias-guard',icone: '🚨',  roles: ['admin','gestor','supergestor','gestor_seg','campo','guard'] },
  { id: 'guard-expandido',  icone: '🔒',  roles: ['admin','gestor','supergestor','gestor_seg'] },
  { id: 'roubos',           icone: '🔴',  roles: ['admin','gestor','supergestor','gestor_seg'] },
  { id: 'slots-logistica',  icone: '📦',  roles: ['admin','gestor','gestor_log','supergestor','logistica','campo'] },
  { id: 'slots-gestor',     icone: '🎛',  roles: ['admin','gestor','gestor_log','supergestor'] },
  { id: 'tarefas-logistica',icone: '✅',  roles: ['admin','gestor','gestor_log','supergestor','logistica','campo'] },
  { id: 'gojet-overlay',    icone: '🛴',  roles: ['admin','gestor','gestor_log','supergestor'] },
  { id: 'gps-alertas',      icone: '📡',  roles: ['admin','gestor','gestor_log','supergestor'] },
  { id: 'analytics',        icone: '📊',  roles: ['admin','gestor','supergestor'] },
  { id: 'dashboard',        icone: '📋',  roles: ['admin','gestor','supergestor','gestor_seg'] },
  { id: 'zonas',            icone: '⬡',   roles: ['admin','gestor','supergestor'] },
  { id: 'locais-logisticos',icone: '🏭',  roles: ['admin','gestor','supergestor'] },
  { id: 'pois',             icone: '🔍',  roles: ['admin','gestor','supergestor'] },
  { id: 'instalar-pwa',     icone: '📲',  roles: ['admin','gestor','gestor_log','supergestor','gestor_seg','campo','guard','viewer','logistica'] },
  { id: 'privacidade',      icone: '🔒',  roles: ['admin','gestor','gestor_log','supergestor','gestor_seg','campo','guard','viewer','logistica','prestador'] },
];

const TOPICOS_FIXOS: Record<string, {
  titulo: string;
  passos: { titulo: string; desc: string; dica?: string }[];
}> = {
  'analytics': {
    titulo: 'Analytics de corridas',
    passos: [
      { titulo: 'Importar dados', desc: 'Clique em "📊 Analytics" e arraste o arquivo Excel exportado do sistema.' },
      { titulo: 'Mapa de calor', desc: 'O mapa mostra as rotas de início e fim de cada corrida com intensidade por volume.' },
      { titulo: 'Filtros', desc: 'Use os botões na toolbar para alternar entre Heatmap, Hexbins, Arcos e Pontos.' },
      { titulo: 'Modo 3D', desc: 'Clique em "🏔 3D" para inclinar o mapa. Segure Ctrl + arraste para rotacionar.', dica: 'Combine o modo Hexbin 3D com as Zonas para identificar bairros de alta demanda.' },
    ],
  },
  'dashboard': {
    titulo: 'Dashboard e relatórios',
    passos: [
      { titulo: 'Relatório de estação', desc: 'Em "📋 Dash" → Relatórios, selecione uma estação e clique em "Gerar PDF".' },
      { titulo: 'Exportar Guard', desc: 'Em Dash → Guard, use os filtros e clique em "Exportar Excel".' },
      { titulo: 'Gerenciar usuários', desc: 'Clique no ícone 👥 no header. Aprove solicitações definindo o role. Gestor Segurança: role gestor_seg.' },
      { titulo: 'Notificações Telegram', desc: 'Em Dash → Guard → Config (só admin), configure quais tipos de ocorrências disparam alerta.', dica: 'O bot precisa do token configurado nas Cloud Functions.' },
    ],
  },
  'pois': {
    titulo: 'Pontos de interesse (POIs)',
    passos: [
      { titulo: 'POIs OSM', desc: 'Clique no FAB 🔍 e depois em 📍 para carregar pontos do OpenStreetMap.' },
      { titulo: 'Pt. Candidatos', desc: 'Clique em 🎯 para abrir o painel de pontos candidatos.', dica: 'Ajuste os parâmetros de Raio Gap, Raio Área e Score Mínimo para calibrar as sugestões.' },
    ],
  },
  'locais-logisticos': {
    titulo: 'Locais Logísticos',
    passos: [
      { titulo: 'O que são', desc: 'Bases de Carga, Centros de Serviço, Depósitos e Pontos de Redistribuição — onde os patinetes são carregados, reparados ou armazenados.' },
      { titulo: 'Ativar no mapa', desc: 'Clique no FAB 🏭 à direita. Os pins aparecem com ícone por tipo.', dica: 'Clique em qualquer pin para editar o local.' },
      { titulo: 'Cadastrar novo local', desc: 'Com 🏭 ativo, clique em 📍 e toque no mapa. O painel de cadastro abre com nome, tipo, foto, capacidade e responsável.' },
      { titulo: 'Gestão financeira', desc: 'Clique em 💳 para abrir o painel financeiro. Selecione um local e o mês para ver pagamentos.', dica: 'Para energia, leitura anterior + atual calcula o valor automaticamente.' },
    ],
  },
  'zonas': {
    titulo: 'Zonas e polígonos',
    passos: [
      { titulo: 'Criar zona', desc: 'Clique no FAB ⬡ e depois em "Nova zona". Clique no mapa para adicionar vértices.' },
      { titulo: 'Importar KMZ', desc: 'Clique em "📂 KMZ" para importar zonas de um arquivo Google My Maps. Estações são ignoradas automaticamente — só polígonos são importados.' },
      { titulo: 'Editar vértices', desc: 'Selecione uma zona e clique em "Editar vértices" para arrastar os pontos.' },
      { titulo: 'Configurar', desc: 'Defina nome, grupo, fase, cor e prioridade.' },
    ],
  },
  'slots-gestor': {
    titulo: '🎛 Criar & Gerenciar Slots',
    passos: [
      {
        titulo: 'O que é um slot',
        desc: 'Um slot é um turno de trabalho atribuído a um ou mais agentes de logística. Ele agrupa tarefas (pontos a visitar), define horário, zona e tipo (Charger = trocar bateria / Scout = redistribuir patinetes). O agente aceita, faz check-in com foto e executa as tarefas uma a uma.',
        dica: 'Cada slot tem um SLA de aceite: se ninguém aceitar dentro do prazo, o sistema escala automaticamente via Telegram.',
      },
      {
        titulo: 'Criar slot manual',
        desc: 'Acesse 📦 Slots → aba "➕ Criar". Escolha o tipo (Scout ou Charger), preencha título, turno início/fim, zona, SLA de aceite e (opcional) atribua um worker já existente. Adicione as tarefas com destino, quantidade e prioridade. Clique "✓ Criar Slot".',
        dica: 'Se você deixar o campo "Worker" vazio, o slot fica aberto para qualquer agente da cidade aceitar.',
      },
      {
        titulo: 'Auto-slots: ativar motor',
        desc: 'Em 📦 Slots → aba "🤖 Auto-slots", crie uma configuração por zona. Defina os limiares de quantidade (mínimo, alvo, máximo para pontos GoJet) e o limiar de bateria (%). O motor roda a cada 15 min via Cloud Function e cria slots automaticamente quando os critérios forem atingidos.',
        dica: 'O motor lê o snapshot GoJet ao vivo. Pontos zerados geram slots urgentes; pontos com excesso geram scouts de redistribuição.',
      },
      {
        titulo: 'Faixas de horário (auto)',
        desc: 'Na config de auto-slot, aba "⏰ Faixas": defina janelas de tempo com parâmetros próprios — ex: pico manhã 07h-09h com alvo 12 bikes, noturno 22h-00h com alvo reduzido. A faixa ativa sobrepõe os valores globais da zona.',
        dica: 'Faixas com horário cruzando meia-noite (ex: 22:00 → 02:00) são suportadas. A de maior prioridade numérica vence sobreposições.',
      },
      {
        titulo: 'Quantos workers por slot auto',
        desc: 'Na config da zona, campo "Workers por slot": defina N. O motor buscará os N agentes disponíveis mais próximos do centroide da demanda e distribuirá as tarefas em round-robin (tarefa 1→worker A, tarefa 2→worker B, tarefa 3→worker A…).',
        dica: 'Use 2+ workers em zonas grandes ou quando houver muitos pontos críticos simultâneos.',
      },
      {
        titulo: 'Incluir bikes fora de ponto (Scout)',
        desc: 'Na config da zona, ative "Incluir bikes fora de ponto". O motor detectará patinetes sem parking_id (fora de qualquer P GoJet) e gerará tarefas "📍 Retornar para [Ponto X]" agrupando bikes no raio de 0,5 km mais próximo de um ponto monitor.',
      },
      {
        titulo: 'Acompanhar slot em tempo real',
        desc: 'Na aba "📋 Slots", cada card mostra: status, worker atribuído, progresso (tarefas concluídas/total), SLA e badges de prioridade. Clique no card para expandir e ver todas as tarefas com status individual. O card pisca em laranja quando o SLA de aceite está próximo do vencimento.',
        dica: 'Use o filtro de status no topo (Aberto / Em andamento / Concluído) para focar nos slots ativos.',
      },
      {
        titulo: 'Reatribuir ou cancelar slot',
        desc: 'No card expandido do slot, clique em "✏ Reatribuir" para trocar o worker sem perder o histórico. Para cancelar, clique "✕ Cancelar" e informe o motivo — o worker recebe notificação push + Telegram automaticamente.',
        dica: 'Um slot cancelado não pode ser reaberto. Crie um novo slot se necessário.',
      },
      {
        titulo: 'Aba Equipe',
        desc: 'Em 📦 Slots → aba "👥 Equipe", veja todos os workers da cidade com seu status atual (livre, em slot, offline). Clique em qualquer worker para ver o histórico de slots e taxa de conclusão.',
      },
      {
        titulo: 'Charger: prioridade de bateria',
        desc: 'O motor charger ordena patinetes do mais crítico (menor bateria) para o menos crítico. Bikes abaixo de 10% recebem prioridade "urgente" e ficam no topo. As tarefas são agrupadas por ponto GoJet: uma tarefa por cluster, com lista de IDs das bikes.',
        dica: 'O threshold de bateria é configurável por zona e por faixa de horário. Padrão: 40%.',
      },
      {
        titulo: 'Scout: classificação de pontos',
        desc: 'Zerado (0 bikes) → urgente, repor alvo inteiro. Baixo (<50% target) → alta, repor diferença. Excesso (>120% target) → normal, redistribuir sobra. Todos os tipos vão em UM slot único, ordenados por urgência — o agente trabalha do mais crítico ao menos crítico.',
      },
      {
        titulo: 'SLA e escalada automática',
        desc: 'Se um slot ficar sem aceite além do SLA configurado (ex: 10 min), a Cloud Function escala: envia Telegram para o grupo de gestores com o link do slot, aumenta a prioridade e agenda novo disparo para os próximos workers disponíveis.',
        dica: 'Configure o SLA de aceite em cada zona de auto-slot. Slots manuais também têm o campo SLA na criação.',
      },
      {
        titulo: 'GPS da equipe no mapa',
        desc: 'Com o overlay 👥 Campo ativo, veja todos os agentes com GPS recente no mapa. Ponto verde = ativo há <90s. Ponto amarelo = 90s-5min. Ponto vermelho = >5min sem atualização. Clique no pin para voar até a posição.',
        dica: 'Na tela de detalhe de uma tarefa, o mini-mapa mostra a distância do agente ao destino em tempo real.',
      },
      {
        titulo: 'Exportar histórico',
        desc: 'Em 📦 Slots → aba "📂 Histórico" (admin/gestor), filtre por período, tipo, zona e status. Clique "⬇ CSV" para exportar com BOM UTF-8 — abre direto no Excel BR sem precisar de encoding manual.',
      },
    ],
  },

  'slots-logistica': {
    titulo: 'Slots & Logística',
    passos: [
      { titulo: 'O que são slots', desc: 'Slots são turnos de trabalho para agentes de logística (charger, scalt). Cada slot tem horário, zona e cargo.' },
      { titulo: 'Aceitar um slot', desc: 'Na aba "⏰ Slots", veja os slots abertos e clique "✓ Aceitar Slot" para se inscrever no turno.' },
      { titulo: 'Check-in com foto', desc: 'No horário do turno, clique em "▶ Iniciar trabalho + Foto" para registrar sua chegada. A câmera abre automaticamente.', dica: 'A foto é salva no Firebase Storage e vinculada ao seu turno.' },
      { titulo: 'GPS em background', desc: 'Ao iniciar o turno, o GPS é ativado automaticamente. No Android APK, o rastreamento continua mesmo com a tela bloqueada via Foreground Service.', dica: 'Vá em Configurações → Apps → JET OS → Bateria → Sem restrição para melhor performance.' },
      { titulo: 'Executar tarefa', desc: 'Clique "▶ Iniciar tarefa", vá até o ponto, tire foto de comprovação e clique "✓ Marcar como concluída".' },
      { titulo: 'Entregas parciais', desc: 'Em tarefas de PONTO, use os botões +/- para registrar quantas patinetes entregou de cada vez. Cada entrega parcial salva uma foto.', dica: 'A tarefa conclui automaticamente quando atingir o target.' },
      { titulo: 'Navegação', desc: 'Em cada tarefa há botões 🗺 Google Maps e 🚗 Waze. O botão 🎯 permite ao gestor mudar o destino clicando num ponto GoJet no mapa.' },
      { titulo: 'Check-out', desc: 'Ao terminar o turno, clique "⏸ Parar trabalho". O GPS é encerrado e o turno registrado.' },
    ],
  },
  'tarefas-logistica': {
    titulo: '📦 Módulo de Tarefas',
    passos: [
      { titulo: 'Abrir o módulo', desc: 'Clique no botão 📦 Tarefas nos FABs laterais. Disponível para logística, campo, gestor e admin.' },
      { titulo: 'Worker Home', desc: 'A aba 🏠 Início mostra seu status (trabalhando/parado), tempo de turno e tarefas ativas. Toque em "▶ Iniciar trabalho + Foto" para começar.' },
      { titulo: 'Criar tarefa — GoJet', desc: 'Na aba ➕ Criar, selecione "🛴 Ponto GoJet" para ver a lista de pontos ao vivo ordenados por déficit. Zerados aparecem no topo com badge ZERADO.', dica: 'Ative o filtro "🔴 Só críticos" para ver apenas pontos abaixo de 50% do target.' },
      { titulo: 'Criar tarefa — Estação JET OS', desc: 'Clique em qualquer estação do mapa e toque em "📦 + Criar tarefa" no popup. O nome e coordenadas são preenchidos automaticamente.' },
      { titulo: 'Criar tarefa — GoJet no mapa', desc: 'Com o overlay GoJet ativo, clique num ponto P e toque em "+ Criar tarefa". O ponto é pré-selecionado com déficit calculado.' },
      { titulo: 'Geração automática', desc: 'Tarefas são geradas automaticamente a cada hora para pontos GoJet abaixo de 50% do target. Aparecem com badge AUTO no kanban.' },
      { titulo: 'Kanban fullscreen', desc: 'Na aba 📊 Kanban, clique em ⊞ para expandir em tela cheia. No desktop, as colunas ficam lado a lado.' },
      { titulo: 'Mudar destino', desc: 'No detalhe de uma tarefa, clique 🎯 — um banner laranja aparece no mapa. Clique em qualquer P GoJet para definir o novo destino.', dica: 'Só disponível para gestor/admin.' },
      { titulo: 'Dashboard', desc: 'A aba 📈 Stats mostra: taxa de conclusão, duração média, ranking de agentes com ouro/prata/bronze, top pontos mais atendidos.' },
      { titulo: 'Histórico CSV', desc: 'A aba 📂 Histórico tem filtros por status, tipo, agente e busca. Clique em ⬇ CSV para exportar com BOM (abre direto no Excel BR).' },
      { titulo: 'Notificações', desc: 'Ao atribuir uma tarefa, o agente recebe push nativo (Android FCM) e Telegram simultaneamente.' },
    ],
  },
  'gojet-overlay': {
    titulo: 'GoJet ao vivo no mapa',
    passos: [
      { titulo: 'Ativar overlay', desc: 'Clique no botão 🛴 nos FABs laterais. O overlay busca dados em tempo real da API GoJet.' },
      { titulo: 'Pontos independentes', desc: 'Toggle 🅿️ Pontos e 🛴 Patinetes são independentes. Pode mostrar só pontos, só bikes, ou ambos.' },
      { titulo: 'Mini-dashboard', desc: 'Clique em 📊 no canto inferior esquerdo para abrir o painel com stats: zerados, abaixo do target, bikes por status, estações M1/M2/M3 vinculadas.' },
      { titulo: 'Freshness indicator', desc: 'O painel mostra há quanto tempo os dados foram buscados. Verde = agora, amarelo = até 3min, vermelho = mais de 3min.' },
      { titulo: 'Filtros de pontos', desc: 'Barra inferior: Todos | 🔴 Zerados | 🟡 < target | 🔵 No target | 🟢 Excesso | ⭐ Monitor | 🔗 M1/M2/M3', dica: 'O filtro 🔗 M1/M2/M3 mostra só pontos GoJet com estação JET OS a menos de 150m.' },
      { titulo: 'Filtros de bikes', desc: '⚠️ Fora ponto | 🟠 Bat. baixa | 🟢 Disponíveis. Bikes mostram barrinha de bateria colorida.' },
      { titulo: 'Vínculo M1/M2/M3', desc: 'Pontos GoJet próximos de estações Monitor exibem badge colorido (M1 verde, M2 azul, M3 amarelo). O popup mostra a distância até a estação.' },
      { titulo: 'APK Android', desc: 'No app Android, os dados vêm do snapshot Firestore (sem CORS). Atualiza quando o scraper roda a cada 5 minutos.' },
      { titulo: 'Campo no mapa', desc: 'Clique em 👥 Campo para ver operadores online com GPS recente. Clique em um nome para voar até a posição deles.' },
    ],
  },
  'roubos': {
    titulo: '🔴 Roubos & Relatórios Guard',
    passos: [
      { titulo: 'Abrir painel', desc: 'Clique em 🔴 Roubos nos FABs do mapa. Disponível para gestor, gestor_seg e admin. Pins vermelhos aparecem no mapa ao abrir o Guard.' },
      { titulo: 'KPIs', desc: 'Total roubos, recuperados, taxa de recuperação, procurados em aberto. Filtros: 7d / 30d / 90d / tudo. Busque por ativo ID, cidade ou descrição.' },
      { titulo: 'Relatório diário automático', desc: 'Enviado às 7h de terça a domingo para o grupo do Telegram. Reporta o dia anterior. Na segunda-feira envia o relatório semanal (dom → sáb da semana anterior).' },
      { titulo: 'Relatório manual', desc: 'Botão "Enviar Relatório" no Dashboard Guard. Gera e envia imediatamente o PDF executivo de 4 páginas mais mensagem PT-BR + RU.' },
      { titulo: 'Estrutura do PDF', desc: 'Pág 1 PT: Roubos em aberto (sem recuperados), KPIs, tabela por cidade, detalhes 24h. Pág 2 RU: mesma info em russo. Pág 3: Vandalismo com danos R$ e %. Pág 4: Perdas BRPD, KPIs gerais e apêndice completo com fotos clicáveis.' },
      { titulo: 'Datas reais no relatório', desc: 'Ontem aparece com a data real (ex: 09/06). O mês atual mostra o intervalo (ex: 01/06 a 09/06). O acumulado mostra o intervalo de anos dos dados (ex: 2023–2026).' },
    ],
  },
  'guard-expandido': {
    titulo: '🛡 Guard & Segurança',
    passos: [
      { titulo: 'Registrar ocorrência', desc: 'Clique no FAB 🛡 no mapa. Preencha tipo, descrição, local e fotos. O Telegram recebe notificação automática para Roubo, Vandalismo e Tentativa. Ao recuperar, o Telegram também é notificado.' },
      { titulo: 'Tipos de ocorrência', desc: 'Vandalismo, Roubo, Tentativa, Recuperação, Outro. Roubos aparecem no Painel de Roubos. Vandalismos têm campos extras de avaliação de dano (%, R$).' },
      { titulo: 'Dano de Vandalismo', desc: 'Ao editar uma ocorrência de Vandalismo, preencha os campos "% Dano" (0–100) e "Valor R$" após avaliação da oficina. Esses dados aparecem no Dashboard Guard e no Relatório.' },
      { titulo: 'Timeline de edições', desc: 'Cada alteração salva (status, tipo, ativo, BO, procurando) é registrada no histórico da ocorrência com nome do usuário, campo alterado e timestamp. Visível no modal de edição.' },
      { titulo: 'Aba Procurados', desc: 'Na tela Guard mobile, a aba 🔍 Procurados lista todos os ativos marcados como procurado. Use a busca por ID do ativo, cidade ou tipo. Qualquer role pode editar qualquer ocorrência.' },
      { titulo: 'Filtros por cidade', desc: 'No painel Guard do mapa, chips de cidade aparecem acima da lista. Clique para filtrar ocorrências da cidade desejada. Clique novamente para remover o filtro.' },
      { titulo: 'Dashboard Guard', desc: 'Botão "📊 Guard Dash" no header. Mostra Roubos, Vandalismo, danos R$, perdas BRPD, taxa de recuperação e evolução semanal. Funciona em mobile (layout vertical automático).' },
      { titulo: 'Contador de tempo', desc: 'Ocorrências Abertas mostram badge "🔓 2h30m" indicando há quanto tempo estão em aberto. Amarelo < 6h, laranja > 6h, vermelho > 1 dia.' },
      { titulo: 'Relatório executivo', desc: 'Botão "Enviar Relatório" no Dashboard Guard envia para o Telegram: mensagem PT-BR + RU e PDF de 4 páginas. Pág 1: Roubos PT. Pág 2: Roubos RU. Pág 3: Vandalismo. Pág 4: Perdas e apêndice completo.' },
      { titulo: 'Role Gestor Seg', desc: 'O role "gestor_seg" acessa Guard, Analytics Guard, Dashboard Guard e Painel de Roubos. Pode aprovar registros de prestadores. Não tem acesso a estações ou slots.' },
    ],
  },
  'gps-alertas': {
    titulo: '📡 Alertas GPS automáticos',
    passos: [
      { titulo: 'O que é', desc: 'Cloud Functions monitoram o GPS dos operadores em campo e enviam alertas via Telegram automaticamente.' },
      { titulo: 'Alerta de chegada', desc: 'Se o operador não chegar ao ponto em 20 minutos após iniciar a tarefa, o Telegram avisa o gestor com a distância atual.' },
      { titulo: 'Alerta de atraso', desc: 'Se uma tarefa ficar em execução por mais de 30 minutos sem concluir, um alerta é enviado com o progresso (ex: 3/5 entregues).' },
      { titulo: 'GPS perdido', desc: 'Se um operador com tarefa ativa ficar mais de 10 minutos sem enviar GPS, o Telegram avisa para verificar o app.', dica: 'Configure em Configurações → Apps → JET OS → Bateria → Sem restrição.' },
      { titulo: 'Cooldown', desc: 'Alertas têm cooldown de 30 minutos para não spam. O mesmo operador/tarefa não gera alertas repetidos antes disso.' },
    ],
  },
  'instalar-pwa': {
    titulo: 'Instalar o app',
    passos: [
      { titulo: 'Android (Chrome)', desc: 'Abra o JET OS no Chrome. Toque no menu ⋮ → "Instalar app" ou "Adicionar à tela inicial". Confirme e abra pelo ícone.' },
      { titulo: 'iPhone (Safari)', desc: 'Abra no Safari. Toque em ⬆ Compartilhar → "Adicionar à Tela de Início". Toque em "Adicionar".' },
      { titulo: 'APK Android', desc: 'Para tracking GPS em background, instale o APK nativo (não a PWA). Solicite o link APK ao gestor ou acesse o Dashboard → Distribuir app.' },
      { titulo: 'Permissões obrigatórias', desc: 'Localização: "Permitir o tempo todo". Notificações: "Permitir". Sem essas permissões o GPS e o push não funcionam.' },
      { titulo: 'Bateria', desc: 'Desative a otimização de bateria para o JET OS: Configurações → Apps → JET OS → Bateria → Sem restrição.', dica: 'Em Xiaomi/Huawei/Samsung, procure "Autostart" e ative também.' },
    ],
  },
};

const ROLE_LABEL: Record<string,string> = {
  admin:'Admin', gestor:'Gestor', supergestor:'SuperGestor',
  gestor_log:'Gest. Log.', gestor_seg:'Gest. Seg', campo:'Campo',
  guard:'Guard', viewer:'Viewer', logistica:'Logística',
};

export default function GuiaPanel({ role, onFechar }: Props) {
  const { t, i18n } = useTranslation();
  const [topicoAtivo, setTopicoAtivo] = useState<string | null>(null);
  const [passoAtivo,  setPassoAtivo]  = useState(0);

  const getTopico = (id: string) => {
    const guideTopics = (t('guide.topics', { returnObjects: true }) as any) || {};
    if (guideTopics[id]) return guideTopics[id];
    return TOPICOS_FIXOS[id] || { titulo: id, passos: [] };
  };

  const topicosVisiveis = TOPICOS_META.filter(tm => tm.roles.includes(role));
  const topicoMeta = TOPICOS_META.find(tm => tm.id === topicoAtivo);
  const topico = topicoAtivo ? { ...topicoMeta, ...getTopico(topicoAtivo) } : null;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1300, background:'rgba(0,0,0,.6)',
      backdropFilter:'blur(6px)', display:'flex', alignItems:'flex-start',
      justifyContent:'center', padding:'20px 16px', overflowY:'auto' }}
      onClick={e => e.target === e.currentTarget && onFechar()}>

      <div style={{ width:'100%', maxWidth:520, background:'#0d1521',
        border:'1px solid rgba(99,102,241,.2)', borderRadius:18,
        display:'flex', flexDirection:'column', maxHeight:'calc(100vh - 40px)',
        fontFamily:'Inter,sans-serif', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,.06)',
          flexShrink:0, background:'linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.06))' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:'#c7d2fe', letterSpacing:-.3 }}>
                ✦ {t('guide.title', 'Guia JET OS')}
              </div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,.35)', marginTop:2 }}>
                {String(t('guide.subtitle','{n} tópicos disponíveis para {role}'))
                  .replace('{n}', String(topicosVisiveis.length))
                  .replace('{role}', ROLE_LABEL[role] || role)}
              </div>
            </div>
            {topicoAtivo ? (
              <button onClick={() => { setTopicoAtivo(null); setPassoAtivo(0); }}
                style={{ background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                  borderRadius:8, color:'rgba(255,255,255,.5)', padding:'6px 12px',
                  cursor:'pointer', fontSize:11 }}>
                {t('guide.back','← Voltar')}
              </button>
            ) : (
              <button onClick={onFechar}
                style={{ background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                  borderRadius:8, color:'rgba(255,255,255,.5)', padding:'6px 12px',
                  cursor:'pointer', fontSize:11 }}>
                {t('guide.close','✕ Fechar')}
              </button>
            )}
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ flex:1, overflowY:'auto', scrollbarWidth:'thin' as const }}>
          {!topicoAtivo ? (
            <div style={{ padding:'16px' }}>
              <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', marginBottom:12,
                fontWeight:600, letterSpacing:'.08em' }}>
                {t('guide.selectTopic','SELECIONE UM TÓPICO PARA COMEÇAR')}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {topicosVisiveis.map(tm => {
                  const tp = getTopico(tm.id);
                  return (
                    <button key={tm.id}
                      onClick={() => { setTopicoAtivo(tm.id); setPassoAtivo(0); }}
                      style={{ padding:'16px 14px', borderRadius:12, cursor:'pointer',
                        textAlign:'left', background:'rgba(255,255,255,.04)',
                        border:'1px solid rgba(255,255,255,.07)',
                        display:'flex', flexDirection:'column', gap:6 }}>
                      <div style={{ fontSize:22 }}>{tm.icone}</div>
                      <div style={{ fontSize:12, fontWeight:700, color:'#dce8ff' }}>{tp.titulo}</div>
                      <div style={{ fontSize:10, color:'rgba(255,255,255,.3)' }}>
                        {tp.passos?.length || 0} {t('guide.steps','passos')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : topico ? (
            <div style={{ padding:'16px' }}>
              {/* Todos os passos */}
              <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', marginBottom:10,
                fontWeight:600, letterSpacing:'.08em' }}>
                {t('guide.allSteps','TODOS OS PASSOS')}
              </div>
              {topico.passos?.map((p: any, i: number) => (
                <div key={i} onClick={() => setPassoAtivo(i)}
                  style={{ padding:'12px 14px', borderRadius:10, marginBottom:8, cursor:'pointer',
                    background: passoAtivo === i ? 'rgba(99,102,241,.15)' : 'rgba(255,255,255,.03)',
                    border:`1px solid ${passoAtivo === i ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.06)'}` }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:22, height:22, borderRadius:11, flexShrink:0,
                      background: passoAtivo === i ? '#6366f1' : 'rgba(255,255,255,.08)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:11, fontWeight:700, color: passoAtivo === i ? '#fff' : 'rgba(255,255,255,.4)' }}>
                      {i+1}
                    </div>
                    <div style={{ fontSize:12, fontWeight:600, color: passoAtivo === i ? '#c7d2fe' : '#dce8ff' }}>
                      {p.titulo}
                    </div>
                  </div>
                  {passoAtivo === i && (
                    <div style={{ marginTop:10, paddingLeft:30 }}>
                      <div style={{ fontSize:13, color:'rgba(255,255,255,.7)', lineHeight:1.6 }}>
                        {p.desc}
                      </div>
                      {p.dica && (
                        <div style={{ marginTop:10, padding:'8px 12px',
                          background:'rgba(251,191,36,.08)', border:'1px solid rgba(251,191,36,.2)',
                          borderRadius:8, fontSize:12, color:'#fbbf24', lineHeight:1.5 }}>
                          {t('guide.tip','💡 Dica')}: {p.dica}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 20px', borderTop:'1px solid rgba(255,255,255,.06)',
          flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:10, color:'rgba(255,255,255,.2)' }}>
            {t('guide.footer','✦ JET OS · versão campo')}
          </div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,.2)' }}>
            {t('guide.footerDesc','Dúvidas? Fale com o gestor.')} {ROLE_LABEL[role] || role}
          </div>
        </div>
      </div>
    </div>
  );
}
