import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DEFAULT_SITE_TITLE } from '../types';

interface UnlockScreenProps {
  onUnlocked: (password: string) => void;
  /** 站点名：来自设置里的「导航栏标题」。解锁前读不到云端数据，只能用本地缓存（App 传进来）。 */
  siteTitle?: string;
}

/**
 * 解锁界面：站点名 + 密码框 + 解锁按钮。
 * 站点名跟着「设置 → 网站设置 → 导航栏标题」走；从来没设置过时用 DEFAULT_SITE_TITLE。
 * 密码通过 /api/verify 校验（与后端 PASSWORD 比对）。
 */
export default function UnlockScreen({ onUnlocked, siteTitle }: UnlockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const title = (siteTitle || '').trim() || DEFAULT_SITE_TITLE;

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
        setError('密码错误');
      }
    } catch (e) {
      setError('验证服务不可用');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-[320px]">
        <div className="mb-7 text-center">
          <h1 className="text-[22px] font-bold tracking-tight leading-snug break-words text-slate-800 dark:text-slate-100">
            {title}
          </h1>
          <div className="mx-auto mt-3 h-[3px] w-10 rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="密码"
          autoFocus
          className="w-full px-4 py-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur border border-slate-200/70 dark:border-slate-700/60 rounded-xl text-sm dark:text-white placeholder-slate-400 outline-none transition-all duration-200 focus:ring-2 focus:ring-blue-500/40 focus:shadow-glow"
        />
        <button
          onClick={submit}
          disabled={loading || !password}
          className="mt-3 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/30 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : '解锁'}
        </button>
        {error && (
          <p className="mt-3 text-xs text-red-500 text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
