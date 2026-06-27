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
  { id: 'street-view',      icone: '🌐',  roles: ['admin','gestor','supergestor','campo'] },
  { id: 'medir-lote',       icone: '📏',  roles: ['admin','gestor','supergestor','campo'] },
  { id: 'ferramentas',      icone: '🛠',  roles: ['admin','gestor','supergestor'] },
  { id: 'gestor-logistica',  icone: '👔',  roles: ['admin','gestor','gestor_log','supergestor'] },
  { id: 'gojet-dashboard',  icone: '📊',  roles: ['admin','gestor','gestor_log','supergestor'] },
];

export default function GuiaPanel({ role, onFechar }: Props) {
  const { t, i18n } = useTranslation();
  const [topicoAtivo, setTopicoAtivo] = useState<string | null>(null);
  const [passoAtivo,  setPassoAtivo]  = useState(0);

  const getTopico = (id: string) => {
    const guideTopics = (t('guide.topics', { returnObjects: true }) as any) || {};
    if (guideTopics[id]) return guideTopics[id];
    return { titulo: id, passos: [] };
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
                  .replace('{role}', (t(`guide.roleLabels.${role}`, role) as string))}
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
            {t('guide.footerDesc','Dúvidas? Fale com o gestor.')} {t(`guide.roleLabels.${role}`, role) as string}
          </div>
        </div>
      </div>
    </div>
  );
}
