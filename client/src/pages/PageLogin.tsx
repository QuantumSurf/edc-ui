// Connector Hub — Login Page
import { useState } from "react";
import { useAuth, type LoginResult } from "@/contexts/AuthContext";
import { useI18n } from "@/i18n";
import { Lock, User, AlertCircle, Loader2 } from "lucide-react";

export default function PageLogin() {
  const { login } = useAuth();
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await login(username, password);
    setLoading(false);
    if (res !== "ok") setError(res);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{
        background:
          "radial-gradient(ellipse at center, #0f2454 0%, #081634 70%, #050f24 100%)",
      }}
    >
      <div className="w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/logo.svg"
            alt="Quantum-X"
            width="64"
            height="64"
            className="w-16 h-16 mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Quantum-X
          </h1>
          <p className="text-slate-400 text-sm mt-1">{t.login.appName}</p>
        </div>

        {/* Login Card */}
        <div className="bg-card rounded-2xl p-6 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] border border-border">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {t.login.signIn}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {t.login.subtitle}
          </p>

          <form
            onSubmit={handleSubmit}
            className="space-y-4"
            autoComplete="off"
          >
            <div>
              <label
                htmlFor="kmx-login-username"
                className="text-xs font-medium text-muted-foreground mb-1 block"
              >
                {t.login.username}
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  name="kmx-login-username"
                  id="kmx-login-username"
                  value={username}
                  onChange={e => {
                    setUsername(e.target.value);
                    setError(null);
                  }}
                  placeholder="BPNL000000000000"
                  autoComplete="username"
                  className="w-full pl-10 pr-3 py-2.5 text-sm border border-border rounded-lg bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent focus:bg-card transition-colors"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="kmx-login-password"
                className="text-xs font-medium text-muted-foreground mb-1 block"
              >
                {t.login.password}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  name="kmx-login-password"
                  id="kmx-login-password"
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  autoComplete="new-password"
                  className="w-full pl-10 pr-3 py-2.5 text-sm border border-border rounded-lg bg-muted text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent focus:bg-card transition-colors"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error === "ratelimited"
                  ? t.login.rateLimited
                  : error === "server"
                    ? t.login.serverError
                    : error === "network"
                      ? t.login.networkError
                      : t.login.invalidCredentials}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm transition-colors disabled:bg-primary/40 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? t.login.signingIn : t.login.signIn}
            </button>
          </form>

          {/* Demo accounts hint — hidden in production via VITE_DISABLE_DEMO="true" */}
          {import.meta.env.VITE_DISABLE_DEMO !== "true" && (
          <div className="mt-5 pt-4 border-t border-border">
            <p className="text-[11px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">
              {t.login.demoAccounts}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { bpn: "BPNL000000000PRD", pw: "0000", role: t.auth.roleAdmin },
                {
                  bpn: "BPNL000000000CON",
                  pw: "0000",
                  role: t.auth.roleOperator,
                },
              ].map(({ bpn, pw, role }) => (
                <button
                  key={bpn}
                  type="button"
                  onClick={() => {
                    setUsername(bpn);
                    setPassword(pw);
                    setError(null);
                  }}
                  className="px-2 py-1.5 rounded-md border border-border hover:bg-muted hover:border-foreground/30 transition-colors text-muted-foreground hover:text-foreground leading-tight"
                >
                  <span className="block text-[11px] font-medium">{role}</span>
                  <span className="block mono text-[9px] text-muted-foreground/70 truncate">
                    {bpn}
                  </span>
                </button>
              ))}
            </div>
          </div>
          )}
        </div>

        <p className="text-center text-slate-500 text-[11px] mt-4">
          {t.login.appName}
        </p>
      </div>
    </div>
  );
}
