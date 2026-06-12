// src/pages/CadastroTelegram.tsx
import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { auth, db } from '@/lib/firebase';

export default function CadastroTelegram() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    nome: '',
    telegramId: '',
    telegramUsername: '',
    role: 'campo',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validações
      if (!formData.email || !formData.password || !formData.nome || !formData.telegramId) {
        toast.error('Preencha todos os campos obrigatórios');
        setLoading(false);
        return;
      }

      if (formData.password !== formData.confirmPassword) {
        toast.error('As senhas não coincidem');
        setLoading(false);
        return;
      }

      if (formData.password.length < 6) {
        toast.error('A senha deve ter no mínimo 6 caracteres');
        setLoading(false);
        return;
      }

      if (!/^\d+$/.test(formData.telegramId)) {
        toast.error('Telegram ID deve ser apenas números');
        setLoading(false);
        return;
      }

      // Criar usuário no Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );

      const uid = userCredential.user.uid;

      // Salvar dados no Firestore
      await setDoc(doc(db, 'usuarios', uid), {
        uid,
        email: formData.email,
        nome: formData.nome,
        role: formData.role,
        ativo: true,
        telegramId: parseInt(formData.telegramId),
        telegramUsername: formData.telegramUsername || null,
        criadoEm: new Date().toISOString(),
      });

      // Salvar também em prestadores (para geolocalização)
      await setDoc(doc(db, 'prestadores', uid), {
        uid,
        email: formData.email,
        nome: formData.nome,
        telegramId: parseInt(formData.telegramId),
        telegramUsername: formData.telegramUsername || null,
        ativo: true,
        criadoEm: new Date().toISOString(),
      });

      toast.success('Cadastro realizado com sucesso!');
      setTimeout(() => navigate('/'), 1500);
    } catch (error: any) {
      const errorMessage = error.message || 'Erro ao cadastrar';
      if (error.code === 'auth/email-already-in-use') {
        toast.error('Este email já está cadastrado');
      } else if (error.code === 'auth/invalid-email') {
        toast.error('Email inválido');
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block p-3 bg-blue-500 rounded-lg mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">JET OS</h1>
          <p className="text-slate-400">Cadastro - Sistema de Estações</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl shadow-2xl p-6 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Nome Completo *
            </label>
            <input
              type="text"
              name="nome"
              value={formData.nome}
              onChange={handleChange}
              placeholder="Seu nome"
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Email *
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="seu@email.com"
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />
          </div>

          {/* Telegram ID */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Telegram ID * <span className="text-xs text-slate-400">(números apenas)</span>
            </label>
            <input
              type="text"
              name="telegramId"
              value={formData.telegramId}
              onChange={handleChange}
              placeholder="123456789"
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />
            <p className="text-xs text-slate-500 mt-1">
              Abra @userinfobot no Telegram para descobrir seu ID
            </p>
          </div>

          {/* Telegram Username */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Username Telegram <span className="text-xs text-slate-400">(opcional, sem @)</span>
            </label>
            <input
              type="text"
              name="telegramUsername"
              value={formData.telegramUsername}
              onChange={handleChange}
              placeholder="seu_username"
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Função *
            </label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:border-blue-500 focus:outline-none"
              disabled={loading}
            >
              <option value="campo">Campo (Operacional)</option>
              <option value="guard">Segurança (Guard)</option>
              <option value="gestor">Gestor</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Senha *
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-300"
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">Mínimo 6 caracteres</p>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Confirmar Senha *
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="••••••••"
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-semibold py-2 px-4 rounded-lg transition duration-200 mt-6"
          >
            {loading ? 'Cadastrando...' : 'Criar Conta'}
          </button>

          {/* Info */}
          <div className="bg-blue-900 bg-opacity-50 border border-blue-700 rounded-lg p-3 text-sm text-blue-200">
            <p className="font-semibold mb-1">📱 Como pegar seu Telegram ID:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Abra o Telegram</li>
              <li>Procure por <span className="font-mono">@userinfobot</span></li>
              <li>Clique em "Start"</li>
              <li>Seu ID aparecerá (apenas números)</li>
            </ol>
          </div>
        </form>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          Já tem conta? Entre em contato com o administrador
        </p>
      </div>
    </div>
  );
}
