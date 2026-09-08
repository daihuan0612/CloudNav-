import React, { useState } from 'react';
import { Lock, Loader2, KeyRound, ShieldCheck } from 'lucide-react';

interface UnlockScreenProps {
  onUnlocked: (password: string) => void;
}

/**
 * 整站解锁界面：未输入正确访问密码前，不渲染任何导航内容。
 * 密码通过 /api/verify 校验（与后端 PASSWORD 比对）。
 */
export default function UnlockScreen({ onUnlocked }: UnlockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!password || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onUnlocked(password);
      } else {
        setError('密码错误，请重试');
      }
    } catch (e) {
      setError('验证服务不可用，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-900 overflow-hidden">
      {/* 背景光斑 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -left-32 w-[520px] h-[520px] rounded-full bg-blue-400/15 dark:bg-blue-500/10 blur-3xl" />
        <div className="absolute bottom-0 -right-44 w-[560px] h-[560px] rounded-full bg-purple-400/12 dark:bg-purple-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-3xl border border-slate-200/60 dark:border-slate-700/60 shadow-2xl p-8 fade-up">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30 ring-1 ring-white/20 mb-4">
              <Lock size={28} />
            </div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">私人导航</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">输入访问密码进入</p>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="访问密码"
                autoFocus
                className="w-full pl-10 pr-4 py-2.5 bg-white/70 dark:bg-slate-700/40 border border-slate-200/70 dark:border-slate-600/40 rounded-xl text-sm dark:text-white placeholder-slate-400 outline-none transition-all duration-200 focus:ring-2 focus:ring-blue-500/40 focus:shadow-glow"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1.5 pl-1">
                <ShieldCheck size={13} className="text-red-400" /> {error}
              </p>
            )}

            <button
              onClick={submit}
              disabled={loading || !password}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/30 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
              {loading ? '验证中...' : '解锁'}
            </button>
          </div>

          <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center mt-6">
            解锁后本浏览器 7 天内免密进入，过期需重新输入
          </p>
        </div>
      </div>
    </div>
  );
}
