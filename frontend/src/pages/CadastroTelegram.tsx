// src/pages/CadastroTelegram.tsx
import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { auth, db } from '@/lib/firebase';

const T = {
  subtitle: { pt: 'Cadastro - Sistema de Estações', en: 'Sign Up - Stations System', es: 'Registro - Sistema de Estaciones', ru: 'Регистрация - Система станций' },
  fillRequired: { pt: 'Preencha todos os campos obrigatórios', en: 'Fill in all required fields', es: 'Complete todos los campos obligatorios', ru: 'Заполните все обязательные поля' },
  passwordsMismatch: { pt: 'As senhas não coincidem', en: 'Passwords do not match', es: 'Las contraseñas no coinciden', ru: 'Пароли не совпадают' },
  passwordMin: { pt: 'A senha deve ter no mínimo 6 caracteres', en: 'Password must be at least 6 characters', es: 'La contraseña debe tener al menos 6 caracteres', ru: 'Пароль должен содержать не менее 6 символов' },
  telegramOnlyNumbers: { pt: 'Telegram ID deve ser apenas números', en: 'Telegram ID must be numbers only', es: 'El Telegram ID debe ser solo números', ru: 'Telegram ID должен содержать только цифры' },
  signupSuccess: { pt: 'Cadastro realizado com sucesso!', en: 'Sign up completed successfully!', es: '¡Registro realizado con éxito!', ru: 'Регистрация успешно завершена!' },
  errorSignup: { pt: 'Erro ao cadastrar', en: 'Error signing up', es: 'Error al registrarse', ru: 'Ошибка при регистрации' },
  emailAlreadyUsed: { pt: 'Este email já está cadastrado', en: 'This email is already registered', es: 'Este correo ya está registrado', ru: 'Эта электронная почта уже зарегистрирована' },
  invalidEmail: { pt: 'Email inválido', en: 'Invalid email', es: 'Correo inválido', ru: 'Неверная электронная почта' },
  fullName: { pt: 'Nome Completo *', en: 'Full Name *', es: 'Nombre Completo *', ru: 'Полное имя *' },
  fullNamePlaceholder: { pt: 'Seu nome', en: 'Your name', es: 'Tu nombre', ru: 'Ваше имя' },
  email: { pt: 'Email *', en: 'Email *', es: 'Correo *', ru: 'Электронная почта *' },
  telegramId: { pt: 'Telegram ID *', en: 'Telegram ID *', es: 'Telegram ID *', ru: 'Telegram ID *' },
  numbersOnly: { pt: '(números apenas)', en: '(numbers only)', es: '(solo números)', ru: '(только цифры)' },
  telegramIdHint: { pt: 'Abra @userinfobot no Telegram para descobrir seu ID', en: 'Open @userinfobot on Telegram to find your ID', es: 'Abre @userinfobot en Telegram para descubrir tu ID', ru: 'Откройте @userinfobot в Telegram, чтобы узнать свой ID' },
  telegramUsername: { pt: 'Username Telegram', en: 'Telegram Username', es: 'Username de Telegram', ru: 'Имя пользователя Telegram' },
  optionalNoAt: { pt: '(opcional, sem @)', en: '(optional, without @)', es: '(opcional, sin @)', ru: '(необязательно, без @)' },
  usernamePlaceholder: { pt: 'seu_username', en: 'your_username', es: 'tu_username', ru: 'ваше_имя_пользователя' },
  role: { pt: 'Função *', en: 'Role *', es: 'Función *', ru: 'Роль *' },
  roleCampo: { pt: 'Campo (Operacional)', en: 'Field (Operational)', es: 'Campo (Operacional)', ru: 'Поле (Операционный)' },
  roleGuard: { pt: 'Segurança (Guard)', en: 'Security (Guard)', es: 'Seguridad (Guard)', ru: 'Охрана (Guard)' },
  roleGestor: { pt: 'Gestor', en: 'Manager', es: 'Gerente', ru: 'Менеджер' },
  roleAdmin: { pt: 'Admin', en: 'Admin', es: 'Admin', ru: 'Админ' },
  password: { pt: 'Senha *', en: 'Password *', es: 'Contraseña *', ru: 'Пароль *' },
  passwordMinHint: { pt: 'Mínimo 6 caracteres', en: 'Minimum 6 characters', es: 'Mínimo 6 caracteres', ru: 'Минимум 6 символов' },
  confirmPassword: { pt: 'Confirmar Senha *', en: 'Confirm Password *', es: 'Confirmar Contraseña *', ru: 'Подтвердите пароль *' },
  creating: { pt: 'Cadastrando...', en: 'Signing up...', es: 'Registrando...', ru: 'Регистрация...' },
  createAccount: { pt: 'Criar Conta', en: 'Create Account', es: 'Crear Cuenta', ru: 'Создать аккаунт' },
  howToGetId: { pt: '📱 Como pegar seu Telegram ID:', en: '📱 How to get your Telegram ID:', es: '📱 Cómo obtener tu Telegram ID:', ru: '📱 Как получить свой Telegram ID:' },
  step1: { pt: 'Abra o Telegram', en: 'Open Telegram', es: 'Abre Telegram', ru: 'Откройте Telegram' },
  step2Prefix: { pt: 'Procure por', en: 'Search for', es: 'Busca', ru: 'Найдите' },
  step3: { pt: 'Clique em "Start"', en: 'Click "Start"', es: 'Haz clic en "Start"', ru: 'Нажмите «Start»' },
  step4: { pt: 'Seu ID aparecerá (apenas números)', en: 'Your ID will appear (numbers only)', es: 'Tu ID aparecerá (solo números)', ru: 'Появится ваш ID (только цифры)' },
  footer: { pt: 'Já tem conta? Entre em contato com o administrador', en: 'Already have an account? Contact the administrator', es: '¿Ya tienes cuenta? Contacta al administrador', ru: 'Уже есть аккаунт? Свяжитесь с администратором' },
};

export default function CadastroTelegram() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const lang = (((i18n.language || 'pt').slice(0, 2)) as 'pt' | 'en' | 'es' | 'ru');
  const pick = (o: { pt: string; en: string; es: string; ru: string }) => o[lang] ?? o.pt;
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
        toast.error(pick(T.fillRequired));
        setLoading(false);
        return;
      }

      if (formData.password !== formData.confirmPassword) {
        toast.error(pick(T.passwordsMismatch));
        setLoading(false);
        return;
      }

      if (formData.password.length < 6) {
        toast.error(pick(T.passwordMin));
        setLoading(false);
        return;
      }

      if (!/^\d+$/.test(formData.telegramId)) {
        toast.error(pick(T.telegramOnlyNumbers));
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

      // Dual-write Supabase (best-effort)
      try {
        const { usuariosWriteSupabase, escreverUsuarioSupabase } = await import('../lib/usuarios-supabase');
        if (usuariosWriteSupabase()) {
          await escreverUsuarioSupabase(uid, {
            email: formData.email,
            nome: formData.nome,
            role: formData.role,
            ativo: true,
            telegramId: parseInt(formData.telegramId),
            telegramUsername: formData.telegramUsername || null,
          });
        }
      } catch (e) { console.warn('[supa] cadastro usuario dual-write falhou', e); }

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

      toast.success(pick(T.signupSuccess));
      setTimeout(() => navigate('/'), 1500);
    } catch (error: any) {
      const errorMessage = error.message || pick(T.errorSignup);
      if (error.code === 'auth/email-already-in-use') {
        toast.error(pick(T.emailAlreadyUsed));
      } else if (error.code === 'auth/invalid-email') {
        toast.error(pick(T.invalidEmail));
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
          <p className="text-slate-400">{pick(T.subtitle)}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl shadow-2xl p-6 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {pick(T.fullName)}
            </label>
            <input
              type="text"
              name="nome"
              value={formData.nome}
              onChange={handleChange}
              placeholder={pick(T.fullNamePlaceholder)}
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {pick(T.email)}
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
              {pick(T.telegramId)} <span className="text-xs text-slate-400">{pick(T.numbersOnly)}</span>
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
              {pick(T.telegramIdHint)}
            </p>
          </div>

          {/* Telegram Username */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {pick(T.telegramUsername)} <span className="text-xs text-slate-400">{pick(T.optionalNoAt)}</span>
            </label>
            <input
              type="text"
              name="telegramUsername"
              value={formData.telegramUsername}
              onChange={handleChange}
              placeholder={pick(T.usernamePlaceholder)}
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              disabled={loading}
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {pick(T.role)}
            </label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:border-blue-500 focus:outline-none"
              disabled={loading}
            >
              <option value="campo">{pick(T.roleCampo)}</option>
              <option value="guard">{pick(T.roleGuard)}</option>
              <option value="gestor">{pick(T.roleGestor)}</option>
              <option value="admin">{pick(T.roleAdmin)}</option>
            </select>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {pick(T.password)}
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
            <p className="text-xs text-slate-500 mt-1">{pick(T.passwordMinHint)}</p>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {pick(T.confirmPassword)}
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
            {loading ? pick(T.creating) : pick(T.createAccount)}
          </button>

          {/* Info */}
          <div className="bg-blue-900 bg-opacity-50 border border-blue-700 rounded-lg p-3 text-sm text-blue-200">
            <p className="font-semibold mb-1">{pick(T.howToGetId)}</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>{pick(T.step1)}</li>
              <li>{pick(T.step2Prefix)} <span className="font-mono">@userinfobot</span></li>
              <li>{pick(T.step3)}</li>
              <li>{pick(T.step4)}</li>
            </ol>
          </div>
        </form>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          {pick(T.footer)}
        </p>
      </div>
    </div>
  );
}
