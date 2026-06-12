// src/pages/AdminTelegramPanel.tsx
import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import toast from 'react-hot-toast';

interface GrupoTelegram {
  id: string;
  nome: string;
  chatId: string;
  tipo: 'zona' | 'cidade' | 'geral';
  ativo: boolean;
  criadoEm?: any;
}

interface GestorInfo {
  id: string;
  nome: string;
  email: string;
  telegramId: string;
  telegramUsername?: string;
  zona?: string;
  ativo: boolean;
}

export default function AdminTelegramPanel() {
  const [grupos, setGrupos] = useState<GrupoTelegram[]>([]);
  const [gestores, setGestores] = useState<GestorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'grupos' | 'gestores'>('grupos');

  useEffect(() => {
    carregarDados();
  }, []);

  const carregarDados = async () => {
    try {
      setLoading(true);

      // Carregar grupos Telegram
      const gruposSnap = await getDocs(collection(db, 'gruposTelegram'));
      const gruposData: GrupoTelegram[] = [];
      gruposSnap.forEach((doc) => {
        gruposData.push({ id: doc.id, ...doc.data() } as GrupoTelegram);
      });
      setGrupos(gruposData);

      // Carregar gestores
      const gestoresSnap = await getDocs(
        query(collection(db, 'usuarios'), where('role', 'in', ['gestor', 'admin']))
      );
      const gestoresData: GestorInfo[] = [];
      gestoresSnap.forEach((doc) => {
        gestoresData.push({ id: doc.id, ...doc.data() } as GestorInfo);
      });
      setGestores(gestoresData);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  const toggleGrupoAtivo = async (grupoId: string, ativoAtual: boolean) => {
    try {
      await updateDoc(doc(db, 'gruposTelegram', grupoId), {
        ativo: !ativoAtual,
      });
      setGrupos(
        grupos.map((g) => (g.id === grupoId ? { ...g, ativo: !g.ativo } : g))
      );
      toast.success('Grupo atualizado');
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao atualizar grupo');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Admin Telegram</h1>
          <p className="text-slate-400">Gerenciar grupos e gestores</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('grupos')}
            className={`px-4 py-2 font-semibold transition ${
              activeTab === 'grupos'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Grupos Telegram
          </button>
          <button
            onClick={() => setActiveTab('gestores')}
            className={`px-4 py-2 font-semibold transition ${
              activeTab === 'gestores'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Gestores
          </button>
        </div>

        {/* Loading */}
        {loading ? (
          <div className="text-center text-slate-400">Carregando...</div>
        ) : (
          <>
            {/* Grupos Tab */}
            {activeTab === 'grupos' && (
              <div className="space-y-4">
                <div className="text-sm text-slate-400 mb-4">
                  Total: {grupos.length} grupos
                </div>
                {grupos.length === 0 ? (
                  <div className="text-center text-slate-500 py-8">
                    Nenhum grupo cadastrado
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {grupos.map((grupo) => (
                      <div
                        key={grupo.id}
                        className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-white font-semibold">
                              {grupo.nome}
                            </h3>
                            <p className="text-slate-400 text-sm mt-1">
                              ID: {grupo.chatId}
                            </p>
                            <p className="text-slate-400 text-sm">
                              Tipo: {grupo.tipo}
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              toggleGrupoAtivo(grupo.id, grupo.ativo)
                            }
                            className={`px-4 py-2 rounded font-semibold transition ${
                              grupo.ativo
                                ? 'bg-green-600 hover:bg-green-700 text-white'
                                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                            }`}
                          >
                            {grupo.ativo ? 'Ativo' : 'Inativo'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Gestores Tab */}
            {activeTab === 'gestores' && (
              <div className="space-y-4">
                <div className="text-sm text-slate-400 mb-4">
                  Total: {gestores.length} gestores
                </div>
                {gestores.length === 0 ? (
                  <div className="text-center text-slate-500 py-8">
                    Nenhum gestor cadastrado
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {gestores.map((gestor) => (
                      <div
                        key={gestor.id}
                        className="bg-slate-800 rounded-lg p-4 border border-slate-700 hover:border-slate-600 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-white font-semibold">
                              {gestor.nome}
                            </h3>
                            <p className="text-slate-400 text-sm mt-1">
                              Email: {gestor.email}
                            </p>
                            <p className="text-slate-400 text-sm">
                              Telegram ID: {gestor.telegramId}
                            </p>
                            {gestor.telegramUsername && (
                              <p className="text-slate-400 text-sm">
                                @{gestor.telegramUsername}
                              </p>
                            )}
                            {gestor.zona && (
                              <p className="text-slate-400 text-sm">
                                Zona: {gestor.zona}
                              </p>
                            )}
                          </div>
                          <div
                            className={`px-4 py-2 rounded font-semibold ${
                              gestor.ativo
                                ? 'bg-green-600 text-white'
                                : 'bg-red-600 text-white'
                            }`}
                          >
                            {gestor.ativo ? 'Ativo' : 'Inativo'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-slate-500 text-sm">
          <p>Admin Panel - Gerenciar Telegram e Gestores</p>
        </div>
      </div>
    </div>
  );
}
