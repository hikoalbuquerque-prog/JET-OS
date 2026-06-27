// AppShell.tsx — UI shell components extracted from App.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  collection, getDocs, addDoc, setDoc, doc,
  updateDoc, onSnapshot, deleteDoc, query, where
} from 'firebase/firestore';
import { Timestamp as FsTimestamp } from 'firebase/firestore';
import { sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { guardProviderSupabase, carregarOcorrenciasSupabase, guardWriteSupabase, atualizarOcorrenciaSupabase, deletarOcorrenciaSupabase } from '../lib/ocorrencias-supabase';
import { logisticaWriteSupabase, criarSolicitacaoSupabase } from '../lib/onda-b-supabase';
import L from 'leaflet';
import { uploadComRetry } from '../lib/uploadUtils';
import { comprimirImagem, capturarFotoNativa } from '../lib/imageUtils';
import { LangSelector } from './MapaHelpers';
import { isAndroidNative } from '../lib/gps-native';
import TelegramVinculo, { useTelegramVinculado } from '../TelegramVinculo';
import i18n from '../i18n/index';
import { sanitizarFotoUrl } from '../lib/app-utils';
import { capturarPosicaoUnica } from '../lib/gps-background';
import type { Usuario } from '../lib/app-utils';
import { CIDADES } from '../lib/app-utils';
import { createUserWithEmailAndPassword } from 'firebase/auth';

// Compressão HEIC-safe (ver lib/imageUtils). Converte HEIC→JPEG antes de comprimir,
// evitando o bug de foto "quebrada" (HEIC enviado como .jpg que o WebView não renderiza).
async function comprimir(file: File, maxW = 1280, q = 0.82): Promise<File> {
  try {
    return await comprimirImagem(file, maxW, q);
  } catch (e) {
    console.warn('[comprimir] falha ao processar imagem, enviando original', e);
    return file;
  }
}

export function TelaSolicitacao({ onVoltar }: { onVoltar: () => void }) {
  const [nome,   setNome]   = useState('');
  const [email,  setEmail]  = useState('');
  const [senha,  setSenha]  = useState('');
  const [paises, setPaises] = useState<string[]>(['BR']);
  const [cidade, setCidade] = useState('');
  const [roleDesejado, setRoleDesejado] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok,   setOk]   = useState(false);
  const [erro, setErro] = useState('');
  const [cidadesDisponiveis, setCidadesDisponiveis] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'estacoes'));
        const set = new Set<string>();
        snap.docs.forEach(d => {
          const c = d.data().cidade;
          if (c && typeof c === 'string') set.add(c.trim());
        });
        const lista = Array.from(set).sort();
        setCidadesDisponiveis(lista.length > 0 ? lista : CIDADES['BR']);
      } catch {
        setCidadesDisponiveis(CIDADES['BR']);
      }
    })();
  }, []);

  // Campos prestador
  const [cpfCnpj,       setCpfCnpj]       = useState('');
  const [chavePix,      setChavePix]      = useState('');
  const [tipoChavePix,  setTipoChavePix]  = useState('CPF');
  const [dataNasc,      setDataNasc]      = useState('');
  const [tipoContrato,  setTipoContrato]  = useState('');
  const [telegramNum,   setTelegramNum]   = useState('');
  const [motivo,        setMotivo]        = useState('');

  const { t } = useTranslation();

  const ROLES_INTERNOS = [
    { k:'campo',  l:t('appShell.roleCampo'),  d:t('appShell.roleCampoDesc'), cor:'#3b82f6' },
    { k:'guard',  l:t('appShell.roleGuard'),  d:t('appShell.roleGuardDesc'),                 cor:'#a78bfa' },
    { k:'gestor', l:t('appShell.roleGestor'), d:t('appShell.roleGestorDesc'),       cor:'#fbbf24' },
    { k:'viewer', l:t('appShell.roleViewer'), d:t('appShell.roleViewerDesc'),              cor:'#6b7280' },
  ];

  const ROLES_PRESTADOR = [
    { k:'logistica',  l:t('appShell.roleLogistica'), d:t('appShell.roleLogisticaDesc'), cor:'#10b981' },
    { k:'promotor',   l:t('appShell.rolePromotor'),  d:t('appShell.rolePromotorDesc'),                  cor:'#f59e0b' },
    { k:'fiscal',     l:t('appShell.roleFiscal'),     d:t('appShell.roleFiscalDesc'),         cor:'#f97316' },
    { k:'seguranca',  l:t('appShell.roleSeguranca'), d:t('appShell.roleSegurancaDesc'),                    cor:'#ef4444' },
  ];

  const CONTRATOS_MEI  = ['MEI - JET','MEI - TopDoer','MEI - Outro'];
  const CONTRATOS_CLT  = ['CLT'];
  const CONTRATOS_ALL  = roleDesejado === 'seguranca' ? CONTRATOS_CLT : [...CONTRATOS_MEI, ...CONTRATOS_CLT];

  const isPrestador = ROLES_PRESTADOR.some(r => r.k === roleDesejado);
  const isCLT       = tipoContrato === 'CLT';

  const togglePais = (p: string) =>
    setPaises(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box' as const,
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    color: '#fff', fontSize: 13, outline: 'none',
  };
  const lbl: React.CSSProperties = {
    display: 'block', color: 'rgba(255,255,255,.45)', fontSize: 10,
    fontWeight: 600, marginBottom: 5, letterSpacing: '.05em',
  };
  const sec: React.CSSProperties = {
    padding: '12px 14px', borderRadius: 10,
    background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
  };

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!roleDesejado)   { setErro(t('appShell.errSelectRole')); return; }
    if (!paises.length)  { setErro(t('appShell.errSelectCountry')); return; }
    if (!nome.trim())    { setErro(t('appShell.errName')); return; }
    if (!email.trim())   { setErro(t('appShell.errEmail')); return; }
    if (!senha.trim())   { setErro(t('appShell.errPassword')); return; }
    if (isPrestador && !cidade.trim()) { setErro(t('appShell.errCity')); return; }
    if (isPrestador && !cpfCnpj.trim()) { setErro(t('appShell.errCpfCnpj')); return; }
    if (isPrestador && !tipoContrato)   { setErro(t('appShell.errContract')); return; }
    if (isPrestador && !telegramNum.trim()) { setErro(t('appShell.errTelegram')); return; }
    if (isPrestador && !isCLT && !chavePix.trim()) { setErro(t('appShell.errPix')); return; }
    
    setBusy(true);
    setErro('');
    
    try {
      // 1. Criar usuário em Auth
      const userCred = await createUserWithEmailAndPassword(auth, email, senha);
      const uid = userCred.user.uid;

      // 2. Criar documento em usuarios
      await setDoc(doc(db, 'usuarios', uid), {
        uid,
        email,
        nome,
        role: isPrestador ? 'prestador_pendente' : roleDesejado,
        paises,
        pais: paises[0] || 'BR',
        tipoCadastro: isPrestador ? 'prestador' : 'interno',
        cargoPrestador: isPrestador ? roleDesejado : null,
        statusPrestador: isPrestador ? 'pendente_aprovacao' : null,
        ...(isPrestador ? {
          cpf_cnpj: cpfCnpj.trim(),
          pix_chave: chavePix.trim(),
          pix_tipo: tipoChavePix,
          tipo_contrato: tipoContrato,
          cidade: cidade,
        } : {}),
        data_criacao: new Date()
      });

      // 3. SE É PRESTADOR - SALVAR SOLICITAÇÃO
      if (isPrestador) {
        const novaSolic = {
          uid,
          email,
          nome,
          cargo: roleDesejado,
          cpf_cnpj: cpfCnpj.trim(),
          pix_chave: chavePix.trim(),
          pix_tipo: tipoChavePix,
          cidade,
          tipo_contrato: tipoContrato,
          telegram: telegramNum.trim(),
          motivo_cadastro: motivo.trim() || '',
          status: 'pendente',
          data_criacao: new Date(),
          pais: paises[0] || 'BR'
        };
        const solRef = await addDoc(collection(db, 'solicitacoes_prestadores'), novaSolic);
        if (logisticaWriteSupabase()) {
          criarSolicitacaoSupabase(solRef.id, novaSolic).catch(err => console.error('[log-write] solicitacao Supabase:', err));
        }
      }

      setOk(true);
    } catch(err: unknown) {
      console.error('Erro ao enviar:', err);
      setErro(err instanceof Error ? err.message : t('appShell.errGeneric'));
    }
    setBusy(false);
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg,#0d1220,#0f1928)',
      fontFamily: 'Inter,sans-serif',
      minHeight: '100vh',
      maxHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch' as any,
      position: 'relative'
    }}>
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
        <LangSelector />
      </div>
      <div style={{ width: '100%', maxWidth: 420, paddingBottom: 40, marginLeft: 'auto', marginRight: 'auto', paddingLeft: 20, paddingRight: 20, paddingTop: 20 }}>
        <button onClick={onVoltar} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
          fontSize: 13, cursor: 'pointer', marginBottom: 24, padding: 0
        }}>{t('appShell.backToLogin')}</button>

        {ok ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#6ee7b7', marginBottom: 8 }}>
              {isPrestador ? t('appShell.registrationSent') : t('appShell.requestSent')}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginBottom: 8, lineHeight: 1.6 }}>
              {isPrestador
                ? t('appShell.awaitApprovalProvider')
                : t('appShell.awaitApprovalInternal')}
            </div>
            <button onClick={onVoltar} style={{
              padding: '12px 24px', marginTop: 16,
              background: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
              border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, cursor: 'pointer'
            }}>{t('appShell.backToLogin')}</button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
                {t('appShell.requestAccess')}
              </h2>
              <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13 }}>
                {t('appShell.selectRoleHint')}
              </p>
            </div>

            <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* ── CARGO ── */}
              <div style={sec}>
                <label style={lbl}>{t('appShell.selectRole')}</label>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 6, fontWeight: 600 }}>
                    {t('appShell.operationalTeam')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                    {ROLES_INTERNOS.map(r => (
                      <button key={r.k} type="button" onClick={() => setRoleDesejado(r.k)}
                        style={{ padding: '8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                          background: roleDesejado===r.k ? r.cor+'22' : 'rgba(255,255,255,.04)',
                          border: `1px solid ${roleDesejado===r.k ? r.cor+'55' : 'rgba(255,255,255,.08)'}`,
                          color: roleDesejado===r.k ? r.cor : 'rgba(255,255,255,.4)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700 }}>{r.l}</div>
                        <div style={{ fontSize: 9, marginTop: 2, lineHeight: 1.3, opacity: .8 }}>{r.d}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.3)', marginBottom: 6, fontWeight: 600 }}>
                    {t('appShell.serviceProvider')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                    {ROLES_PRESTADOR.map(r => (
                      <button key={r.k} type="button" onClick={() => setRoleDesejado(r.k)}
                        style={{ padding: '8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                          background: roleDesejado===r.k ? r.cor+'22' : 'rgba(255,255,255,.04)',
                          border: `1px solid ${roleDesejado===r.k ? r.cor+'55' : 'rgba(255,255,255,.08)'}`,
                          color: roleDesejado===r.k ? r.cor : 'rgba(255,255,255,.4)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700 }}>{r.l}</div>
                        <div style={{ fontSize: 9, marginTop: 2, lineHeight: 1.3, opacity: .8 }}>{r.d}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── DADOS BASE (todos) ── */}
              {roleDesejado && (
                <div style={sec}>
                  <label style={lbl}>{t('appShell.basicInfo')}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={lbl}>{t('appShell.fullName')}</label>
                      <input value={nome} onChange={e=>setNome(e.target.value)} required style={inp} placeholder={t('appShell.fullNamePlaceholder')}/>
                    </div>
                    <div>
                      <label style={lbl}>{t('appShell.email')}</label>
                      <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required style={inp} placeholder="seu@email.com"/>
                    </div>
                    <div>
                      <label style={lbl}>{t('appShell.password')}</label>
                      <input type="password" value={senha} onChange={e=>setSenha(e.target.value)} required style={inp} placeholder={t('appShell.passwordPlaceholder')}/>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
                        {t('appShell.passwordHint')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── DADOS PRESTADOR ── */}
              {isPrestador && (
                <div style={sec}>
                  <label style={lbl}>{t('appShell.providerInfo')}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                    {/* Cidade */}
                    <div>
                      <label style={lbl}>{t('appShell.city')}</label>
                      <select value={cidade} onChange={e=>setCidade(e.target.value)} required
                        style={{ ...inp, cursor: 'pointer', appearance: 'none' as any }}>
                        <option value="">{t('appShell.cityPlaceholder')}</option>
                        {cidadesDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {cidadesDisponiveis.length === 0 && (
                        <div style={{ fontSize: 10, color: '#4a5a7a', marginTop: 4 }}>{t('appShell.loadingCities')}</div>
                      )}
                    </div>

                    {/* Tipo contrato */}
                    <div>
                      <label style={lbl}>{t('appShell.contractType')}</label>
                      <select value={tipoContrato} onChange={e=>setTipoContrato(e.target.value)} required
                        style={{ ...inp, cursor: 'pointer' }}>
                        <option value="">{t('appShell.selectPlaceholder')}</option>
                        {CONTRATOS_ALL.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    {/* CPF/CNPJ + Data nasc */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={lbl}>{t('appShell.cpfCnpj')}</label>
                        <input value={cpfCnpj} onChange={e=>setCpfCnpj(e.target.value)} required style={inp} placeholder="000.000.000-00"/>
                      </div>
                      <div>
                        <label style={lbl}>{t('appShell.birthDate')}</label>
                        <input type="date" value={dataNasc} onChange={e=>setDataNasc(e.target.value)} required style={{ ...inp, colorScheme: 'dark' as any }}/>
                      </div>
                    </div>

                    {/* Pix — só para MEI */}
                    {!isCLT && (
                      <div>
                        <label style={lbl}>{t('appShell.pixKey')}</label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select value={tipoChavePix} onChange={e=>setTipoChavePix(e.target.value)}
                            style={{ ...inp, width: 'auto', cursor: 'pointer', paddingRight: 8 }}>
                            {['CPF','CNPJ','E-mail','Telefone','Aleatória'].map(t => <option key={t}>{t}</option>)}
                          </select>
                          <input value={chavePix} onChange={e=>setChavePix(e.target.value)}
                            style={{ ...inp, flex: 1 }} placeholder={t('appShell.pixKeyPlaceholder')}/>
                        </div>
                      </div>
                    )}

                    {/* Telegram */}
                    <div>
                      <label style={lbl}>{t('appShell.telegramNumber')}</label>
                      <input value={telegramNum} onChange={e=>setTelegramNum(e.target.value)} required
                        style={inp} placeholder="+55 81 99999-9999"/>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 4 }}>
                        {t('appShell.telegramHint')}
                      </div>
                    </div>

                    {/* CLT — aviso período de experiência */}
                    {isCLT && (
                      <div style={{ padding: '8px 12px', borderRadius: 8,
                        background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.15)' }}>
                        <div style={{ fontSize: 10, color: '#f87171', fontWeight: 600, marginBottom: 3 }}>
                          {t('appShell.cltContract')}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', lineHeight: 1.5 }}>
                          {t('appShell.cltHint')}
                        </div>
                      </div>
                    )}

                    <div>
                      <label style={lbl}>{t('appShell.observation')}</label>
                      <textarea value={motivo} onChange={e=>setMotivo(e.target.value)} rows={2}
                        style={{ ...inp, resize: 'none' as const }}
                        placeholder={t('appShell.observationPlaceholder')}/>
                    </div>
                  </div>
                </div>
              )}

              {/* ── DADOS INTERNO (não prestador) ── */}
              {roleDesejado && !isPrestador && (
                <div style={sec}>
                  <label style={lbl}>{t('appShell.additionalInfo')}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={lbl}>{t('appShell.operatingCountries')}</label>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                        {['BR','MX','AR','CO','CL','PE'].map(p => (
                          <button key={p} type="button" onClick={() => togglePais(p)} style={{
                            padding: '5px 11px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                            background: paises.includes(p) ? 'rgba(48,127,226,.2)' : 'rgba(255,255,255,.05)',
                            border: `1px solid ${paises.includes(p) ? 'rgba(48,127,226,.4)' : 'rgba(255,255,255,.1)'}`,
                            color: paises.includes(p) ? '#60a5fa' : 'rgba(255,255,255,.4)'
                          }}>{p}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={lbl}>{t('appShell.companyReason')}</label>
                      <textarea value={motivo} onChange={e=>setMotivo(e.target.value)} rows={2}
                        style={{ ...inp, resize: 'none' as const }}
                        placeholder={t('appShell.companyReasonPlaceholder')}/>
                    </div>
                  </div>
                </div>
              )}

              {erro && (
                <div style={{ padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
                  color: '#f87171', fontSize: 12 }}>{erro}</div>
              )}

              {roleDesejado && (
                <button type="submit" disabled={busy} style={{
                  padding: 13,
                  background: busy ? 'rgba(48,127,226,.4)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
                  border: 'none', borderRadius: 10, color: '#fff',
                  fontSize: 14, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
                }}>{busy ? t('appShell.sending') : isPrestador ? t('appShell.submitProvider') : t('appShell.submitRequest')}</button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ── APK DOWNLOAD BANNER ─────────────────────────────────────────
const APK_META_URL = 'https://ducdbrupxpzqcblfreqn.supabase.co/storage/v1/object/public/apk/version.json';
const APK_URL = 'https://ducdbrupxpzqcblfreqn.supabase.co/storage/v1/object/public/apk/jet-os-latest.apk';

function ApkBanner() {
  const [show, setShow] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const lang = (i18n.language?.slice(0,2) || 'pt') as 'pt'|'en'|'es'|'ru';
  const pick = (o: {pt:string;en:string;es:string;ru:string}) => o[lang] ?? o.pt;

  useEffect(() => {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isCapacitor = !!(window as any).Capacitor;
    if (!isAndroid || isCapacitor) return;

    fetch(APK_META_URL).then(r => r.ok ? r.json() : null).then(meta => {
      if (!meta?.version) { setShow(true); return; }
      setLatestVersion(meta.version);
      const dismissedVersion = localStorage.getItem('jet_apk_banner_dismissed_v');
      if (dismissedVersion === meta.version) return;
      setShow(true);
      if (dismissedVersion) setUpdateAvailable(true);
    }).catch(() => setShow(true));
  }, []);

  if (!show) return null;

  return (
    <div style={{
      background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.3)',
      borderRadius: 12, padding: '12px 14px', marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 10, position: 'relative',
    }}>
      <span style={{ fontSize: 28, lineHeight: 1 }}>📱</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', marginBottom: 2 }}>
          {updateAvailable
            ? pick({ pt:'Nova versão disponível!', en:'New version available!', es:'Nueva versión disponible!', ru:'Доступна новая версия!' })
            : pick({ pt:'Instale o app para GPS em background', en:'Install the app for background GPS', es:'Instala la app para GPS en segundo plano', ru:'Установите приложение для GPS в фоне' })}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>
          {updateAvailable
            ? pick({ pt:`Versão ${latestVersion} — toque para atualizar`, en:`Version ${latestVersion} — tap to update`, es:`Versión ${latestVersion} — toca para actualizar`, ru:`Версия ${latestVersion} — нажмите для обновления` })
            : pick({ pt:'Melhor experiência + rastreamento contínuo', en:'Better experience + continuous tracking', es:'Mejor experiencia + rastreo continuo', ru:'Лучший опыт + непрерывное отслеживание' })}
        </div>
        <a href={APK_URL} download style={{
          display: 'inline-block', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
          background: 'linear-gradient(135deg,#6366f1,#818cf8)', color: '#fff', textDecoration: 'none',
        }}>
          {pick({ pt:'Baixar APK', en:'Download APK', es:'Descargar APK', ru:'Скачать APK' })}
        </a>
      </div>
      <button onClick={() => { setShow(false); if (latestVersion) localStorage.setItem('jet_apk_banner_dismissed_v', latestVersion); }}
        style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none',
          color: 'rgba(255,255,255,.3)', fontSize: 16, cursor: 'pointer', padding: 2, lineHeight: 1 }}>
        ✕
      </button>
    </div>
  );
}

// ── LOGIN ────────────────────────────────────────────────────────
export function TelaLogin({ onLogin }: { onLogin: (e: string, s: string) => Promise<string | null> }) {
  const [email,       setEmail]       = useState('');
  const [senha,       setSenha]       = useState('');
  const [erro,        setErro]        = useState('');
  const [busy,        setBusy]        = useState(false);
  const [resetEmail,  setResetEmail]  = useState('');
  const [resetMode,   setResetMode]   = useState(false);
  const [resetOk,     setResetOk]     = useState(false);
  const [solicitando, setSolicitando] = useState(false);
  const [verSenha,    setVerSenha]    = useState(false);
  const [senhaFocada, setSenhaFocada] = useState(false);

  const { t } = useTranslation();

  const requisitos = [
    { label: t('appShell.reqMinChars'), ok: senha.length >= 8 },
    { label: t('appShell.reqUppercase'),  ok: /[A-Z]/.test(senha) },
    { label: t('appShell.reqNumber'),            ok: /[0-9]/.test(senha) },
  ];
  const senhaValida = requisitos.every(r => r.ok);

  const inp: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(''); setBusy(true);
    const err = await onLogin(email, senha);
    if (err) { setErro(err); setBusy(false); }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setResetOk(true);
    } catch {
      setErro(t('appShell.emailNotFound'));
    }
    setBusy(false);
  };

  if (solicitando) return <TelaSolicitacao onVoltar={() => setSolicitando(false)} />;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0d1220,#0f1928)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,sans-serif',
      position: 'relative' }}>
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
        <LangSelector />
      </div>
      <div style={{ width: 360, padding: '0 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, margin: '0 auto 16px',
            background: 'linear-gradient(135deg,#1a6fd4,#307FE2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>Jet OS</h1>
        </div>

        <ApkBanner />

        {resetMode ? (
          // Modo recuperar senha
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
              {t('appShell.recoverPassword')}
            </div>
            {resetOk ? (
              <div style={{ padding: '12px 14px', borderRadius: 8, marginBottom: 16,
                background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.2)',
                color: '#6ee7b7', fontSize: 13 }}>
                {t('appShell.emailSent')}
              </div>
            ) : (
              <form onSubmit={handleReset}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 12, marginBottom: 6 }}>
                    {t('appShell.yourEmail')}
                  </label>
                  <input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                    required style={inp} placeholder="seu@email.com" />
                </div>
                {erro && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
                  color: '#f87171', fontSize: 13 }}>{erro}</div>}
                <button type="submit" disabled={busy} style={{
                  width: '100%', padding: 13,
                  background: busy ? 'rgba(48,127,226,.4)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
                  border: 'none', borderRadius: 10, color: '#fff',
                  fontSize: 14, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
                }}>{busy ? t('appShell.sending') : t('appShell.sendLink')}</button>
              </form>
            )}
            <button onClick={() => { setResetMode(false); setErro(''); setResetOk(false); }} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
              fontSize: 13, cursor: 'pointer', marginTop: 16, padding: 0
            }}>{t('appShell.backToLogin')}</button>
          </div>
        ) : (
          // Modo login normal
          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 12, marginBottom: 6 }}>{t('appShell.email')}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inp} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <label style={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>{t('appShell.passwordLabel')}</label>
                <button type="button" onClick={() => setResetMode(true)} style={{
                  background: 'none', border: 'none', color: 'rgba(255,255,255,.35)',
                  fontSize: 11, cursor: 'pointer', padding: 0
                }}>{t('appShell.forgotPassword')}</button>
              </div>
              <div style={{ position:'relative' }}>
                <input
                  type={verSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  onFocus={() => setSenhaFocada(true)}
                  onBlur={() => setSenhaFocada(false)}
                  required
                  style={{ ...inp, paddingRight: 44 }}
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setVerSenha(v => !v)}
                  style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', padding:4,
                    color:'rgba(255,255,255,.4)', fontSize:16, lineHeight:1 }}>
                  {verSenha ? '🙈' : '👁'}
                </button>
              </div>
              {/* Requisitos de senha — aparecem ao focar */}
              {senhaFocada && senha.length > 0 && (
                <div style={{ marginTop:8, padding:'8px 12px', borderRadius:8,
                  background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.06)' }}>
                  {requisitos.map(r => (
                    <div key={r.label} style={{ display:'flex', alignItems:'center', gap:6,
                      fontSize:11, color: r.ok ? '#4ade80' : 'rgba(255,255,255,.35)',
                      marginBottom:2 }}>
                      <span>{r.ok ? '✓' : '○'}</span>
                      <span>{r.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {erro && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14,
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
              color: '#f87171', fontSize: 13 }}>{erro}</div>}
            <button type="submit" disabled={busy} style={{
              width: '100%', padding: 14,
              background: busy ? 'rgba(48,127,226,.4)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
              border: 'none', borderRadius: 10, color: '#fff',
              fontSize: 15, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer'
            }}>{busy ? t('appShell.loggingIn') : t('appShell.login')}</button>

            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button type="button" onClick={() => setSolicitando(true)} style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,.35)',
                fontSize: 13, cursor: 'pointer'
              }}>{t('appShell.noAccess')}</button>
            </div>
          </form>
        )}

        {/* APK download link — always visible */}
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <a href={APK_URL} download style={{
            color: 'rgba(255,255,255,.25)', fontSize: 11, textDecoration: 'none',
          }}>
            {(() => {
              const l = (i18n.language?.slice(0,2) || 'pt') as 'pt'|'en'|'es'|'ru';
              return ({ pt:'📲 Baixar app Android', en:'📲 Download Android app', es:'📲 Descargar app Android', ru:'📲 Скачать Android приложение' })[l] ?? '📲 Baixar app Android';
            })()}
          </a>
        </div>
      </div>
    </div>
  );
}

// ── TOAST ────────────────────────────────────────────────────────
// ── Skeleton loading ───────────────────────────────────────────────
export function Skeleton({ w = '100%', h = 14, r = 6, mb = 8 }: { w?: string|number; h?: number; r?: number; mb?: number }) {
  return (
    <div style={{ width: w, height: h, borderRadius: r, marginBottom: mb,
      background: 'linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.05) 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,.06)' }}>
      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
        <Skeleton w={8} h={8} r={50} mb={0} />
        <div style={{ flex:1 }}>
          <Skeleton w="60%" h={11} r={4} mb={5} />
          <Skeleton w="40%" h={9} r={4} mb={0} />
        </div>
        <Skeleton w={32} h={18} r={8} mb={0} />
      </div>
    </div>
  );
}


export function Toast({ msg, tipo, acao }: { msg: string; tipo: string; acao?: { label:string; fn:()=>void } }) {
  const META: Record<string, { bg:string; border:string; text:string; icon:string }> = {
    success: { bg:'rgba(16,185,129,.18)', border:'rgba(16,185,129,.4)', text:'#6ee7b7', icon:'✓' },
    error:   { bg:'rgba(239,68,68,.18)',  border:'rgba(239,68,68,.4)',  text:'#f87171', icon:'✕' },
    warn:    { bg:'rgba(245,158,11,.18)', border:'rgba(245,158,11,.4)', text:'#fbbf24', icon:'⚠' },
    info:    { bg:'rgba(48,127,226,.18)', border:'rgba(48,127,226,.4)', text:'#60a5fa', icon:'ℹ' },
  };
  const c = META[tipo] || META.info;
  return (
    <div style={{
      position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
      display:'flex', alignItems:'center', gap:10,
      padding:'11px 16px', background:c.bg,
      border:`1px solid ${c.border}`, borderRadius:12,
      backdropFilter:'blur(16px)', zIndex:9000,
      maxWidth:'min(92vw,420px)', boxShadow:'0 4px 24px rgba(0,0,0,.5)',
      animation:'toast-in .2s ease',
    }}>
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
      <span style={{ fontSize:16, lineHeight:1 }}>{c.icon}</span>
      <span style={{ color:c.text, fontSize:13, fontWeight:500, flex:1 }}>{msg}</span>
      {acao && (
        <button onClick={acao.fn} style={{
          background:'rgba(255,255,255,.12)', border:'none', borderRadius:7,
          color:c.text, fontSize:11, fontWeight:700, padding:'4px 10px', cursor:'pointer',
          whiteSpace:'nowrap' as const,
        }}>{acao.label}</button>
      )}
    </div>
  );
}

// ── MAPA ─────────────────────────────────────────────────────────

// ── DocPublicoModal ───────────────────────────────────────────────
export function DocPublicoModal({ estacaoId, cidade, docAtual, onFechar, onSalvo }: {
  estacaoId: string; cidade: string; docAtual: any;
  onFechar: () => void; onSalvo: () => void;
}) {
  const { t } = useTranslation();
  const [tpuUrl,  setTpuUrl]  = useState(docAtual.tpu        || '');
  const [autUrl,  setAutUrl]  = useState(docAtual.autorizacao || '');
  const [obs,     setObs]     = useState(docAtual.obs         || '');
  const [tpuFile, setTpuFile] = useState<File|null>(null);
  const [autFile, setAutFile] = useState<File|null>(null);
  const [busy,    setBusy]    = useState(false);

  const inp: React.CSSProperties = {
    width:'100%', padding:'9px 11px', borderRadius:8, boxSizing:'border-box' as const,
    border:'1px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.05)',
    color:'#dce8ff', fontSize:12, outline:'none',
  };

  const uploadFile = async (file: File, path: string): Promise<string> => {
    return uploadComRetry(file, path);
  };

  const salvar = async () => {
    setBusy(true);
    try {
      let finalTpu = tpuUrl;
      let finalAut = autUrl;
      if (tpuFile) finalTpu = await uploadFile(tpuFile, `docPublico/${estacaoId}/tpu_${Date.now()}.${tpuFile.name.split('.').pop()}`);
      if (autFile) finalAut = await uploadFile(autFile, `docPublico/${estacaoId}/aut_${Date.now()}.${autFile.name.split('.').pop()}`);
      await updateDoc(doc(db, 'estacoes', estacaoId), {
        docPublico: { tpu: finalTpu, autorizacao: finalAut, obs, atualizadoEm: new Date().toISOString() }
      });
      onSalvo();
    } catch(e: any) { alert(t('appShell.errorSaving') + e.message); }
    setBusy(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1300, background:'rgba(0,0,0,.65)',
      backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onFechar()}>
      <div style={{ width:'100%', maxWidth:420, background:'#0d1521',
        border:'1px solid rgba(21,101,192,.3)', borderRadius:16, padding:20, fontFamily:'Inter,sans-serif' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'#60a5fa' }}>{t('appShell.docPublic')}</div>
            <div style={{ fontSize:10, color:'#4a5a7a', marginTop:2 }}>{cidade} · {estacaoId}</div>
          </div>
          <button onClick={onFechar} style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>
        {[
          { label:'🏛 TPU', url:tpuUrl, setUrl:setTpuUrl, file:tpuFile, setFile:setTpuFile, path:'tpu' },
          { label:'✅ Autorização', url:autUrl, setUrl:setAutUrl, file:autFile, setFile:setAutFile, path:'aut' },
        ].map(item => (
          <div key={item.label} style={{ marginBottom:14 }}>
            <label style={{ fontSize:11, color:'#93c5fd', display:'block', marginBottom:5, fontWeight:600 }}>{item.label}</label>
            {item.url && <a href={item.url} target="_blank" rel="noreferrer" style={{ display:'block', fontSize:11, color:'#60a5fa', marginBottom:6, textDecoration:'none' }}>{t('appShell.docCurrent')}</a>}
            <input type="text" value={item.url} onChange={e=>item.setUrl(e.target.value)} placeholder={t('appShell.docUrlPlaceholder')} style={inp} />
            <div style={{ marginTop:6 }}>
              <label style={{ fontSize:10, color:'#4a5a7a', cursor:'pointer', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', borderRadius:6, padding:'5px 10px', display:'inline-block' }}>
                {t('appShell.upload')}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display:'none' }} onChange={e=>item.setFile(e.target.files?.[0]||null)} />
              </label>
              {item.file && <span style={{ fontSize:10, color:'#4ade80', marginLeft:8 }}>✓ {item.file.name}</span>}
            </div>
          </div>
        ))}
        <div style={{ marginBottom:18 }}>
          <label style={{ fontSize:11, color:'#93c5fd', display:'block', marginBottom:5, fontWeight:600 }}>{t('appShell.observationLabel')}</label>
          <input type="text" value={obs} onChange={e=>setObs(e.target.value)} placeholder={t('appShell.observationDocPlaceholder')} style={inp} />
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onFechar} style={{ flex:1, padding:'10px', borderRadius:10, cursor:'pointer', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', color:'rgba(255,255,255,.5)', fontSize:12 }}>{t('appShell.cancel')}</button>
          <button onClick={salvar} disabled={busy} style={{ flex:2, padding:'10px', borderRadius:10, cursor:busy?'not-allowed':'pointer', background:busy?'rgba(21,101,192,.3)':'linear-gradient(135deg,#1565c0,#1976d2)', border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
            {busy?t('appShell.savingDocs'):t('appShell.saveDocs')}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── NovaOcorrenciaInline ──────────────────────────────────────────
export function NovaOcorrenciaInline({ usuario, onSucesso }: { usuario: Usuario; onSucesso: () => void }) {
  const [toast, setToast] = useState('');
  const showToastLocal = (msg: string) => { setToast(msg); setTimeout(()=>setToast(''), 3000); };
  return (
    <div style={{ position:'relative' }}>
      {toast && (
        <div style={{ position:'sticky', top:0, zIndex:10, margin:'8px 16px',
          background:'rgba(74,222,128,.15)', border:'1px solid rgba(74,222,128,.3)',
          borderRadius:8, padding:'8px 12px', color:'#4ade80', fontSize:12, textAlign:'center' }}>
          {toast}
        </div>
      )}
      <TelaGuardFormWrapper usuario={usuario} showToast={showToastLocal} onSucesso={onSucesso} />
    </div>
  );
}

export function TelaGuardFormWrapper({ usuario, showToast, onSucesso }: {
  usuario: Usuario; showToast: (msg:string)=>void; onSucesso: ()=>void;
}) {
  const { t } = useTranslation();
  const [Comp, setComp] = useState<React.ComponentType<any>|null>(null);
  useEffect(() => {
    import('../TelaGuard').then(m => setComp(() => m.FormNovaOcorrenciaExport||null));
  }, []);
  if (!Comp) return <div style={{ padding:32, textAlign:'center', color:'#4a5a7a' }}>{t('appShell.loading')}</div>;
  return <Comp usuario={usuario} showToast={showToast} onSucesso={onSucesso} />;
}


export function TelaTrocarSenha({ onConcluido, onLogout }: {
  onConcluido: () => void;
  onLogout: () => void;
}) {
  const [senhaAtual,  setSenhaAtual]  = useState('');
  const [novaSenha,   setNovaSenha]   = useState('');
  const [confirmar,   setConfirmar]   = useState('');
  const [busy,        setBusy]        = useState(false);
  const [erro,        setErro]        = useState('');
  const [verAtual,    setVerAtual]    = useState(false);
  const [verNova,     setVerNova]     = useState(false);
  const [verConf,     setVerConf]     = useState(false);

  const { t } = useTranslation();

  const requisitos = [
    { label: t('appShell.reqMinChars'),  ok: novaSenha.length >= 8 },
    { label: t('appShell.reqUppercase'),   ok: /[A-Z]/.test(novaSenha) },
    { label: t('appShell.reqNumber'),             ok: /[0-9]/.test(novaSenha) },
    { label: t('appShell.reqDifferent'),    ok: novaSenha !== senhaAtual && novaSenha.length > 0 },
    { label: t('appShell.reqMatch'),   ok: novaSenha === confirmar && confirmar.length > 0 },
  ];
  const senhaValida = requisitos.every(r => r.ok);

  const handleTrocar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senhaValida) { setErro(t('appShell.reqFixErrors')); return; }
    setBusy(true); setErro('');
    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error(t('appShell.invalidSession'));

      // Re-autenticar com senha atual antes de trocar
      const cred = EmailAuthProvider.credential(user.email, senhaAtual);
      await reauthenticateWithCredential(user, cred);

      // Trocar senha
      await updatePassword(user, novaSenha);

      // Remover flag senhaTemporaria do Firestore
      const { doc: fsDoc, updateDoc, collection: col } = await import('firebase/firestore');
      await updateDoc(fsDoc(col(db, 'usuarios'), user.uid), { senhaTemporaria: false });

      try {
        const { usuariosWriteSupabase, escreverUsuarioSupabase } = await import('../lib/usuarios-supabase');
        if (usuariosWriteSupabase()) {
          await escreverUsuarioSupabase(user.uid, { senhaTemporaria: false });
        }
      } catch (e) { console.warn('[supa] senhaTemporaria dual-write falhou', e); }

      onConcluido();
    } catch (err: any) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setErro(t('appShell.wrongPassword'));
      } else {
        setErro(err.message || t('appShell.errorChangingPassword'));
      }
    }
    setBusy(false);
  };

  const inp: React.CSSProperties = {
    flex: 1, padding: '11px 40px 11px 14px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 10, color: '#fff', fontSize: 13, outline: 'none', width: '100%',
    boxSizing: 'border-box' as const,
  };

  const CampoSenha = ({ label, value, onChange, ver, setVer, placeholder = '••••••••' }: {
    label: string; value: string; onChange: (v: string) => void;
    ver: boolean; setVer: (v: boolean) => void; placeholder?: string;
  }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', color: 'rgba(255,255,255,.5)', fontSize: 12, marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input type={ver ? 'text' : 'password'} value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder} style={inp} required />
        <button type="button" onClick={() => setVer(!ver)}
          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,.4)', fontSize: 16, padding: 4, lineHeight: 1 }}>
          {ver ? '🙈' : '👁'}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0d1220,#0f1928)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter,sans-serif', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, margin: '0 auto 14px',
            background: 'linear-gradient(135deg,#7c3aed,#a78bfa)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24 }}>🔐</div>
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 700, margin: 0 }}>
            {t('appShell.createPassword')}
          </h1>
          <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginTop: 6 }}>
            {t('appShell.firstAccessHint')}
          </p>
        </div>

        {/* Aviso sobre senha temporária */}
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 20,
          background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.2)' }}>
          <div style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.6 }}>
            {t('appShell.tempPasswordHint')}
          </div>
        </div>

        <form onSubmit={handleTrocar}>
          <CampoSenha label={t('appShell.currentPassword')} value={senhaAtual}
            onChange={setSenhaAtual} ver={verAtual} setVer={setVerAtual}
            placeholder={t('appShell.currentPasswordPlaceholder')} />

          <CampoSenha label={t('appShell.newPassword')} value={novaSenha}
            onChange={setNovaSenha} ver={verNova} setVer={setVerNova} />

          {/* Requisitos em tempo real */}
          {novaSenha.length > 0 && (
            <div style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 14,
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)' }}>
              {requisitos.map(r => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 7,
                  fontSize: 11, color: r.ok ? '#4ade80' : 'rgba(255,255,255,.3)',
                  marginBottom: 3, transition: 'color .2s' }}>
                  <span style={{ fontSize: 10 }}>{r.ok ? '✓' : '○'}</span>
                  {r.label}
                </div>
              ))}
            </div>
          )}

          <CampoSenha label={t('appShell.confirmPassword')} value={confirmar}
            onChange={setConfirmar} ver={verConf} setVer={setVerConf} />

          {erro && (
            <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14,
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)',
              color: '#f87171', fontSize: 13 }}>{erro}</div>
          )}

          <button type="submit" disabled={busy || !senhaValida}
            style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none',
              background: senhaValida && !busy
                ? 'linear-gradient(135deg,#7c3aed,#a78bfa)'
                : 'rgba(124,58,237,.25)',
              color: senhaValida ? '#fff' : 'rgba(255,255,255,.4)',
              fontSize: 15, fontWeight: 600,
              cursor: senhaValida && !busy ? 'pointer' : 'not-allowed',
              transition: 'all .2s' }}>
            {busy ? t('appShell.saving') : t('appShell.setMyPassword')}
          </button>
        </form>

        <button onClick={onLogout}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.25)',
            fontSize: 12, cursor: 'pointer', marginTop: 16, width: '100%', padding: 8 }}>
          {t('appShell.logoutAndBack')}
        </button>
      </div>
    </div>
  );
}


// ── SPLASH SCREEN ──────────────────────────────────────────────────
export function SplashScreen() {
  return (
    <div style={{ position:'fixed', inset:0, background:'linear-gradient(135deg,#060d1a,#0d1f35)',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      fontFamily:'Inter,sans-serif', zIndex:9999 }}>
      <style>{`
        @keyframes hexPulse { 0%,100%{opacity:.3;transform:scale(.95)} 50%{opacity:1;transform:scale(1.05)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes dotPulse { 0%,80%,100%{opacity:0} 40%{opacity:1} }
      `}</style>
      {/* Hexágono animado */}
      <div style={{ position:'relative', width:120, height:120, marginBottom:32 }}>
        <svg width="120" height="120" viewBox="0 0 120 120" style={{ animation:'hexPulse 2s ease-in-out infinite' }}>
          <polygon points="60,8 104,32 104,80 60,104 16,80 16,32"
            fill="none" stroke="url(#splashGrad)" strokeWidth="3"/>
          <defs>
            <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e7fd8"/>
              <stop offset="100%" stopColor="#0ab4f5"/>
            </linearGradient>
          </defs>
          <polygon points="60,20 94,38 94,76 60,94 26,76 26,38"
            fill="none" stroke="#1e7fd8" strokeWidth="1" opacity="0.3"/>
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center' }}>
          <div style={{ fontSize:28, fontWeight:900, color:'#fff', letterSpacing:-1, lineHeight:1 }}>JET</div>
          <div style={{ width:40, height:2, background:'linear-gradient(90deg,#1e7fd8,#0ab4f5)',
            borderRadius:1, margin:'4px 0' }} />
          <div style={{ fontSize:14, fontWeight:700, color:'#1e7fd8', letterSpacing:6 }}>OS</div>
        </div>
      </div>
      {/* Nome */}
      <div style={{ animation:'fadeUp .6s .3s both', textAlign:'center' }}>
        <div style={{ fontSize:11, color:'rgba(255,255,255,.3)', letterSpacing:4,
          textTransform:'uppercase', marginBottom:4 }}>Operational System</div>
      </div>
      {/* Loading dots */}
      <div style={{ display:'flex', gap:6, marginTop:32, animation:'fadeUp .6s .5s both' }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#1e7fd8',
            animation:`dotPulse 1.4s ${i*0.2}s ease-in-out infinite` }} />
        ))}
      </div>
    </div>
  );
}

// ── ONBOARDING WIZARD ───────────────────────────────────────────────
export function OnboardingWizard({ usuario, onConcluir }: { usuario: Usuario; onConcluir: () => void }) {
  const { t, i18n } = useTranslation();
  const [passo, setPasso] = useState(0);
  const [lang, setLang] = useState<'pt'|'en'|'es'|'ru'>((i18n.language?.slice(0,2) as any) || 'pt');

  const trocarIdioma = (c: 'pt'|'en'|'es'|'ru') => {
    i18n.changeLanguage(c);
    localStorage.setItem('appLang', c);
    setLang(c);
  };

  const PASSOS = [
    {
      icone: '🌍',
      titulo: { pt:'Escolha seu idioma', en:'Choose your language', es:'Elige tu idioma', ru:'Выберите язык' },
      desc:   { pt:'O JET OS está disponível em 4 idiomas. Você pode trocar a qualquer momento no botão de bandeira no header.', en:'JET OS is available in 4 languages. You can change it anytime using the flag button in the header.', es:'JET OS está disponible en 4 idiomas. Puedes cambiarlo en cualquier momento con el botón de bandera.', ru:'JET OS доступен на 4 языках. Вы можете изменить его в любое время с помощью кнопки флага в шапке.' },
      conteudo: () => (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {([['pt','🇧🇷 Português'],['en','🇺🇸 English'],['es','🇲🇽 Español'],['ru','🇷🇺 Русский']] as [string,string][]).map(([c,l]) => (
            <button key={c} onClick={() => trocarIdioma(c as any)}
              style={{ padding:'12px', borderRadius:10, cursor:'pointer', fontSize:13,
                background: lang===c ? 'rgba(26,111,212,.2)' : 'rgba(255,255,255,.05)',
                border:`1px solid ${lang===c ? 'rgba(26,111,212,.5)' : 'rgba(255,255,255,.1)'}`,
                color: lang===c ? '#60a5fa' : 'rgba(255,255,255,.6)',
                fontWeight: lang===c ? 700 : 400 }}>
              {l}
            </button>
          ))}
        </div>
      ),
    },
    {
      icone: '🗺',
      titulo: { pt:'Navegando no mapa', en:'Navigating the map', es:'Navegando el mapa', ru:'Навигация по карте' },
      desc:   { pt:'Selecione uma cidade no header para ver as estações. Use os filtros de TIPO e STATUS para refinar a visão. Clique em qualquer estação para ver detalhes.', en:'Select a city in the header to see stations. Use TYPE and STATUS filters to refine the view. Click any station for details.', es:'Selecciona una ciudad en el encabezado para ver las estaciones. Usa los filtros TIPO y ESTADO.', ru:'Выберите город в шапке для просмотра станций. Используйте фильтры ТИП и СТАТУС.' },
      conteudo: () => (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { ic:'➕', c:'#3b82f6', t:'Adicionar estação', d:'FAB azul → clique no mapa → preencha os dados' },
            { ic:'🔍', c:'#10b981', t:'POIs', d:'Pontos de interesse OSM e Google para escolher locais' },
            { ic:'🎯', c:'#f59e0b', t:'Candidatos', d:'Sugestões automáticas de melhores locais' },
            { ic:'🏭', c:'#8b5cf6', t:'Locais & Financeiro', d:'Bases de carga, contratos e pagamentos' },
          ].map(item => (
            <div key={item.t} style={{ display:'flex', gap:10, padding:'8px 10px', borderRadius:8,
              background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.06)' }}>
              <div style={{ width:32, height:32, borderRadius:8, background:item.c+'22',
                border:'1px solid '+item.c+'44', display:'flex', alignItems:'center',
                justifyContent:'center', fontSize:16, flexShrink:0 }}>{item.ic}</div>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'#dce8ff' }}>{item.t}</div>
                <div style={{ fontSize:10, color:'#4a5a7a' }}>{item.d}</div>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icone: '🛡',
      titulo: { pt:'Guard — segurança em campo', en:'Guard — field security', es:'Guard — seguridad en campo', ru:'Guard — безопасность в поле' },
      desc:   { pt:'O FAB roxo 🛡 abre o registro de ocorrências. Registre roubos, vandalismos e recuperações. O gestor recebe alertas automáticos no Telegram.', en:'The purple 🛡 FAB opens incident registration. Register thefts, vandalism and recoveries. Managers receive automatic Telegram alerts.', es:'El FAB morado 🛡 abre el registro de incidencias. El gestor recibe alertas automáticas en Telegram.', ru:'Фиолетовый FAB 🛡 открывает регистрацию инцидентов. Менеджер получает автоматические уведомления в Telegram.' },
      conteudo: () => (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {[
            { emoji:'🔴', t:'Roubo', c:'#ef4444', d:'Dispara alerta urgente no Telegram com destaque' },
            { emoji:'🟠', t:'Tentativa', c:'#f97316', d:'Registro de tentativa de furto' },
            { emoji:'🟡', t:'Vandalismo', c:'#eab308', d:'Danos ao patrimônio' },
            { emoji:'🟢', t:'Recuperação', c:'#22c55e', d:'Ativo recuperado com sucesso' },
          ].map(item => (
            <div key={item.t} style={{ display:'flex', gap:8, padding:'8px 10px', borderRadius:8,
              background:item.c+'10', border:'1px solid '+item.c+'25', alignItems:'center' }}>
              <span style={{ fontSize:20 }}>{item.emoji}</span>
              <div>
                <span style={{ fontSize:12, fontWeight:600, color:item.c }}>{item.t}</span>
                <span style={{ fontSize:10, color:'#4a5a7a', marginLeft:8 }}>{item.d}</span>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icone: '🔒',
      titulo: { pt:'Privacidade e seus dados', en:'Privacy and your data', es:'Privacidad y tus datos', ru:'Конфиденциальность и данные' },
      desc:   { pt:'No 1º acesso você aceita os Termos de Uso e a Política de Privacidade. Perfis de campo também consentem com o uso do GPS (LGPD).', en:'On first access you accept the Terms of Use and Privacy Policy. Field profiles also consent to GPS use (Brazilian LGPD).', es:'En el primer acceso aceptas los Términos de Uso y la Política de Privacidad. Los perfiles de campo también consienten el uso del GPS (LGPD).', ru:'При первом входе вы принимаете Условия использования и Политику конфиденциальности. Полевые профили также дают согласие на использование GPS (LGPD).' },
      conteudo: () => (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {[
            { ic:'📄', c:'#3b82f6', t:'Termos & Privacidade', d:'Aceite registrado com data/hora no 1º acesso' },
            { ic:'📍', c:'#10b981', t:'GPS só em serviço', d:'Coleta apenas durante turnos, slots e tarefas' },
            { ic:'🔐', c:'#8b5cf6', t:'Seus direitos', d:'Acesso, exclusão e revogação a qualquer momento' },
          ].map(item => (
            <div key={item.t} style={{ display:'flex', gap:10, padding:'8px 10px', borderRadius:8,
              background:item.c+'10', border:'1px solid '+item.c+'25' }}>
              <div style={{ width:32, height:32, borderRadius:8, background:item.c+'22',
                border:'1px solid '+item.c+'44', display:'flex', alignItems:'center',
                justifyContent:'center', fontSize:16, flexShrink:0 }}>{item.ic}</div>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'#dce8ff' }}>{item.t}</div>
                <div style={{ fontSize:10, color:'#4a5a7a' }}>{item.d}</div>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      icone: '✅',
      titulo: { pt:'Pronto para começar!', en:'Ready to start!', es:'¡Listo para empezar!', ru:'Готово к работе!' },
      desc:   { pt:`Bem-vindo ao JET OS, ${(usuario as any).nome || usuario.email}! Acesse o Guia (✦ Guia no header) a qualquer momento para instruções detalhadas sobre cada funcionalidade.`, en:`Welcome to JET OS, ${(usuario as any).nome || usuario.email}! Access the Guide (✦ Guide in the header) anytime for detailed instructions.`, es:`¡Bienvenido a JET OS, ${(usuario as any).nome || usuario.email}! Accede a la Guía en el encabezado en cualquier momento.`, ru:`Добро пожаловать в JET OS, ${(usuario as any).nome || usuario.email}! Откройте Руководство в шапке для подробных инструкций.` },
      conteudo: () => (
        <div style={{ textAlign:'center', padding:'16px 0' }}>
          <div style={{ fontSize:64, marginBottom:12 }}>🚀</div>
          <div style={{ fontSize:13, color:'rgba(255,255,255,.5)', lineHeight:1.6 }}>
            Versão {usuario.role === 'admin' ? 'Admin' : usuario.role === 'gestor' ? 'Gestor' : 'Campo'} ativa.<br/>
            Todas as funcionalidades estão disponíveis para o seu perfil.
          </div>
        </div>
      ),
    },
  ];

  const passoAtual = PASSOS[passo];

  return (
    <div style={{ position:'fixed', inset:0, zIndex:2000,
      background:'rgba(0,0,0,.75)', backdropFilter:'blur(6px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ width:'100%', maxWidth:480, background:'#0a0f1e',
        border:'1px solid rgba(99,102,241,.2)', borderRadius:20,
        fontFamily:'Inter,sans-serif', overflow:'hidden' }}>
        {/* Progress bar */}
        <div style={{ height:3, background:'rgba(255,255,255,.06)' }}>
          <div style={{ height:'100%', background:'linear-gradient(90deg,#1e7fd8,#0ab4f5)',
            width:`${((passo+1)/PASSOS.length)*100}%`, transition:'width .3s' }} />
        </div>
        {/* Header */}
        <div style={{ padding:'20px 24px 0', display:'flex', justifyContent:'space-between',
          alignItems:'center' }}>
          <div style={{ fontSize:10, color:'#4a5a7a', fontWeight:600, letterSpacing:'.08em' }}>
            {passo+1} / {PASSOS.length}
          </div>
          <button onClick={onConcluir}
            style={{ background:'none', border:'none', color:'rgba(255,255,255,.3)',
              cursor:'pointer', fontSize:12 }}>
            Pular
          </button>
        </div>
        {/* Conteúdo */}
        <div style={{ padding:'16px 24px 24px' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>{passoAtual.icone}</div>
          <h2 style={{ color:'#dce8ff', fontSize:18, fontWeight:800, marginBottom:8 }}>
            {passoAtual.titulo[lang] || passoAtual.titulo.pt}
          </h2>
          <p style={{ color:'rgba(255,255,255,.45)', fontSize:12, lineHeight:1.7, marginBottom:20 }}>
            {passoAtual.desc[lang] || passoAtual.desc.pt}
          </p>
          {passoAtual.conteudo()}
        </div>
        {/* Navegação */}
        <div style={{ padding:'12px 24px 20px', display:'flex', gap:8,
          borderTop:'1px solid rgba(255,255,255,.06)' }}>
          {passo > 0 && (
            <button onClick={() => setPasso(p => p-1)}
              style={{ flex:1, padding:'11px', borderRadius:12, cursor:'pointer',
                background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                color:'rgba(255,255,255,.5)', fontSize:12 }}>
              ← Anterior
            </button>
          )}
          {passo < PASSOS.length - 1 ? (
            <button onClick={() => setPasso(p => p+1)}
              style={{ flex:2, padding:'11px', borderRadius:12, cursor:'pointer',
                background:'linear-gradient(135deg,#1a6fd4,#0ab4f5)',
                border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
              Próximo →
            </button>
          ) : (
            <button onClick={onConcluir}
              style={{ flex:2, padding:'11px', borderRadius:12, cursor:'pointer',
                background:'linear-gradient(135deg,#10b981,#059669)',
                border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
              ✓ Começar a usar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CENTRAL DE NOTIFICAÇÕES ────────────────────────────────────────
export function CentralNotificacoes({ notifs, onFechar }: {
  notifs: Array<{id:string;msg:string;tipo:string;ts:number;lida?:boolean}>;
  onFechar: () => void;
}) {
  const fmtTs = (ts: number) => {
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000)   return 'agora';
    if (diff < 3600000) return Math.floor(diff/60000) + 'min';
    if (diff < 86400000)return Math.floor(diff/3600000) + 'h';
    return d.toLocaleDateString('pt-BR');
  };
  const corTipo: Record<string,string> = {
    roubo:'#ef4444', guard:'#a78bfa', sistema:'#60a5fa', info:'#6b7280'
  };
  return (
    <div style={{ position:'fixed', top:48, right:12, zIndex:1500, width:300,
      maxHeight:'70vh', background:'#0a0f1e', borderRadius:14,
      border:'1px solid rgba(255,255,255,.1)', boxShadow:'0 8px 32px rgba(0,0,0,.7)',
      display:'flex', flexDirection:'column', fontFamily:'Inter,sans-serif',
      overflow:'hidden' }}>
      <div style={{ padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,.07)',
        display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#dce8ff' }}>🔔 Notificações</div>
        <button onClick={onFechar}
          style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)',
            cursor:'pointer', fontSize:18 }}>✕</button>
      </div>
      <div style={{ overflowY:'auto', flex:1, scrollbarWidth:'thin' as const }}>
        {notifs.length === 0 ? (
          <div style={{ padding:24, textAlign:'center', color:'#4a5a7a', fontSize:12 }}>
            Nenhuma notificação
          </div>
        ) : notifs.map(n => (
          <div key={n.id} style={{ padding:'10px 14px',
            borderBottom:'1px solid rgba(255,255,255,.04)',
            background: n.lida ? 'transparent' : 'rgba(26,111,212,.06)',
            borderLeft:`3px solid ${corTipo[n.tipo]||'#4a5a7a'}` }}>
            <div style={{ fontSize:11, color:'#dce8ff', lineHeight:1.5 }}>{n.msg}</div>
            <div style={{ fontSize:9, color:'#4a5a7a', marginTop:3 }}>{fmtTs(n.ts)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TelaPrestadorPendente({ usuario, onLogout }: { usuario: Usuario; onLogout: () => void }) {
  const { vinculado } = useTelegramVinculado(usuario.uid);
  return (
    <div style={{ minHeight:'100dvh', background:'#0d121e', display:'flex', alignItems:'center',
      justifyContent:'center', fontFamily:'Inter,sans-serif', padding:24 }}>
      <div style={{ maxWidth:380, width:'100%', textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⏳</div>
        <div style={{ fontSize:20, fontWeight:700, color:'#dce8ff', marginBottom:8 }}>
          Cadastro em análise
        </div>
        <div style={{ fontSize:14, color:'#4a5a7a', lineHeight:1.6, marginBottom:24 }}>
          Seu cadastro como prestador de serviço foi recebido e está sendo analisado pela equipe JET.
          Você receberá um contato em breve para confirmar seu acesso.
        </div>
        <div style={{ background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)',
          borderRadius:10, padding:'12px 16px', marginBottom:24, textAlign:'left' }}>
          <div style={{ fontSize:11, color:'#4a5a7a', marginBottom:4 }}>Cadastrado como</div>
          <div style={{ fontSize:13, color:'#dce8ff', fontWeight:600 }}>{usuario.nome}</div>
          <div style={{ fontSize:11, color:'#4a5a7a' }}>{usuario.email}</div>
          {usuario.cargoPrestador && (
            <div style={{ fontSize:11, color:'#60a5fa', marginTop:4 }}>{usuario.cargoPrestador}</div>
          )}
        </div>
        {vinculado === true && (
          <div style={{ display:'inline-flex', alignItems:'center', gap:6,
            background:'rgba(16,185,129,.15)', border:'1px solid rgba(16,185,129,.4)',
            borderRadius:20, padding:'6px 14px', marginBottom:24,
            fontSize:12, color:'#10b981', fontWeight:600 }}>
            ✓ Telegram vinculado
          </div>
        )}
        {vinculado === false && (
          <div style={{ marginBottom:24, textAlign:'left' }}>
            <div style={{ fontSize:12, color:'#4a5a7a', marginBottom:12, lineHeight:1.5 }}>
              Vincule seu Telegram enquanto aguarda a aprovação. Você será notificado assim que seu cadastro for analisado.
            </div>
            <TelegramVinculo usuario={usuario} modo="inline" onVinculado={() => {}} />
          </div>
        )}
        <button onClick={onLogout} style={{ background:'rgba(255,255,255,.06)',
          border:'1px solid rgba(255,255,255,.1)', color:'rgba(255,255,255,.5)',
          borderRadius:8, padding:'10px 20px', cursor:'pointer', fontSize:13 }}>
          Sair
        </button>
      </div>
    </div>
  );
}

export const GUARD_TIPO_COR: Record<string, string> = {
  Roubo:       '#ef4444',
  Tentativa:   '#f97316',
  Vandalismo:  '#eab308',
  Recuperacao: '#22c55e',
  Outro:       '#6b7280',
};
export const GUARD_TIPO_EMOJI: Record<string, string> = {
  Roubo:       '🔴',
  Tentativa:   '🟠',
  Vandalismo:  '🟡',
  Recuperacao: '🟢',
  Outro:       '⚪',
};
export const GUARD_STATUS_COR: Record<string, string> = {
  'Aberto':      '#ef4444',
  'Em apuração': '#f97316',
  'Recuperado':  '#22c55e',
  'Encerrado':   '#6b7280',
};

// ── Gráfico tempo real do Guard ──────────────────────────────────────
export function GuardTrendChart({ ocorrencias }: { ocorrencias: any[] }) {
  const [periodoAtivo, setPeriodoAtivo] = useState<string>('7d');

  const agora = new Date();
  const ini = (dias: number) => new Date(agora.getTime() - dias * 86400000);
  const isHoje  = (d: Date) => d.toDateString() === agora.toDateString();
  const isOntem = (d: Date) => {
    const o = new Date(agora); o.setDate(o.getDate()-1);
    return d.toDateString() === o.toDateString();
  };

  const getTs = (o: any): Date | null => {
    const ts = (o.criadoEm as any)?.toDate?.() ? (o.criadoEm as any).toDate()
             : o.created_at ? new Date(o.created_at) : null;
    return ts && !isNaN(ts.getTime()) ? ts : null;
  };

  // Dados por período
  const PERIODOS = [
    { key:'hoje',  label:'Hoje',   filter: (o:any) => { const t=getTs(o); return t?isHoje(t):false; } },
    { key:'ontem', label:'Ontem',  filter: (o:any) => { const t=getTs(o); return t?isOntem(t):false; } },
    { key:'7d',    label:'7 dias', filter: (o:any) => { const t=getTs(o); return t?t>=ini(7):false; } },
    { key:'30d',   label:'30d',    filter: (o:any) => { const t=getTs(o); return t?t>=ini(30):false; } },
    { key:'total', label:'Total',  filter: () => true },
  ];

  const TIPOS_SERIES = [
    { key:'Roubo',      cor:'#ef4444' },
    { key:'Vandalismo', cor:'#f59e0b' },
    { key:'Tentativa',  cor:'#f97316' },
    { key:'Recuperacao',cor:'#4ade80' },
    { key:'Furto',      cor:'#fb923c' },
    { key:'Alarme',     cor:'#60a5fa' },
  ];

  // Calcular dados do período ativo
  const pAtivo = PERIODOS.find(p => p.key === periodoAtivo) || PERIODOS[4];
  const filtrados = ocorrencias.filter(pAtivo.filter);
  const total = filtrados.length;

  // Totais por tipo
  const porTipo: Record<string,number> = {};
  filtrados.forEach(o => { porTipo[o.tipo] = (porTipo[o.tipo]||0)+1; });

  // Gráfico de barras por tipo SVG
  const maxV = Math.max(...TIPOS_SERIES.map(s => porTipo[s.key]||0), 1);
  const W = 300; const H = 80; const PL = 8; const PR = 8; const PT = 8; const PB = 22;
  const CW = W-PL-PR; const CH = H-PT-PB;
  const BW = Math.floor(CW / TIPOS_SERIES.length) - 3;

  return (
    <div style={{ borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
      {/* Abas de período */}
      <div style={{ display:'flex', padding:'6px 12px', gap:4 }}>
        {PERIODOS.map(p => (
          <button key={p.key} onClick={() => setPeriodoAtivo(p.key)} style={{
            flex:1, padding:'4px 2px', borderRadius:6, cursor:'pointer', fontSize:9, fontWeight:600,
            background: periodoAtivo===p.key ? 'rgba(167,139,250,.2)' : 'rgba(255,255,255,.04)',
            border: `1px solid ${periodoAtivo===p.key ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.08)'}`,
            color: periodoAtivo===p.key ? '#a78bfa' : 'rgba(255,255,255,.35)',
          }}>{p.label}</button>
        ))}
      </div>

      {/* Total do período */}
      <div style={{ display:'flex', alignItems:'baseline', gap:6, padding:'0 12px 6px' }}>
        <span style={{ fontSize:24, fontWeight:800, color:'#dce8ff', lineHeight:1 }}>{total}</span>
        <span style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>ocorrências · {pAtivo.label}</span>
        {porTipo['Roubo'] > 0 && (
          <span style={{ fontSize:10, color:'#ef4444', marginLeft:'auto', fontWeight:700 }}>
            🔴 {porTipo['Roubo']} roubos
          </span>
        )}
      </div>

      {/* Gráfico SVG */}
      {total > 0 && (
        <div style={{ padding:'0 12px 8px' }}>
          <svg width={W} height={H} style={{ display:'block', overflow:'visible' }}>
            {TIPOS_SERIES.map((s, i) => {
              const v = porTipo[s.key] || 0;
              const bh = v > 0 ? Math.max(4, Math.round((v/maxV)*CH)) : 0;
              const x = PL + i * (BW+3);
              const y = PT + CH - bh;
              return (
                <g key={s.key}>
                  {/* Barra */}
                  {bh > 0 && (
                    <rect x={x} y={y} width={BW} height={bh}
                      fill={s.cor} rx={3} opacity={0.9}/>
                  )}
                  {/* Valor */}
                  {v > 0 && (
                    <text x={x+BW/2} y={bh > 14 ? y+11 : y-3}
                      textAnchor="middle" fill={bh>14?'#fff':s.cor}
                      fontSize={8} fontWeight="700">{v}</text>
                  )}
                  {/* Label */}
                  <text x={x+BW/2} y={H-4} textAnchor="middle"
                    fill="rgba(255,255,255,.3)" fontSize={7}>
                    {s.key.slice(0,4)}
                  </text>
                </g>
              );
            })}
            {/* Linha base */}
            <line x1={PL} x2={W-PR} y1={PT+CH} y2={PT+CH}
              stroke="rgba(255,255,255,.08)" strokeWidth={1}/>
          </svg>
        </div>
      )}

      {total === 0 && (
        <div style={{ padding:'4px 12px 12px', fontSize:10, color:'rgba(255,255,255,.2)' }}>
          Nenhuma ocorrência no período
        </div>
      )}
    </div>
  );
}


// ── Gráfico comparativo: todos os 5 períodos ao mesmo tempo ──────────
export function GuardComparativoChart({ ocorrencias }: { ocorrencias: any[] }) {
  const agora = new Date();
  const ini = (dias: number) => new Date(agora.getTime() - dias * 86400000);
  const isHoje  = (d: Date) => d.toDateString() === agora.toDateString();
  const isOntem = (d: Date) => { const o = new Date(agora); o.setDate(o.getDate()-1); return d.toDateString() === o.toDateString(); };

  const getTs = (o: any): Date | null => {
    const ts = (o.criadoEm as any)?.toDate?.() ? (o.criadoEm as any).toDate()
             : o.created_at ? new Date(o.created_at) : null;
    return ts && !isNaN(ts.getTime()) ? ts : null;
  };

  const PERIODOS = [
    { key:'hoje',  label:'Hoje',  cor:'#a78bfa', filter: (o:any) => { const t=getTs(o); return t?isHoje(t):false; } },
    { key:'ontem', label:'Ontem', cor:'#60a5fa', filter: (o:any) => { const t=getTs(o); return t?isOntem(t):false; } },
    { key:'7d',    label:'7d',    cor:'#34d399', filter: (o:any) => { const t=getTs(o); return t?t>=ini(7):false; } },
    { key:'30d',   label:'30d',   cor:'#fbbf24', filter: (o:any) => { const t=getTs(o); return t?t>=ini(30):false; } },
    { key:'total', label:'Total', cor:'#f87171', filter: () => true },
  ];

  // Total por período
  const totais = PERIODOS.map(p => ({
    ...p,
    total: ocorrencias.filter(p.filter).length,
  }));

  const maxTotal = Math.max(...totais.map(p => p.total), 1);

  // Tipos de incidente por período
  const TIPOS = ['Roubo','Vandalismo','Tentativa','Recuperacao','Furto','Alarme'];
  const CORES_TIPO: Record<string,string> = {
    Roubo:'#ef4444', Vandalismo:'#f59e0b', Tentativa:'#f97316',
    Recuperacao:'#4ade80', Furto:'#fb923c', Alarme:'#60a5fa',
  };

  const dadosPorPeriodo = PERIODOS.map(p => {
    const ocs = ocorrencias.filter(p.filter);
    const porTipo: Record<string,number> = {};
    TIPOS.forEach(t => { porTipo[t] = ocs.filter(o => o.tipo === t).length; });
    return { ...p, total: ocs.length, porTipo };
  });

  // SVG: barras agrupadas — eixo X = período, grupos de tipo dentro
  const W = 308; const H = 110;
  const PL = 28; const PR = 8; const PT = 12; const PB = 24;
  const CW = W - PL - PR; const CH = H - PT - PB;
  const GRP_W = Math.floor(CW / PERIODOS.length);
  const BAR_W = Math.max(3, Math.floor((GRP_W - 4) / TIPOS.length) - 1);

  // Grades horizontais
  const grades = [0.25, 0.5, 0.75, 1.0];

  return (
    <div style={{ borderBottom:'1px solid rgba(255,255,255,.06)',
      padding:'8px 12px 10px', flexShrink:0 }}>

      {/* Título */}
      <div style={{ fontSize:9, color:'rgba(255,255,255,.3)',
        marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontWeight:600, color:'rgba(255,255,255,.5)' }}>📊 Visão geral comparativa</span>
        <span style={{ fontSize:8 }}>todos os períodos</span>
      </div>

      {/* Totais rápidos por período */}
      <div style={{ display:'flex', gap:3, marginBottom:8 }}>
        {totais.map(p => (
          <div key={p.key} style={{ flex:1, textAlign:'center',
            background:`${p.cor}15`, border:`1px solid ${p.cor}40`,
            borderRadius:6, padding:'3px 2px' }}>
            <div style={{ fontSize:13, fontWeight:800, color:p.cor, lineHeight:1 }}>{p.total}</div>
            <div style={{ fontSize:7, color:'rgba(255,255,255,.3)', marginTop:1 }}>{p.label}</div>
          </div>
        ))}
      </div>

      {/* Gráfico barras agrupadas SVG */}
      <svg width={W} height={H} style={{ display:'block', overflow:'visible' }}>

        {/* Grade */}
        {grades.map(f => {
          const y = PT + CH*(1-f);
          const v = Math.round(maxTotal*f);
          return (
            <g key={f}>
              <line x1={PL} x2={W-PR} y1={y} y2={y}
                stroke="rgba(255,255,255,.06)" strokeWidth={1}/>
              <text x={PL-3} y={y+3} textAnchor="end"
                fill="rgba(255,255,255,.2)" fontSize={6}>{v}</text>
            </g>
          );
        })}

        {/* Linha base */}
        <line x1={PL} x2={W-PR} y1={PT+CH} y2={PT+CH}
          stroke="rgba(255,255,255,.12)" strokeWidth={1}/>

        {/* Grupos por período */}
        {dadosPorPeriodo.map((p, pi) => {
          const gx = PL + pi * GRP_W;
          return (
            <g key={p.key}>
              {/* Barras por tipo */}
              {TIPOS.map((t, ti) => {
                const v = p.porTipo[t] || 0;
                const bh = v > 0 ? Math.max(3, Math.round((v/maxTotal)*CH)) : 0;
                const x = gx + ti * (BAR_W + 1) + 2;
                const y = PT + CH - bh;
                const cor = CORES_TIPO[t] || '#888';
                return (
                  <g key={t}>
                    {bh > 0 && (
                      <rect x={x} y={y} width={BAR_W} height={bh}
                        fill={cor} rx={2} opacity={0.85}/>
                    )}
                    {bh > 10 && v > 0 && (
                      <text x={x+BAR_W/2} y={y+8} textAnchor="middle"
                        fill="#fff" fontSize={6} fontWeight="700">{v}</text>
                    )}
                    {bh > 0 && bh <= 10 && (
                      <text x={x+BAR_W/2} y={y-2} textAnchor="middle"
                        fill={cor} fontSize={6}>{v}</text>
                    )}
                  </g>
                );
              })}
              {/* Label período */}
              <text x={gx + GRP_W/2} y={H-6} textAnchor="middle"
                fill={p.cor} fontSize={8} fontWeight="600">{p.label}</text>
              {/* Total do período acima do grupo */}
              {p.total > 0 && (
                <text x={gx + GRP_W/2} y={PT-2} textAnchor="middle"
                  fill={p.cor} fontSize={7} fontWeight="700">{p.total}</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legenda de tipos */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'3px 8px', marginTop:4 }}>
        {TIPOS.map(t => (
          <div key={t} style={{ display:'flex', alignItems:'center', gap:3 }}>
            <div style={{ width:6, height:6, borderRadius:1, background:CORES_TIPO[t] }}/>
            <span style={{ fontSize:7, color:'rgba(255,255,255,.3)' }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Modal editar ocorrência (guard, campo, gestor, admin) ──────────
export function GuardEditModal({ ocorrencia, usuario, onFechar, onSalvo }: {
  ocorrencia: any;
  usuario: { uid: string; role: string; nome?: string; email?: string };
  onFechar: () => void;
  onSalvo:  () => void;
}) {
  const TIPOS_G   = ['Roubo','Tentativa','Vandalismo','Recuperacao','Perda','Outro'];
  const STATUS_G  = ['Aberto','Em apuração','Recuperado','Encerrado'];
  const ATIVOS_G  = ['Patinete','Bicicleta','Bateria'];
  const TURNOS_G  = [['shiftMorning','Manhã (06–14h)'],['shiftAfternoon','Tarde (14–22h)'],['shiftNight','Noite (22–06h)']];

  const isGestorModal = ['gestor','admin'].includes(usuario.role);
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.slice(0,2) || 'pt') as 'pt'|'en'|'es'|'ru';
  const pick = (o: Record<string,string>) => o[lang] ?? o.pt;

  const TG = {
    phDescAtivo: { pt:'Descrição do ativo...', en:'Asset description...', es:'Descripción del activo...', ru:'Описание актива...' },
    phNumBO:     { pt:'Número do BO', en:'Police report number', es:'Número del parte', ru:'Номер протокола' },
    phOpcional:  { pt:'Opcional', en:'Optional', es:'Opcional', ru:'Необязательно' },
  };

  const [tipo,        setTipo]        = useState(ocorrencia.tipo || 'Outro');
  const [status,      setStatus]      = useState(ocorrencia.status || 'Aberto');
  const [assetId,     setAssetId]     = useState(ocorrencia.asset_id || '');
  const [ativoTipo,   setAtivoTipo]   = useState(ocorrencia.ativo_tipo || 'Patinete');
  const [descricao,   setDescricao]   = useState(ocorrencia.descricao || '');
  const [turno,       setTurno]       = useState(ocorrencia.turno || 'shiftMorning');
  const [procurando,  setProcurando]  = useState(ocorrencia.procurando || '');
  const [danoPct,     setDanoPct]     = useState<string>(String(ocorrencia.danoPct ?? ''));
  const [danoValor,   setDanoValor]   = useState<string>(String(ocorrencia.danoValor ?? ''));
  const [estacaoId,   setEstacaoId]   = useState(ocorrencia.estacaoId || '');
  const [obs,         setObs]         = useState(ocorrencia.observacao_fechamento || '');
  const [boNum,       setBoNum]       = useState(ocorrencia.bo_numero || '');
  const [boPreview,   setBoPreview]   = useState(ocorrencia.bo_url || '');
  const [boFile,      setBoFile]      = useState<File|null>(null);
  const [lat,         setLat]         = useState(String(ocorrencia.lat_inicial || ''));
  const [lng,         setLng]         = useState(String(ocorrencia.lng_inicial || ''));
  const [endereco,    setEndereco]    = useState(ocorrencia.endereco_inicial || '');
  const [bairro,      setBairro]      = useState(ocorrencia.bairro_inicial || '');
  const [cidade,      setCidade]      = useState(ocorrencia.cidade_inicial || '');
  const [showLoc,     setShowLoc]     = useState(false);
  const [showMapPick, setShowMapPick] = useState(false);
  const toDateStr = (ts: any) => {
    if (!ts) return '';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toISOString().slice(0,16);
    } catch { return ''; }
  };
  const [dataOcorr,   setDataOcorr]   = useState(toDateStr(ocorrencia.criadoEm));
  const [busy,        setBusy]        = useState(false);
  const [erro,        setErro]        = useState('');
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const boRef    = useRef<HTMLInputElement>(null);
  const boGalRef = useRef<HTMLInputElement>(null);

  const handleBoFile = (f: File) => {
    setBoFile(f);
    const r = new FileReader();
    r.onload = e => setBoPreview((e.target?.result as string)||'');
    r.readAsDataURL(f);
  };

  const buscarGPS = () => {
    capturarPosicaoUnica().then(pos => {
      if (pos) {
        setLat(pos.lat.toFixed(6));
        setLng(pos.lng.toFixed(6));
      } else {
        setErro('GPS indisponível');
      }
    });
  };

  // Mini mapa de seleção de localização
  const miniMapRef = useRef<any>(null);
  useEffect(() => {
    if (!showMapPick) {
      if (miniMapRef.current) { miniMapRef.current.remove(); miniMapRef.current = null; }
      return;
    }
    const initLat = parseFloat(lat) || ocorrencia.lat_inicial || -23.5505;
    const initLng = parseFloat(lng) || ocorrencia.lng_inicial || -46.6333;
    setTimeout(() => {
      const el = document.getElementById('guard-edit-map');
      if (!el || miniMapRef.current) return;
      const m = L.map(el, { zoomControl: true }).setView([initLat, initLng], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution:'© OSM' }).addTo(m);
      (el as any)._leafletMap = m;
      miniMapRef.current = m;
    }, 50);
    return () => {
      if (miniMapRef.current) { miniMapRef.current.remove(); miniMapRef.current = null; }
    };
  }, [showMapPick]);

  const salvar = async () => {
    if ((status==='Encerrado'||status==='Recuperado') && !obs.trim()) {
      setErro('Adicione observação de fechamento.'); return;
    }
    setBusy(true); setErro('');
    try {
      let boUrl = ocorrencia.bo_url || '';
      if (boFile) {
        const comp = await comprimir(boFile);
        boUrl = await uploadComRetry(comp, 'ocorrencias/bo_'+ocorrencia.id+'.jpg');
      }
      const patch: any = {
        tipo, status, asset_id: assetId.trim(), ativo_tipo: ativoTipo,
        descricao: descricao.trim(), turno, procurando: procurando.trim(),
        estacaoId: estacaoId.trim(), observacao_fechamento: obs.trim(),
        bo_numero: boNum.trim(), bo_url: boUrl,
        ultimoEditor: usuario.uid,
        updated_at: FsTimestamp.fromDate(new Date()),
        ...(dataOcorr ? { dataManual: dataOcorr } : {}),
        ...(tipo === 'Vandalismo' ? {
          danoPct:   danoPct.trim()   !== '' ? Number(danoPct)                     : null,
          danoValor: danoValor.trim() !== '' ? Number(danoValor.replace(',', '.')) : null,
        } : {}),
      };
      const latNum = parseFloat(String(lat).replace(',','.'));
      const lngNum = parseFloat(String(lng).replace(',','.'));
      if (!isNaN(latNum) && !isNaN(lngNum) && Math.abs(latNum) > 0.001 && Math.abs(lngNum) > 0.001) {
        patch.lat_inicial = latNum;
        patch.lng_inicial = lngNum;
        console.log('[guard edit] salvando loc:', latNum, lngNum);
      } else {
        console.warn('[guard edit] loc inválida, não salva:', lat, lng);
      }
      if (endereco)   patch.endereco_inicial = endereco.trim();
      if (bairro)     patch.bairro_inicial   = bairro.trim();
      if (cidade)     patch.cidade_inicial   = cidade.trim();
      await updateDoc(doc(db,'ocorrencias',ocorrencia.id), patch);
      if (guardWriteSupabase()) atualizarOcorrenciaSupabase(ocorrencia.id, patch).catch(err => console.error('[guard-write] update Supabase:', err));
      onSalvo();
    } catch(e:any) { setErro('Erro: '+(e?.message||'tente novamente')); }
    setBusy(false);
  };

  const excluirConfirmado = async () => {
    const docId = String(ocorrencia?.docId || ocorrencia?.firestoreId || '').trim();
    if (!docId) { setErro('ID não encontrado: ' + JSON.stringify(ocorrencia?.id)); return; }
    setBusy(true);
    setErro('');
    setConfirmarExcluir(false);
    try {
      const { deleteDoc: delFn } = await import('firebase/firestore');
      await delFn(doc(db, 'ocorrencias', docId));
      if (guardWriteSupabase()) deletarOcorrenciaSupabase(docId).catch(err => console.error('[guard-write] delete Supabase:', err));
      console.log('[excluir ocorrencia] OK deletado do Firestore:', docId);
      onFechar();
      onSalvo();
    } catch(e:any) {
      console.error('[excluir]', e?.code, e?.message);
      setErro((e?.code || 'erro') + ': ' + (e?.message || String(e)));
      setBusy(false);
    }
  };

  const excluir = () => setConfirmarExcluir(true);

  const inp: React.CSSProperties = {
    width:'100%', padding:'9px 11px', boxSizing:'border-box' as const,
    background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.09)',
    borderRadius:9, color:'#fff', fontSize:12, outline:'none',
  };
  const lbl: React.CSSProperties = {
    fontSize:9, color:'rgba(255,255,255,.4)', fontWeight:700,
    letterSpacing:'.07em', display:'block', marginBottom:4, textTransform:'uppercase' as const,
  };
  const corTipo: Record<string,string> = {
    Roubo:'#ef4444',Tentativa:'#f97316',Vandalismo:'#eab308',Recuperacao:'#22c55e',Perda:'#a855f7',Outro:'#6b7280'
  };
  const emojiTipo: Record<string,string> = {
    Roubo:'🔴',Tentativa:'🟠',Vandalismo:'🟡',Recuperacao:'🟢',Perda:'🟣',Outro:'⚪'
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:5000,
      display:'flex', alignItems: window.innerWidth > 500 ? 'center' : 'flex-end',
      background:'rgba(0,0,0,.75)', fontFamily:'Inter,sans-serif' }}
      onClick={e => e.target===e.currentTarget && onFechar()}>
      <div style={{ width:'100%', maxWidth: window.innerWidth <= 500 ? '100vw' : 700, margin:'0 auto',
        background:'#0d1220', borderRadius:'18px 18px 0 0',
        border:'1px solid rgba(167,139,250,.2)',
        maxHeight:'92vh', display:'flex', flexDirection:'column',
        position:'relative' }}>

        {/* Header fixo */}
        <div style={{ padding:'16px 18px', borderBottom:'1px solid rgba(255,255,255,.07)',
          flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ color:'#a78bfa', fontWeight:700, fontSize:15 }}>✏️ Editar ocorrência</div>
            <div style={{ color:'rgba(255,255,255,.3)', fontSize:10, marginTop:2 }}>ID: {ocorrencia.id}</div>
          </div>
          <button onClick={onFechar}
            style={{ background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:20, cursor:'pointer' }}>✕</button>
        </div>

        {/* Scroll interno */}
        <div style={{ overflowY:'auto', flex:1, padding:'16px 18px',
          scrollbarWidth:'thin' as const, scrollbarColor:'#1c2535 transparent' }}>

          {/* Tipo */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Tipo de ocorrência</label>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap' as const }}>
              {TIPOS_G.map(tp => (
                <button key={tp} onClick={()=>setTipo(tp)}
                  style={{ padding:'5px 9px', borderRadius:8, cursor:'pointer', fontSize:11, fontWeight:600,
                    background: tipo===tp ? (corTipo[tp]||'#6b7280')+'22' : 'rgba(255,255,255,.04)',
                    border:`1px solid ${tipo===tp ? (corTipo[tp]||'#6b7280')+'55' : 'rgba(255,255,255,.08)'}`,
                    color: tipo===tp ? (corTipo[tp]||'#6b7280') : 'rgba(255,255,255,.4)' }}>
                  {emojiTipo[tp]||'⚪'} {tp}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Status</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
              {STATUS_G.map(s => {
                const cor = s==='Encerrado'?'#4ade80':s==='Recuperado'?'#34d399':s==='Em apuração'?'#fbbf24':'#f87171';
                return (
                  <button key={s} onClick={()=>setStatus(s)}
                    style={{ padding:'8px', borderRadius:9, cursor:'pointer', fontSize:11, fontWeight:600,
                      background: status===s ? cor+'18' : 'rgba(255,255,255,.04)',
                      border:`1px solid ${status===s ? cor+'44' : 'rgba(255,255,255,.08)'}`,
                      color: status===s ? cor : 'rgba(255,255,255,.4)' }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ativo */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
            <div>
              <label style={lbl}>Tipo de ativo</label>
              <select value={ativoTipo} onChange={e=>setAtivoTipo(e.target.value)}
                style={{ ...inp, cursor:'pointer' }}>
                {ATIVOS_G.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>ID / Placa</label>
              <input value={assetId} onChange={e=>setAssetId(e.target.value)} placeholder="JET-001234" style={inp}/>
            </div>
          </div>

          {/* Procurando */}
          {(tipo==='Roubo'||tipo==='Tentativa') && (
            <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:9,
              background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.15)' }}>
              <label style={{ ...lbl, color:'#f87171' }}>Procurando</label>
              <input value={procurando} onChange={e=>setProcurando(e.target.value)}
                placeholder={pick(TG.phDescAtivo)} style={{ ...inp, borderColor:'rgba(239,68,68,.2)' }}/>
            </div>
          )}

          {/* Dano da oficina — só Vandalismo */}
          {tipo === 'Vandalismo' && (
            <div style={{ marginBottom:12, padding:'12px 14px', borderRadius:9,
              background:'rgba(234,179,8,.05)', border:'1px solid rgba(234,179,8,.2)' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#fbbf24',
                textTransform:'uppercase', letterSpacing:'.8px', marginBottom:10 }}>
                🔧 Avaliação da oficina
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div>
                  <label style={{ ...lbl, color:'#fbbf24' }}>% Dano</label>
                  <div style={{ position:'relative' }}>
                    <input type="number" min="0" max="100" step="1"
                      value={danoPct} onChange={e=>setDanoPct(e.target.value)}
                      placeholder="0"
                      style={{ ...inp, borderColor:'rgba(234,179,8,.25)', paddingRight:28 }}/>
                    <span style={{ position:'absolute', right:10, top:'50%',
                      transform:'translateY(-50%)', color:'rgba(255,255,255,.4)',
                      fontSize:12, pointerEvents:'none' as const }}>%</span>
                  </div>
                  {danoPct && !isNaN(Number(danoPct)) && (
                    <div style={{ marginTop:4, height:4, background:'rgba(255,255,255,.08)', borderRadius:2 }}>
                      <div style={{ height:4, borderRadius:2, transition:'width .3s',
                        width:`${Math.min(100,Number(danoPct))}%`,
                        background: Number(danoPct)>=75?'#ef4444':Number(danoPct)>=40?'#f97316':'#fbbf24' }}/>
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ ...lbl, color:'#fbbf24' }}>Valor R$</label>
                  <div style={{ position:'relative' }}>
                    <span style={{ position:'absolute', left:10, top:'50%',
                      transform:'translateY(-50%)', color:'rgba(255,255,255,.4)',
                      fontSize:12, pointerEvents:'none' as const }}>R$</span>
                    <input type="number" min="0" step="0.01"
                      value={danoValor} onChange={e=>setDanoValor(e.target.value)}
                      placeholder="0,00"
                      style={{ ...inp, borderColor:'rgba(234,179,8,.25)', paddingLeft:30 }}/>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Descrição */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Descrição</label>
            <textarea value={descricao} onChange={e=>setDescricao(e.target.value)}
              rows={2} style={{ ...inp, resize:'none' as const }}/>
          </div>

          {/* Turno + Estação */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
            <div>
              <label style={lbl}>Turno</label>
              <select value={turno} onChange={e=>setTurno(e.target.value)} style={{ ...inp, cursor:'pointer' }}>
                {TURNOS_G.map(([k,l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>ID da estação</label>
              <input value={estacaoId} onChange={e=>setEstacaoId(e.target.value)} placeholder={pick(TG.phOpcional)} style={inp}/>
            </div>
          </div>

          {/* Data/hora */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Data / hora da ocorrência</label>
            <input type="datetime-local" value={dataOcorr}
              onChange={e=>setDataOcorr(e.target.value)}
              style={{ ...inp, colorScheme:'dark' as any }}/>
            <div style={{ fontSize:9, color:'rgba(255,255,255,.25)', marginTop:3 }}>
              A data original é preservada nos logs. Esta é a data manual do fato.
            </div>
          </div>

          {/* Localização */}
          <div style={{ marginBottom:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
              <label style={{ ...lbl, marginBottom:0 }}>Localização</label>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' as const }}>
                <button onClick={()=>setShowMapPick(v=>!v)}
                  style={{ fontSize:9, padding:'3px 7px', borderRadius:5, cursor:'pointer',
                    background: showMapPick?'rgba(16,185,129,.2)':'rgba(255,255,255,.06)',
                    border:`1px solid ${showMapPick?'rgba(16,185,129,.4)':'rgba(255,255,255,.1)'}`,
                    color: showMapPick?'#34d399':'rgba(255,255,255,.5)' }}>
                  🗺 Mapa
                </button>
                <button onClick={buscarGPS}
                  style={{ fontSize:9, padding:'3px 7px', borderRadius:5, cursor:'pointer',
                    background:'rgba(59,130,246,.15)', border:'1px solid rgba(59,130,246,.3)', color:'#60a5fa' }}>
                  📡 GPS
                </button>
                <button onClick={()=>setShowLoc(v=>!v)}
                  style={{ fontSize:9, padding:'3px 7px', borderRadius:5, cursor:'pointer',
                    background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                    color:'rgba(255,255,255,.5)' }}>
                  {showLoc?'▲':'▼'} Editar
                </button>
              </div>
            </div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,.3)', marginBottom:5 }}>
              📍 {[endereco||ocorrencia.endereco_inicial, bairro||ocorrencia.bairro_inicial, cidade||ocorrencia.cidade_inicial].filter(Boolean).join(' · ')||'Não informado'}
              {lat && lng && <span style={{ color:'rgba(255,255,255,.2)', marginLeft:6 }}>({parseFloat(lat).toFixed(4)}, {parseFloat(lng).toFixed(4)})</span>}
            </div>
            {showMapPick && (
              <div style={{ borderRadius:10, overflow:'hidden', marginBottom:8, position:'relative', height:200 }}>
                <div id="guard-edit-map" style={{ width:'100%', height:'100%' }} />
                <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
                  fontSize:24, pointerEvents:'none', filter:'drop-shadow(0 2px 4px rgba(0,0,0,.8))' }}>📍</div>
                <div style={{ position:'absolute', bottom:6, left:0, right:0, textAlign:'center',
                  fontSize:9, color:'rgba(255,255,255,.6)', pointerEvents:'none' }}>
                  Mova o mapa para posicionar o pin
                </div>
                <button onClick={()=>{
                  if (miniMapRef.current) {
                    const c = miniMapRef.current.getCenter();
                    setLat(String(c.lat.toFixed(6)));
                    setLng(String(c.lng.toFixed(6)));
                    // Reverter geocode
                    fetch('https://nominatim.openstreetmap.org/reverse?lat='+c.lat+'&lon='+c.lng+'&format=json')
                      .then(r=>r.json())
                      .then(j=>{
                        if (j.address) {
                          setEndereco((j.address.road||'') + (j.address.house_number?' '+j.address.house_number:''));
                          setBairro(j.address.suburb||j.address.neighbourhood||j.address.city_district||'');
                          setCidade(j.address.city||j.address.town||j.address.municipality||'');
                        }
                      }).catch(()=>{});
                    setShowMapPick(false);
                  } else {
                    setErro('Mapa não carregado. Tente novamente.');
                  }
                }} style={{ position:'absolute', bottom:6, right:6,
                  background:'rgba(16,185,129,.9)', border:'none', color:'#fff',
                  borderRadius:8, padding:'5px 10px', cursor:'pointer', fontSize:11, fontWeight:700 }}>
                  ✓ Confirmar
                </button>
              </div>
            )}
            {showLoc && (
              <div style={{ display:'flex', flexDirection:'column', gap:7, padding:'10px',
                borderRadius:9, background:'rgba(255,255,255,.03)', border:'1px solid rgba(255,255,255,.06)' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
                  <div><label style={lbl}>Latitude</label>
                    <input value={lat} onChange={e=>setLat(e.target.value)} placeholder="-8.063" style={inp}/></div>
                  <div><label style={lbl}>Longitude</label>
                    <input value={lng} onChange={e=>setLng(e.target.value)} placeholder="-34.87" style={inp}/></div>
                </div>
                <div><label style={lbl}>{t('drawer.address')}</label>
                  <input value={endereco} onChange={e=>setEndereco(e.target.value)} style={inp}/></div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
                  <div><label style={lbl}>Bairro</label>
                    <input value={bairro} onChange={e=>setBairro(e.target.value)} style={inp}/></div>
                  <div><label style={lbl}>Cidade</label>
                    <input value={cidade} onChange={e=>setCidade(e.target.value)} style={inp}/></div>
                </div>
              </div>
            )}
          </div>

          {/* Observação fechamento */}
          <div style={{ marginBottom:12 }}>
            <label style={lbl}>Observação de fechamento</label>
            <textarea value={obs} onChange={e=>setObs(e.target.value)} rows={2}
              style={{ ...inp, resize:'none' as const }}
              placeholder={status==='Encerrado'||status==='Recuperado' ? 'Obrigatório para encerrar' : 'Opcional'}/>
          </div>

          {/* BO */}
          <div style={{ marginBottom:12, padding:'10px 12px', borderRadius:9,
            background:'rgba(234,179,8,.05)', border:'1px solid rgba(234,179,8,.15)' }}>
            <label style={{ ...lbl, color:'#fbbf24' }}>Boletim de Ocorrência</label>
            <input value={boNum} onChange={e=>setBoNum(e.target.value)}
              placeholder={pick(TG.phNumBO)} style={{ ...inp, marginBottom:8, borderColor:'rgba(234,179,8,.2)' }}/>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={async (e)=>{
                  if (isAndroidNative()) {
                    e.preventDefault();
                    let f: File | null = null;
                    try { f = await capturarFotoNativa(); } catch {}
                    if (f) { handleBoFile(f); return; }
                  }
                  boRef.current?.click();
                }}
                style={{ flex:1, padding:'7px', borderRadius:7, cursor:'pointer', fontSize:10,
                  background:'rgba(234,179,8,.1)', border:'1px solid rgba(234,179,8,.2)', color:'#fbbf24' }}>
                📷 Câmera
              </button>
              <button onClick={()=>boGalRef.current?.click()}
                style={{ flex:1, padding:'7px', borderRadius:7, cursor:'pointer', fontSize:10,
                  background:'rgba(234,179,8,.1)', border:'1px solid rgba(234,179,8,.2)', color:'#fbbf24' }}>
                🖼 Galeria
              </button>
            </div>
            <input ref={boRef}    type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={e=>{ if(e.target.files?.[0]) handleBoFile(e.target.files[0]); }}/>
            <input ref={boGalRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>{ if(e.target.files?.[0]) handleBoFile(e.target.files[0]); }}/>
            {boPreview && <img src={boPreview} alt="BO" style={{ width:'100%', borderRadius:8, marginTop:8, maxHeight:100, objectFit:'cover' }}/>}
            {ocorrencia.bo_url && !boFile && (
              <a href={ocorrencia.bo_url} target="_blank" rel="noreferrer"
                style={{ display:'block', fontSize:10, color:'#fbbf24', marginTop:6 }}>
                📋 Ver BO atual ↗
              </a>
            )}
          </div>

          {erro && <div style={{ color:'#f87171', fontSize:11, marginBottom:8 }}>{erro}</div>}
        </div>

        {/* Modal confirmação exclusão */}
        {confirmarExcluir && (
          <div style={{ position:'absolute', inset:0, zIndex:10, background:'rgba(0,0,0,.85)',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            borderRadius:'0 0 18px 18px', padding:24, gap:12 }}>
            <div style={{ fontSize:32 }}>🗑</div>
            <div style={{ fontSize:14, fontWeight:700, color:'#f87171', textAlign:'center' }}>
              Excluir permanentemente?
            </div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.45)', textAlign:'center', lineHeight:1.5 }}>
              Esta ação não pode ser desfeita.<br/>
              ID: <b style={{ color:'#dce8ff' }}>{ocorrencia?.id}</b>
            </div>
            <div style={{ display:'flex', gap:8, width:'100%' }}>
              <button onClick={() => setConfirmarExcluir(false)}
                style={{ flex:1, padding:'11px', borderRadius:10, cursor:'pointer',
                  background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.15)',
                  color:'rgba(255,255,255,.6)', fontSize:13 }}>
                Cancelar
              </button>
              <button onClick={excluirConfirmado} disabled={busy}
                style={{ flex:1, padding:'11px', borderRadius:10, cursor:'pointer',
                  background:'#dc2626', border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
                {busy ? 'Excluindo...' : '✓ Confirmar'}
              </button>
            </div>
          </div>
        )}

        {/* Footer fixo */}
        <div style={{ padding:'12px 18px', borderTop:'1px solid rgba(255,255,255,.07)', flexShrink:0 }}>
          {isGestorModal && (
            <button onClick={excluir} disabled={busy}
              style={{ width:'100%', padding:'9px', borderRadius:9, cursor:'pointer', marginBottom:8,
                background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)',
                color:'#f87171', fontSize:12, fontWeight:600 }}>
              🗑 Excluir ocorrência permanentemente
            </button>
          )}
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onFechar}
              style={{ flex:1, padding:'11px', borderRadius:10, cursor:'pointer',
                background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)',
                color:'rgba(255,255,255,.5)', fontSize:12 }}>Cancelar</button>
            <button onClick={salvar} disabled={busy}
              style={{ flex:2, padding:'11px', borderRadius:10, cursor:busy?'not-allowed':'pointer',
                background:busy?'rgba(124,58,237,.3)':'linear-gradient(135deg,#7c3aed,#a78bfa)',
                border:'none', color:'#fff', fontSize:13, fontWeight:700 }}>
              {busy?'Salvando...':'💾 Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


export function GuardOverlay({ mapInstance, onOcorrenciasChange, onFechar, cidade, usuario }: {
  mapInstance: L.Map | null;
  onOcorrenciasChange: (list: any[]) => void;
  onFechar: () => void;
  cidade: string;
  usuario: { uid: string; role: string };
}) {
  const { t } = useTranslation();
  const [ocorrencias,   setOcorrencias]   = useState<any[]>([]);
  const [filtroTipo,    setFiltroTipo]    = useState<string>('TODOS');
  const [buscaAtivo,    setBuscaAtivo]    = useState<string>('');
  const [filtroCidade,  setFiltroCidade]  = useState<string>('');
  const [filtroDias,    setFiltroDias]    = useState<number>(0); // 0 = Total (padrão)
  const [customDe,      setCustomDe]      = useState<string>('');
  const [customAte,     setCustomAte]     = useState<string>('');
  const [modoCustom,    setModoCustom]    = useState<boolean>(false);
  const [showHeat,      setShowHeat]      = useState<boolean>(false);
  const [selecionada,   setSelecionada]   = useState<any | null>(null);
  const [editModal,     setEditModal]     = useState<any | null>(null);
  const guardMarkersRef = useRef<L.CircleMarker[]>([]);
  const heatLayerRef    = useRef<any>(null);

  useEffect(() => {
    let ativo = true;
    // Calcula janela de tempo — custom ou dias fixos
    let desdeMs: number;
    let ateMs: number;
    if (modoCustom && customDe) {
      desdeMs = new Date(customDe + 'T00:00:00').getTime();
      ateMs   = customAte ? new Date(customAte + 'T23:59:59').getTime() : Date.now() + 86400000;
    } else if (filtroDias === 0) {
      // Total: sem limite de data — inclui tudo
      desdeMs = 0;
      ateMs   = 9999999999999; // ano ~2286
    } else {
      desdeMs = Date.now() - filtroDias * 24 * 60 * 60 * 1000;
      ateMs   = Date.now() + 300000; // +5min para cobrir serverTimestamp do servidor
    }
    const processar = (docs: any[]) => {
        const lista = docs
          .filter((o: any) => {
            // Modo Total: inclui TUDO sem filtro de data
            if (filtroDias === 0 && !modoCustom) return true;
            const ts = o.criadoEm || o.created_at;
            if (!ts) return true; // sem timestamp = inclui sempre
            const ms = ts?.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
            if (isNaN(ms)) return true;
            return ms >= desdeMs && ms <= ateMs;
          })
          .map((o: any) => {
            // Aceitar lat/lng com vírgula (importados do XLSX) ou ponto
            const parseLoc = (v: any) => {
              if (typeof v === 'number') return v;
              const s = String(v ?? '').replace(',', '.');
              const n = parseFloat(s);
              return isNaN(n) ? 0 : n;
            };
            return {
              ...o,
              lat_inicial: parseLoc(o.lat_inicial ?? o.lat ?? o.latitude),
              lng_inicial: parseLoc(o.lng_inicial ?? o.lng ?? o.longitude),
              // Normalizar tipo — dados importados podem ter variações
              tipo: (() => {
                const t = String(o.tipo || '').trim();
                const tl = t.toLowerCase();
                if (tl === 'roubo' || tl === 'furto') return 'Roubo';
                if (tl === 'vandalismo') return 'Vandalismo';
                if (tl === 'tentativa') return 'Tentativa';
                if (tl === 'recuperacao' || tl === 'recuperação') return 'Recuperacao';
                if (tl === 'alarme') return 'Alarme';
                return t || 'Outro';
              })(),
            };
          })
          .sort((a: any, b: any) => {
            const ta = a.criadoEm?.toDate?.()?.getTime() ?? (new Date(a.criadoEm).getTime() || 0);
            const tb = b.criadoEm?.toDate?.()?.getTime() ?? (new Date(b.criadoEm).getTime() || 0);
            return tb - ta;
          });
        setOcorrencias(lista);
        onOcorrenciasChange(lista);
    };
    // Fase 2 / Onda B — leitura do Supabase atrás de flag (read-only).
    if (guardProviderSupabase()) {
      carregarOcorrenciasSupabase({ limit: 10000 })
        .then(rows => { if (ativo) processar(rows.map((r: any) => ({ ...r, docId: r.id }))); })
        .catch(err => console.error('[GuardOverlay] Supabase', err));
      return () => { ativo = false; };
    }
    const q = query(collection(db, 'ocorrencias'));
    const unsub = onSnapshot(q,
      snap => {
        if (!ativo) return;
        processar(snap.docs.map(d => ({ docId: d.id, ...d.data(), id: d.id })));
      },
      err => { console.error('[GuardOverlay] Firestore error:', err.code, err.message); }
    );
    return () => { ativo = false; unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cidade, filtroDias, modoCustom, customDe, customAte]);

  useEffect(() => {
    if (!mapInstance) return;
    // Remove markers antigos
    guardMarkersRef.current.forEach(m => m.remove());
    guardMarkersRef.current = [];
    // Remove heatmap antigo
    if (heatLayerRef.current) { (mapInstance as any).removeLayer(heatLayerRef.current); heatLayerRef.current = null; }

    const filtradas = filtroTipo === 'TODOS' ? ocorrencias : ocorrencias.filter(o => o.tipo === filtroTipo);

    // ── Heatmap: carregar leaflet.heat dinamicamente se não estiver disponível
    if (showHeat) {
      const pts = filtradas
        .filter(o => o.lat_inicial && o.lng_inicial)
        .map(o => [Number(o.lat_inicial), Number(o.lng_inicial), 1.0]);

      const renderHeat = () => {
        if (pts.length && (L as any).heatLayer) {
          if (heatLayerRef.current) { (mapInstance as any).removeLayer(heatLayerRef.current); }
          heatLayerRef.current = (L as any).heatLayer(pts, {
            radius: 40, blur: 30, maxZoom: 17, max: 1.0,
            gradient: { 0.0: '#22c55e', 0.4: '#eab308', 0.6: '#f97316', 1.0: '#ef4444' },
          }).addTo(mapInstance);
        }
      };

      if ((L as any).heatLayer) {
        renderHeat();
      } else {
        // Carregar leaflet.heat dinamicamente
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js';
        script.onload = renderHeat;
        document.head.appendChild(script);
      }
    }

    // Scatter markers — ocultos no modo heatmap para não poluir
    filtradas.forEach(o => {
      const oLat = Number(o.lat_inicial ?? o.lat ?? o.latitude ?? 0);
      const oLng = Number(o.lng_inicial ?? o.lng ?? o.longitude ?? 0);
      if (!oLat || !oLng) return;
      const cor = GUARD_TIPO_COR[o.tipo] || '#6b7280';
      const marker = L.circleMarker([oLat, oLng], {
        radius: showHeat ? 4 : 10,
        color: cor, weight: showHeat ? 1 : 2,
        fillColor: cor,
        fillOpacity: showHeat ? 0.25 : 0.85,
      }).addTo(mapInstance);
      marker.bindPopup(
        '<div style="font-family:Inter,sans-serif;min-width:180px">' +
          '<div style="font-weight:700;font-size:14px;color:' + cor + ';margin-bottom:4px">' +
            (GUARD_TIPO_EMOJI[o.tipo] || '⚪') + ' ' + o.tipo +
          '</div>' +
          '<div style="font-size:12px;color:#444;margin-bottom:6px">' + (o.descricao || '') + '</div>' +
          '<div style="font-size:11px;color:#888">' +
            (o.asset_id ? 'Ativo: ' + o.asset_id + ' · ' : '') +
            (o.bairro_inicial || o.cidade_inicial || '') +
          '</div>' +
          '<div style="font-size:10px;color:#aaa;margin-top:4px">' +
            (o.registradoPorNome || '') + ' · ' + o.status +
            (o.bo_numero ? ' · BO ' + o.bo_numero : '') +
          '</div>' +
        '</div>'
      );
      marker.on('click', () => setSelecionada({ ...o, lat_inicial: oLat, lng_inicial: oLng }));
      guardMarkersRef.current.push(marker);
    });
    return () => {
      guardMarkersRef.current.forEach(m => m.remove());
      guardMarkersRef.current = [];
      if (heatLayerRef.current) { (mapInstance as any).removeLayer(heatLayerRef.current); heatLayerRef.current = null; }
    };
  }, [mapInstance, ocorrencias, filtroTipo, showHeat]);

  // Cidades únicas para chips
  const cidadesUnicas = [...new Set(
    ocorrencias.map(o => (o as any).cidade_inicial).filter(Boolean) as string[]
  )].sort().slice(0, 12);

  const filtradas = ocorrencias
    .filter(o => filtroTipo === 'TODOS' || o.tipo === filtroTipo)
    .filter(o => !filtroCidade || (o as any).cidade_inicial === filtroCidade)
    .filter(o => !buscaAtivo.trim() ||
      (o.asset_id || '').toLowerCase().includes(buscaAtivo.trim().toLowerCase()) ||
      (o.id || '').toLowerCase().includes(buscaAtivo.trim().toLowerCase())
    );
  const contagens: Record<string, number> = {};
  ocorrencias.forEach(o => { contagens[o.tipo] = (contagens[o.tipo] || 0) + 1; });

  // KPIs em tempo real
  const kpiAbertos    = ocorrencias.filter(o => o.status === 'Aberto' || o.status === 'Em apuracao').length;
  const kpiCriticos   = ocorrencias.filter(o => o.prioridade === 'Alta' || o.prioridade === 'Critica').length;
  const kpiProcurando = ocorrencias.filter(o => o.procurando === true).length;
  const kpiRoubos     = ocorrencias.filter(o => o.tipo === 'Roubo' || o.tipo === 'Furto').length;
  const kpiRecuperado = ocorrencias.filter(o => o.status === 'Recuperado').length;

  function fmtOc(ts: any): string {
    if (!ts) return '';
    const d: Date = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <>
      <div
        onTouchStart={(ev) => { (ev.currentTarget as any)._tx = ev.touches[0].clientX; }}
        onTouchEnd={(ev) => {
          const dx = ev.changedTouches[0].clientX - ((ev.currentTarget as any)._tx || 0);
          if (dx > 60) onFechar();
        }}
        style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 2500,
        width: '100%', maxWidth: window.innerWidth <= 500 ? '100vw' : 520,
        background: 'rgba(8,13,20,.97)', backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(167,139,250,.15)',
        display: 'flex', flexDirection: 'column', fontFamily: 'Inter,sans-serif',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 15 }}>🛡 Guard — Ocorrências</div>
            <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 11, marginTop: 2 }}>
              {filtradas.length} ocorrência{filtradas.length !== 1 ? 's' : ''} ·{' '}
              {modoCustom && customDe ? customDe + (customAte ? ' → ' + customAte : '') :
               filtroDias === 0 ? 'total' : filtroDias === 1 ? 'hoje' : 'últimos ' + filtroDias + 'd'}
            </div>
          </div>
          <button onClick={onFechar} style={{
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 8, color: 'rgba(255,255,255,.5)', padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* KPIs em tempo real */}
        <div style={{ display:'flex', gap:6, padding:'10px 12px',
          borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0, flexWrap:'wrap' }}>
          {[
            { label:'Abertos',    v: kpiAbertos,    cor:'#60a5fa', bg:'rgba(96,165,250,.1)'  },
            { label:'Críticos',   v: kpiCriticos,   cor:'#f97316', bg:'rgba(249,115,22,.1)'  },
            { label:'Procurando', v: kpiProcurando, cor:'#ef4444', bg:'rgba(239,68,68,.12)', bold: kpiProcurando > 0 },
            { label:'Roubos',     v: kpiRoubos,     cor:'#f87171', bg:'rgba(248,113,113,.08)' },
            { label:'Recuperado', v: kpiRecuperado, cor:'#4ade80', bg:'rgba(74,222,128,.08)'  },
          ].map(k => (
            <div key={k.label} style={{ flex:'1 1 auto', minWidth:56,
              background: k.bg, border:`1px solid ${k.cor}30`,
              borderRadius:8, padding:'6px 8px', textAlign:'center' }}>
              <div style={{ fontSize:16, fontWeight:800, color: k.cor,
                animation: k.bold ? 'pulse-kpi 1.5s infinite' : 'none' }}>{k.v}</div>
              <div style={{ fontSize:8, color:'rgba(255,255,255,.4)', marginTop:1 }}>{k.label}</div>
            </div>
          ))}
        </div>
        <style>{`@keyframes pulse-kpi{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

        {/* Filtro período */}
        <div style={{ flexShrink: 0 }}>
          {/* Botões rápidos */}
          <div style={{ padding: '8px 12px', display: 'flex', gap: 5, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            {([
              { label: 'Hoje',   d: 1  },
              { label: 'Ontem',  d: 2  },
              { label: '7d',     d: 7  },
              { label: '30d',    d: 30 },
              { label: 'Total',  d: 0  },
            ] as {label:string;d:number}[]).map(({ label, d }) => (
              <button key={d} onClick={() => { setFiltroDias(d); setModoCustom(false); }} style={{
                flex: 1, padding: '5px 0', borderRadius: 7, cursor: 'pointer', fontSize: 11,
                background: !modoCustom && filtroDias === d ? 'rgba(124,58,237,.25)' : 'rgba(255,255,255,.04)',
                border: '1px solid ' + (!modoCustom && filtroDias === d ? 'rgba(124,58,237,.5)' : 'rgba(255,255,255,.08)'),
                color: !modoCustom && filtroDias === d ? '#a78bfa' : 'rgba(255,255,255,.35)',
                fontWeight: !modoCustom && filtroDias === d ? 700 : 400,
              }}>{label}</button>
            ))}
            <button onClick={() => setModoCustom(v => !v)} style={{
              padding: '5px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 11,
              background: modoCustom ? 'rgba(124,58,237,.25)' : 'rgba(255,255,255,.04)',
              border: '1px solid ' + (modoCustom ? 'rgba(124,58,237,.5)' : 'rgba(255,255,255,.08)'),
              color: modoCustom ? '#a78bfa' : 'rgba(255,255,255,.35)',
            }}>📅</button>
          </div>
          {/* Custom date range */}
          {modoCustom && (
            <div style={{ padding: '8px 12px', display: 'flex', gap: 6, alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(124,58,237,.05)' }}>
              <input type="date" value={customDe} onChange={e => setCustomDe(e.target.value)} style={{
                flex: 1, padding: '5px 8px', borderRadius: 7, fontSize: 11,
                background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
                color: '#fff', outline: 'none',
              }} />
              <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 11 }}>→</span>
              <input type="date" value={customAte} onChange={e => setCustomAte(e.target.value)} style={{
                flex: 1, padding: '5px 8px', borderRadius: 7, fontSize: 11,
                background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.12)',
                color: '#fff', outline: 'none',
              }} />
            </div>
          )}
          {/* Gráfico tempo real — Hoje / Ontem / 7d / 30d / Total */}
          <GuardTrendChart ocorrencias={ocorrencias} />

          {/* Gráfico comparativo — todos os períodos lado a lado */}
          <GuardComparativoChart ocorrencias={ocorrencias} />

          {/* Toggle heatmap */}
          <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <button onClick={() => setShowHeat(v => !v)} style={{
              padding: '4px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 11,
              background: showHeat ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.04)',
              border: '1px solid ' + (showHeat ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.08)'),
              color: showHeat ? '#f87171' : 'rgba(255,255,255,.35)',
            }}>🔥 Heatmap</button>
            <span style={{ color: 'rgba(255,255,255,.2)', fontSize: 10 }}>
              {showHeat ? 'Mapa de calor ativo' : 'Ver concentração no mapa'}
            </span>
          </div>
        </div>

        {/* Busca por ativo */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
          <input
            value={buscaAtivo}
            onChange={e => setBuscaAtivo(e.target.value)}
            placeholder="🔍 Buscar ativo (S.123456, 283-649...)"
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8,
              background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
              color: '#fff', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const }}
          />
        </div>

        {/* Filtro tipo */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,.06)',
          display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' as any, flexShrink: 0 }}>
          <button onClick={() => setFiltroTipo('TODOS')} style={{
            padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
            background: filtroTipo === 'TODOS' ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.04)',
            color: filtroTipo === 'TODOS' ? '#fff' : 'rgba(255,255,255,.4)',
          }}>Todos ({ocorrencias.length})</button>
          {Object.keys(GUARD_TIPO_COR).map(t => contagens[t] ? (
            <button key={t} onClick={() => setFiltroTipo(t)} style={{
              padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap',
              background: filtroTipo === t ? GUARD_TIPO_COR[t] + '20' : 'rgba(255,255,255,.04)',
              color: filtroTipo === t ? GUARD_TIPO_COR[t] : 'rgba(255,255,255,.4)',
              border: '1px solid ' + (filtroTipo === t ? GUARD_TIPO_COR[t] + '40' : 'rgba(255,255,255,.06)'),
            }}>{GUARD_TIPO_EMOJI[t]} {t} ({contagens[t]})</button>
          ) : null)}
        </div>

        {/* Chips de cidade */}
        {cidadesUnicas.length > 1 && (
          <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,.06)',
            display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none' as any, flexShrink: 0 }}>
            <button onClick={() => setFiltroCidade('')} style={{
              padding: '4px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 10, whiteSpace: 'nowrap', fontWeight: 600,
              background: !filtroCidade ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.04)',
              color: !filtroCidade ? '#fff' : 'rgba(255,255,255,.35)',
            }}>🌎 Todas</button>
            {cidadesUnicas.map(c => (
              <button key={c} onClick={() => setFiltroCidade(c === filtroCidade ? '' : c)} style={{
                padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                fontSize: 10, whiteSpace: 'nowrap', fontWeight: 600,
                border: `1px solid ${filtroCidade === c ? 'rgba(96,165,250,.5)' : 'rgba(255,255,255,.07)'}`,
                background: filtroCidade === c ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.03)',
                color: filtroCidade === c ? '#60a5fa' : 'rgba(255,255,255,.4)',
              }}>{c}</button>
            ))}
          </div>
        )}

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any, scrollbarWidth: 'thin' as const }}>
          {filtradas.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '48px 24px', color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛡</div>
              <div style={{ fontSize: 13 }}>Nenhuma ocorrência no período</div>
            </div>
          ) : filtradas.map(o => (
            <div key={o.id}
              onClick={() => {
                setSelecionada(o);
                const cLat = Number(o.lat_inicial ?? o.lat ?? 0); const cLng = Number(o.lng_inicial ?? o.lng ?? 0);
                  if (mapInstance && cLat && cLng) mapInstance.setView([cLat, cLng], 17);
              }}
              style={{
                padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.05)',
                cursor: 'pointer',
                background: selecionada?.id === o.id ? 'rgba(124,58,237,.1)' : 'transparent',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{GUARD_TIPO_EMOJI[o.tipo] || '⚪'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ color: GUARD_TIPO_COR[o.tipo] || '#fff', fontWeight: 600, fontSize: 13 }}>{o.tipo}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 7px', borderRadius: 20,
                      background: (GUARD_STATUS_COR[o.status] || '#fff') + '15',
                      color: GUARD_STATUS_COR[o.status] || '#fff',
                    }}>{o.status}</span>
                    {o.bo_numero && <span style={{ fontSize: 10, color: '#eab308' }}>📋</span>}
                    {o.procurando && <span style={{ fontSize: 10, color: '#ef4444', fontWeight:700 }}>🔍</span>}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.descricao}</div>
                  <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 10, marginTop: 2 }}>
                    {fmtOc(o.criadoEm)} · {o.registradoPorNome} · {o.bairro_inicial || o.cidade_inicial || ''}
                  </div>
                </div>
                {(() => { const safe = sanitizarFotoUrl(o.foto1_url); return safe ? (
                  <img
                    src={safe}
                    alt=""
                    style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flexShrink: 0,
                      border: '1px solid rgba(255,255,255,.1)' }}
                    onError={ev => { ev.currentTarget.style.display = 'none'; }}
                  />
                ) : null; })()}
              </div>
            </div>
          ))}
        </div>

        {/* Detalhe selecionado */}
        {selecionada && (
          <div style={{ borderTop: '1px solid rgba(167,139,250,.2)', background: 'rgba(124,58,237,.08)',
            padding: '14px 16px', overflowY: 'auto', maxHeight: '50vh',
            WebkitOverflowScrolling: 'touch' as any,
            scrollbarWidth: 'thin' as const }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: GUARD_TIPO_COR[selecionada.tipo] || '#fff', fontWeight: 700, fontSize: 14 }}>
                {GUARD_TIPO_EMOJI[selecionada.tipo]} {selecionada.tipo}
              </span>
              <button onClick={() => setSelecionada(null)} style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontSize: 16, cursor: 'pointer',
              }}>✕</button>
            </div>
            <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 13, marginBottom: 8 }}>{selecionada.descricao}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, marginBottom: 8 }}>
              {([
                ['Ativo',      selecionada.asset_id || '—'],
                ['Prioridade', selecionada.prioridade || '—'],
                ['Turno',      selecionada.turno],
                ['Guard',      selecionada.registradoPorNome],
                [t('drawer.status'),     selecionada.status],
                ['BO',         selecionada.bo_numero || '—'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 6, padding: '6px 8px' }}>
                  <div style={{ color: 'rgba(255,255,255,.3)', fontSize: 10 }}>{k}</div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
            {selecionada.observacao_fechamento && (
              <div style={{
                background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.15)',
                borderRadius: 8, padding: '8px 10px', marginBottom: 8,
              }}>
                <div style={{ color: '#22c55e', fontSize: 10, marginBottom: 3 }}>Observação</div>
                <div style={{ color: 'rgba(255,255,255,.6)', fontSize: 12 }}>{selecionada.observacao_fechamento}</div>
              </div>
            )}
            {[selecionada.foto1_url, selecionada.foto2_url].some(u => sanitizarFotoUrl(u)) && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[selecionada.foto1_url, selecionada.foto2_url].map((url: string|undefined, i: number) => {
                  const safe = sanitizarFotoUrl(url);
                  if (!safe) return null;
                  return (
                    <a key={i} href={safe} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                      <img src={safe} alt=""
                        style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 8 }}
                        onError={ev => { ev.currentTarget.style.display = 'none'; }} />
                    </a>
                  );
                })}
              </div>
            )}
            {selecionada.bo_url && (
              <a href={selecionada.bo_url} target="_blank" rel="noreferrer" style={{
                display: 'block', color: '#eab308', fontSize: 12, marginBottom: 8, textDecoration: 'none',
              }}>📋 Ver imagem do Boletim ↗</a>
            )}
            <button onClick={() => setEditModal(selecionada)} style={{
              width: '100%', padding: '9px', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(124,58,237,.2)', border: '1px solid rgba(124,58,237,.4)',
              color: '#a78bfa', fontSize: 13, fontWeight: 600,
            }}>✏️ Editar / Resolver</button>
          </div>
        )}
      </div>

      {editModal && (
        <GuardEditModal
          ocorrencia={editModal}
          usuario={usuario}
          onFechar={() => setEditModal(null)}
          onSalvo={() => { setEditModal(null); setSelecionada(null); }}
        />
      )}
    </>
  );
}
