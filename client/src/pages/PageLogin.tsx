// Connector Hub — Login Page
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/i18n";
import { Lock, User, AlertCircle, Loader2 } from "lucide-react";

export default function PageLogin() {
  const { login } = useAuth();
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setLoading(true);
    const ok = await login(username, password);
    setLoading(false);
    if (!ok) setError(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "radial-gradient(ellipse at center, #0f2454 0%, #081634 70%, #050f24 100%)" }}>
      <div className="w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-[0_8px_24px_rgba(37,99,235,0.45)] ring-1 ring-blue-400/30">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-white fill-current">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t.login.appName}</h1>
          <p className="text-slate-400 text-sm mt-1">{t.login.appSubtitle}</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl p-6 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">{t.login.signIn}</h2>
          <p className="text-sm text-slate-500 mb-6">{t.login.subtitle}</p>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">{t.login.username}</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  name="kmx-login-username"
                  id="kmx-login-username"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(false); }}
                  autoComplete="username"
                  className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">{t.login.password}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  name="kmx-login-password"
                  id="kmx-login-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(false); }}
                  autoComplete="new-password"
                  className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-colors"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {t.login.invalidCredentials}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors disabled:bg-blue-300 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? t.login.signingIn : t.login.signIn}
            </button>
          </form>

          {/* Demo accounts hint */}
          <div className="mt-5 pt-4 border-t border-slate-200">
            <p className="text-[11px] text-slate-500 mb-2 font-medium uppercase tracking-wide">{t.login.demoAccounts}</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { user: "admin", role: t.login.admin },
                { user: "operator", role: t.login.operator },
                { user: "viewer", role: t.login.viewer },
              ].map(({ user, role }) => (
                <button
                  key={user}
                  type="button"
                  onClick={() => { setUsername(user); setPassword(user); setError(false); }}
                  className="text-[11px] px-2 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors text-slate-600 hover:text-slate-900"
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-slate-500 text-[11px] mt-4">
          Connector Hub v1.0 · Keycloak OIDC
        </p>
      </div>
    </div>
  );
}
