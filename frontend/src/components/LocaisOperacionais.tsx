// src/components/LocaisOperacionais.tsx
// Locais operacionais: Base de Carga, Centro de Serviço, Depósito, Ponto de Redistribuição

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, where, serverTimestamp
} from 'firebase/firestore';
import { comprimirImagem } from '../lib/imageUtils';

// ── I18N (padrão objeto T, sem json) ─────────────────────────────
type Lang = 'pt' | 'en' | 'es' | 'ru';
type Tr = { pt: string; en: string; es: string; ru: string };

const T = {
  editarLocal:        { pt: 'Editar local', en: 'Edit location', es: 'Editar ubicación', ru: 'Изменить место' },
  novoLocal:          { pt: 'Novo local operacional', en: 'New operational location', es: 'Nueva ubicación operativa', ru: 'Новое рабочее место' },
  tipoDeLocal:        { pt: 'Tipo de local', en: 'Location type', es: 'Tipo de ubicación', ru: 'Тип места' },
  nome:               { pt: 'Nome *', en: 'Name *', es: 'Nombre *', ru: 'Название *' },
  exNome:             { pt: 'Ex: {label} Centro', en: 'E.g.: {label} Downtown', es: 'Ej.: {label} Centro', ru: 'Напр.: {label} Центр' },
  endereco:           { pt: 'Endereço', en: 'Address', es: 'Dirección', ru: 'Адрес' },
  enderecoCompleto:   { pt: 'Endereço completo', en: 'Full address', es: 'Dirección completa', ru: 'Полный адрес' },
  fotoDoLocal:        { pt: 'Foto do local', en: 'Location photo', es: 'Foto de la ubicación', ru: 'Фото места' },
  alterarFoto:        { pt: 'Alterar foto', en: 'Change photo', es: 'Cambiar foto', ru: 'Изменить фото' },
  adicionarFoto:      { pt: 'Adicionar foto', en: 'Add photo', es: 'Agregar foto', ru: 'Добавить фото' },
  removerFoto:        { pt: 'Remover foto', en: 'Remove photo', es: 'Eliminar foto', ru: 'Удалить фото' },
  capacidade:         { pt: 'Capacidade (pat.)', en: 'Capacity (scooters)', es: 'Capacidad (pat.)', ru: 'Вместимость (самок.)' },
  exCapacidade:       { pt: 'ex: 50', en: 'e.g.: 50', es: 'ej.: 50', ru: 'напр.: 50' },
  horario:            { pt: 'Horário', en: 'Hours', es: 'Horario', ru: 'Часы работы' },
  responsavel:        { pt: 'Responsável', en: 'Manager', es: 'Responsable', ru: 'Ответственный' },
  nomePh:             { pt: 'Nome', en: 'Name', es: 'Nombre', ru: 'Имя' },
  telefone:           { pt: 'Telefone', en: 'Phone', es: 'Teléfono', ru: 'Телефон' },
  observacoes:        { pt: 'Observações', en: 'Notes', es: 'Observaciones', ru: 'Примечания' },
  infoAdicionais:     { pt: 'Informações adicionais...', en: 'Additional information...', es: 'Información adicional...', ru: 'Дополнительная информация...' },
  localAtivo:         { pt: 'Local ativo', en: 'Active location', es: 'Ubicación activa', ru: 'Место активно' },
  cancelar:           { pt: 'Cancelar', en: 'Cancel', es: 'Cancelar', ru: 'Отмена' },
  salvando:           { pt: 'Salvando...', en: 'Saving...', es: 'Guardando...', ru: 'Сохранение...' },
  salvar:             { pt: 'Salvar', en: 'Save', es: 'Guardar', ru: 'Сохранить' },
  adicionar:          { pt: 'Adicionar', en: 'Add', es: 'Agregar', ru: 'Добавить' },
  informeNome:        { pt: 'Informe o nome do local', en: 'Enter the location name', es: 'Ingrese el nombre de la ubicación', ru: 'Укажите название места' },
  localAtualizado:    { pt: 'Local atualizado', en: 'Location updated', es: 'Ubicación actualizada', ru: 'Место обновлено' },
  localAdicionado:    { pt: 'Local adicionado', en: 'Location added', es: 'Ubicación agregada', ru: 'Место добавлено' },
  erro:               { pt: 'Erro: ', en: 'Error: ', es: 'Error: ', ru: 'Ошибка: ' },
  confirmExcluir:     { pt: 'Excluir "{nome}"?', en: 'Delete "{nome}"?', es: '¿Eliminar "{nome}"?', ru: 'Удалить «{nome}»?' },
  localRemovido:      { pt: 'Local removido', en: 'Location removed', es: 'Ubicación eliminada', ru: 'Место удалено' },
} satisfies Record<string, Tr>;

// Rótulos de tipo para exibição (TIPO_LOCAL_META.label permanece PT como dado canônico)
const TIPO_LABELS: Record<TipoLocal, Tr> = {
  BASE_CARGA:           { pt: 'Base de Carga', en: 'Charging Base', es: 'Base de Carga', ru: 'База зарядки' },
  CENTRO_SERVICO:       { pt: 'Centro de Serviço', en: 'Service Center', es: 'Centro de Servicio', ru: 'Сервисный центр' },
  DEPOSITO:             { pt: 'Depósito', en: 'Warehouse', es: 'Depósito', ru: 'Склад' },
  PONTO_REDISTRIBUICAO: { pt: 'Redistribuição', en: 'Redistribution', es: 'Redistribución', ru: 'Перераспределение' },
};

// ── TIPOS ────────────────────────────────────────────────────────
export type TipoLocal =
  | 'BASE_CARGA'
  | 'CENTRO_SERVICO'
  | 'DEPOSITO'
  | 'PONTO_REDISTRIBUICAO';

export interface LocalOperacional {
  id: string;
  tipo: TipoLocal;
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  cidade: string;
  pais: string;
  capacidade?: number;     // patinetes
  responsavel?: string;
  telefone?: string;
  horario?: string;        // "08:00–18:00"
  obs?: string;
  foto?: string;           // URL da foto
  ativo: boolean;
  criadoEm?: any;
  atualizadoEm?: any;
}

// ── META DOS TIPOS ────────────────────────────────────────────────
export const TIPO_LOCAL_META: Record<TipoLocal, {
  icon: string; label: string; color: string; bgColor: string;
}> = {
  BASE_CARGA: {
    icon: '⚡',
    label: 'Base de Carga',
    color: '#facc15',
    bgColor: 'rgba(250,204,21,.15)',
  },
  CENTRO_SERVICO: {
    icon: '🔧',
    label: 'Centro de Serviço',
    color: '#60a5fa',
    bgColor: 'rgba(96,165,250,.15)',
  },
  DEPOSITO: {
    icon: '🏭',
    label: 'Depósito',
    color: '#a78bfa',
    bgColor: 'rgba(167,139,250,.15)',
  },
  PONTO_REDISTRIBUICAO: {
    icon: '🔄',
    label: 'Redistribuição',
    color: '#34d399',
    bgColor: 'rgba(52,211,153,.15)',
  },
};

// ── HOOK ──────────────────────────────────────────────────────────
export function useLocaisOperacionais(cidade: string, pais: string) {
  const [locais, setLocais] = useState<LocalOperacional[]>([]);

  useEffect(() => {
    if (!cidade) return;
    const q = query(
      collection(db, 'locais_operacionais'),
      where('cidade', '==', cidade),
      where('pais', '==', pais)
    );
    const unsub = onSnapshot(q, snap => {
      setLocais(snap.docs.map(d => ({ id: d.id, ...d.data() } as LocalOperacional)));
    });
    return () => unsub();
  }, [cidade, pais]);

  return locais;
}

// ── MODAL CADASTRO/EDIÇÃO ─────────────────────────────────────────
export function LocalOperacionalModal({
  latLng,
  cidade,
  pais,
  editando,
  onFechar,
  showToast,
}: {
  latLng: { lat: number; lng: number };
  cidade: string;
  pais: string;
  editando?: LocalOperacional | null;
  onFechar: () => void;
  showToast: (msg: string, type?: string) => void;
}) {
  const [tipo, setTipo]           = useState<TipoLocal>(editando?.tipo || 'BASE_CARGA');
  const [nome, setNome]           = useState(editando?.nome || '');
  const [endereco, setEndereco]   = useState(editando?.endereco || '');
  const [capacidade, setCapacidade] = useState(String(editando?.capacidade || ''));
  const [responsavel, setResponsavel] = useState(editando?.responsavel || '');
  const [telefone, setTelefone]   = useState(editando?.telefone || '');
  const [horario, setHorario]     = useState(editando?.horario || '');
  const [obs, setObs]             = useState(editando?.obs || '');
  const [foto, setFoto]           = useState(editando?.foto || '');
  const [fotoPreview, setFotoPreview] = useState(editando?.foto || '');
  const [ativo, setAtivo]         = useState(editando?.ativo ?? true);
  const [busy, setBusy]           = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { i18n } = useTranslation();
  const lang = ((i18n.language || 'pt').slice(0, 2)) as Lang;
  const pick = (o: Tr) => o[lang] ?? o.pt;

  // Geocode reverso para preencher endereço
  useEffect(() => {
    if (editando?.endereco || endereco) return;
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latLng.lat}&lon=${latLng.lng}&format=json&accept-language=pt-BR`)
      .then(r => r.json())
      .then(d => { if (d.display_name) setEndereco(d.display_name); })
      .catch(() => {});
  }, []);

  // Handle foto upload — compressão HEIC-safe (ver lib/imageUtils).
  // Converte HEIC→JPEG antes de comprimir, evitando o bug de foto "quebrada"
  // (HEIC enviado como .jpg que o WebView não renderiza).
  const handleFotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const compressed = await comprimirImagem(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setFoto(base64);
        setFotoPreview(base64);
      };
      reader.readAsDataURL(compressed);
    } catch (err) {
      console.error('[LocaisOp] compressão falhou:', err);
    }
  };

  const salvar = async () => {
    if (!nome.trim()) { showToast(pick(T.informeNome), 'error'); return; }
    setBusy(true);
    try {
      const raw: Record<string,any> = {
        tipo, nome: nome.trim(), endereco, lat: latLng.lat, lng: latLng.lng,
        cidade, pais, ativo, atualizadoEm: serverTimestamp(),
      };
      if (capacidade)  raw.capacidade  = Number(capacidade);
      if (responsavel) raw.responsavel = responsavel;
      if (telefone)    raw.telefone    = telefone;
      if (horario)     raw.horario     = horario;
      if (obs)         raw.obs         = obs;
      if (foto)        raw.foto        = foto;
      const payload = raw as Omit<LocalOperacional, 'id'>;
      if (editando) {
        await updateDoc(doc(db, 'locais_operacionais', editando.id), payload as any);
        showToast(pick(T.localAtualizado), 'success');
      } else {
        await addDoc(collection(db, 'locais_operacionais'), {
          ...payload, criadoEm: serverTimestamp()
        });
        showToast(pick(T.localAdicionado), 'success');
      }
      onFechar();
    } catch (e: any) {
      showToast(pick(T.erro) + e.message, 'error');
    }
    setBusy(false);
  };

  const excluir = async () => {
    if (!editando || !confirm(pick(T.confirmExcluir).replace('{nome}', editando.nome))) return;
    await deleteDoc(doc(db, 'locais_operacionais', editando.id));
    showToast(pick(T.localRemovido), 'success');
    onFechar();
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none',
    fontFamily: 'inherit',
  };
  const lbl: React.CSSProperties = {
    fontSize: 11, color: 'rgba(255,255,255,.5)',
    marginBottom: 4, display: 'block',
  };

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 420,
      background: 'rgba(13,18,30,.97)', backdropFilter: 'blur(16px)',
      borderLeft: '1px solid rgba(255,255,255,.08)', zIndex: 500,
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
            {editando ? pick(T.editarLocal) : pick(T.novoLocal)}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
            {latLng.lat.toFixed(5)}, {latLng.lng.toFixed(5)}
          </div>
        </div>
        <button onClick={onFechar} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.4)', cursor: 'pointer', fontSize: 20 }}>✕</button>
      </div>

      {/* Form */}
      <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>

        {/* Tipo */}
        <div>
          <label style={lbl}>{pick(T.tipoDeLocal)}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(Object.keys(TIPO_LOCAL_META) as TipoLocal[]).map(t => {
              const m = TIPO_LOCAL_META[t];
              return (
                <button key={t} onClick={() => setTipo(t)} style={{
                  padding: '10px 8px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${tipo === t ? m.color + '88' : 'rgba(255,255,255,.08)'}`,
                  background: tipo === t ? m.bgColor : 'rgba(255,255,255,.03)',
                  color: tipo === t ? m.color : 'rgba(255,255,255,.4)',
                  fontSize: 12, fontWeight: tipo === t ? 700 : 400,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 16 }}>{m.icon}</span> {pick(TIPO_LABELS[t])}
                </button>
              );
            })}
          </div>
        </div>

        {/* Nome */}
        <div>
          <label style={lbl}>{pick(T.nome)}</label>
          <input value={nome} onChange={e => setNome(e.target.value)}
            placeholder={pick(T.exNome).replace('{label}', pick(TIPO_LABELS[tipo]))}
            style={inp} />
        </div>

        {/* Endereço */}
        <div>
          <label style={lbl}>{pick(T.endereco)}</label>
          <input value={endereco} onChange={e => setEndereco(e.target.value)}
            placeholder={pick(T.enderecoCompleto)} style={inp} />
        </div>

        {/* Foto */}
        <div>
          <label style={lbl}>{pick(T.fotoDoLocal)}</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFotoChange}
            style={{ display: 'none' }}
          />
          {fotoPreview && (
            <div style={{ marginBottom: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)' }}>
              <img src={fotoPreview} alt="Preview" style={{ width: '100%', height: 200, objectFit: 'cover' }} />
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '100%', padding: '10px 12px',
              background: 'rgba(96,165,250,.1)', border: '1px solid rgba(96,165,250,.3)',
              borderRadius: 8, color: '#60a5fa', fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            📷 {fotoPreview ? pick(T.alterarFoto) : pick(T.adicionarFoto)}
          </button>
          {fotoPreview && (
            <button
              onClick={() => { setFoto(''); setFotoPreview(''); }}
              style={{
                width: '100%', padding: '8px 12px', marginTop: 6,
                background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
                borderRadius: 8, color: '#ef4444', fontSize: 12, cursor: 'pointer',
              }}>
              {pick(T.removerFoto)}
            </button>
          )}
        </div>

        {/* Capacidade + Horário */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>{pick(T.capacidade)}</label>
            <input type="number" value={capacidade} onChange={e => setCapacidade(e.target.value)}
              placeholder={pick(T.exCapacidade)} style={inp} />
          </div>
          <div>
            <label style={lbl}>{pick(T.horario)}</label>
            <input value={horario} onChange={e => setHorario(e.target.value)}
              placeholder="08:00–18:00" style={inp} />
          </div>
        </div>

        {/* Responsável + Telefone */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>{pick(T.responsavel)}</label>
            <input value={responsavel} onChange={e => setResponsavel(e.target.value)}
              placeholder={pick(T.nomePh)} style={inp} />
          </div>
          <div>
            <label style={lbl}>{pick(T.telefone)}</label>
            <input value={telefone} onChange={e => setTelefone(e.target.value)}
              placeholder="(11) 9xxxx-xxxx" style={inp} />
          </div>
        </div>

        {/* Obs */}
        <div>
          <label style={lbl}>{pick(T.observacoes)}</label>
          <textarea value={obs} onChange={e => setObs(e.target.value)}
            rows={3} placeholder={pick(T.infoAdicionais)}
            style={{ ...inp, resize: 'vertical', minHeight: 72 }} />
        </div>

        {/* Ativo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }} />
          <label style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', cursor: 'pointer' }}
            onClick={() => setAtivo(v => !v)}>
            {pick(T.localAtivo)}
          </label>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', gap: 8, flexShrink: 0 }}>
        {editando && (
          <button onClick={excluir} style={{
            padding: '11px 14px', borderRadius: 10,
            border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)',
            color: '#ef4444', cursor: 'pointer', fontSize: 13,
          }}>🗑</button>
        )}
        <button onClick={onFechar} style={{
          flex: 1, padding: '11px', borderRadius: 10,
          border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)',
          color: 'rgba(255,255,255,.5)', fontSize: 13, cursor: 'pointer',
        }}>{pick(T.cancelar)}</button>
        <button onClick={salvar} disabled={busy} style={{
          flex: 2, padding: '11px', borderRadius: 10, border: 'none',
          background: busy ? 'rgba(96,165,250,.3)' : 'linear-gradient(135deg,#1a6fd4,#307FE2)',
          color: '#fff', fontSize: 13, fontWeight: 700,
          cursor: busy ? 'not-allowed' : 'pointer',
        }}>
          {busy ? pick(T.salvando) : editando ? pick(T.salvar) : pick(T.adicionar)}
        </button>
      </div>
    </div>
  );
}
