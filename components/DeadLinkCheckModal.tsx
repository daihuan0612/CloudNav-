import React, { useState } from 'react';
import {
  X, Activity, RefreshCw, AlertTriangle,
  Trash2, Loader2
} from 'lucide-react';
import { LinkItem } from '../types';
import { handleIconError } from '../utils/favicon';

type LocalState = 'ok' | 'fail' | 'na';
type RemoteState = 'ok' | 'fail' | 'na';
type Verdict = 'ok' | 'warn' | 'dead' | 'na';

interface CheckResult {
  local: LocalState;
  remote: RemoteState;
  status: number;       // overseas HTTP status, 0 = network error / not measured
  remoteError?: string;
}

interface DeadLinkCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  links: LinkItem[];
  authToken: string;
  onDeleteLink: (id: string) => void;
}

const LOCAL_TIMEOUT = 8000;
const BATCH_SIZE = 12;
const REMOTE_CONCURRENCY = 3;
const LOCAL_CONCURRENCY = 6;

/* Run async tasks with a concurrency pool */
async function runPool<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number
): Promise<void> {
  let i = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx]);
      }
    }
  );
  await Promise.all(runners);
}

/* Local probe: browser fetch with no-cors.
   - https:// URLs: resolves 'ok' if the network layer answers (any status), 'fail' on network error/timeout.
   - http:// URLs are blocked by mixed-content on an https site -> 'na'. */
function checkLocal(url: string): Promise<LocalState> {
  return new Promise((resolve) => {
    if (!/^https:\/\//i.test(url)) {
      resolve('na');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      resolve('fail');
    }, LOCAL_TIMEOUT);
    fetch(url, { mode: 'no-cors', redirect: 'follow', signal: controller.signal })
      .then(() => {
        clearTimeout(timer);
        resolve('ok');
      })
      .catch(() => {
        clearTimeout(timer);
        resolve('fail');
      });
  });
}

/* Overseas probe via the Cloudflare Worker edge */
async function checkRemoteBatch(
  urls: string[],
  token: string
): Promise<{ url: string; ok: boolean; status: number; error?: string }[]> {
  const res = await fetch('/api/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-password': token,
    },
    body: JSON.stringify({ urls }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'check failed');
  return json.data as { url: string; ok: boolean; status: number; error?: string }[];
}

function judge(local: LocalState, remote: RemoteState): Verdict {
  if (remote === 'na') return 'na';
  if (remote === 'ok') {
    // Server alive overseas. If the local network cannot reach it -> likely blocked/needs VPN.
    return local === 'fail' ? 'warn' : 'ok';
  }
  // Overseas dead. If local can still reach it (e.g. China-only sites) -> fine for the user.
  return local === 'ok' ? 'ok' : 'dead';
}

const VERDICT_META: Record<Verdict, { label: string; cls: string }> = {
  ok: { label: '正常', cls: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' },
  warn: { label: '可能被墙', cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
  dead: { label: '疑似死链', cls: 'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400' },
  na: { label: '未测', cls: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400' },
};

export default function DeadLinkCheckModal({
  isOpen,
  onClose,
  links,
  authToken,
  onDeleteLink,
}: DeadLinkCheckModalProps) {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [filter, setFilter] = useState<'all' | Verdict>('all');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const startCheck = async () => {
    if (links.length === 0) return;
    setPhase('checking');
    setError('');
    setProgress({ done: 0, total: links.length * 2 });
    const acc: Record<string, CheckResult> = {};

    const touch = (url: string, patch: Partial<CheckResult>) => {
      if (!acc[url]) acc[url] = { local: 'na', remote: 'na', status: 0 };
      acc[url] = { ...acc[url], ...patch };
    };

    // 1) Local probes
    await runPool(
      links,
      async (link) => {
        const local = await checkLocal(link.url);
        touch(link.url, { local });
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      },
      LOCAL_CONCURRENCY
    );

    // 2) Overseas probes (batched)
    const urls = links.map((l) => l.url);
    const uniqueUrls = Array.from(new Set(urls));
    const batches: string[][] = [];
    for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
      batches.push(uniqueUrls.slice(i, i + BATCH_SIZE));
    }

    await runPool(
      batches,
      async (batch) => {
        try {
          const remote = await checkRemoteBatch(batch, authToken);
          remote.forEach((r) => {
            touch(r.url, { remote: r.ok ? 'ok' : 'fail', status: r.status || 0, remoteError: r.error });
          });
        } catch (e: any) {
          // Whole batch failed (auth expired / network). Mark them 'na' to avoid false 'dead'.
          batch.forEach((url) => touch(url, { remote: 'na' }));
          if (String(e?.message || e).includes('Unauthorized')) {
            setError('后端鉴权失败，请先登录（输入访问密码）后重试。');
          }
        }
        setProgress((p) => ({ ...p, done: p.done + batch.length }));
      },
      REMOTE_CONCURRENCY
    );

    setResults(acc);
    setPhase('done');
  };

  const rows = links.map((link) => {
    const r = results[link.url] || { local: 'na', remote: 'na', status: 0 };
    const verdict = judge(r.local, r.remote);
    return { link, r, verdict };
  });

  const stats = {
    ok: rows.filter((x) => x.verdict === 'ok').length,
    warn: rows.filter((x) => x.verdict === 'warn').length,
    dead: rows.filter((x) => x.verdict === 'dead').length,
    na: rows.filter((x) => x.verdict === 'na').length,
  };

  const visibleRows = rows.filter((x) => filter === 'all' || x.verdict === filter);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 shrink-0">
          <h3 className="text-lg font-semibold dark:text-white flex items-center gap-2">
            <Activity size={20} className="text-blue-500" /> 死链检测
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          {phase === 'idle' && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-600 dark:text-blue-400">
                <Activity size={32} />
              </div>
              <div className="text-center space-y-1">
                <p className="font-medium dark:text-white">检测 {links.length} 个链接的可用性</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                  检测会从两个位置探测：你的本地网络（反映当前是否开了 VPN）+ 海外节点。
                  两边都打不开才会判定为疑似死链；本地打不开但海外能打开会标为「可能被墙」，不会误杀。
                </p>
              </div>
            </div>
          )}

          {phase === 'checking' && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <Loader2 className="animate-spin w-8 h-8 text-blue-500" />
              <div className="text-center space-y-2">
                <p className="font-medium dark:text-white">
                  正在检测 {progress.done}/{progress.total}
                </p>
                <div className="w-64 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  本地网络 + 海外节点双端探测，大约需要 1-2 分钟
                </p>
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center border border-green-100 dark:border-green-900/30">
                  <div className="text-xl font-bold text-green-600 dark:text-green-400">{stats.ok}</div>
                  <div className="text-xs text-green-700 dark:text-green-500">正常</div>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-center border border-amber-100 dark:border-amber-900/30">
                  <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{stats.warn}</div>
                  <div className="text-xs text-amber-700 dark:text-amber-500">可能被墙</div>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-center border border-red-100 dark:border-red-900/30">
                  <div className="text-xl font-bold text-red-600 dark:text-red-400">{stats.dead}</div>
                  <div className="text-xs text-red-700 dark:text-red-500">疑似死链</div>
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg text-center border border-slate-100 dark:border-slate-600">
                  <div className="text-xl font-bold text-slate-600 dark:text-slate-400">{stats.na}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">未测</div>
                </div>
              </div>

              {/* Filter tabs */}
              <div className="flex gap-2 flex-wrap">
                {(['all', 'ok', 'warn', 'dead', 'na'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 text-xs rounded-full transition-colors border ${
                      filter === f
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {f === 'all' ? `全部 ${rows.length}` : `${VERDICT_META[f].label} ${stats[f]}`}
                  </button>
                ))}
              </div>

              {/* Result list */}
              {visibleRows.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm italic">该筛选下没有链接</div>
              ) : (
                <div className="space-y-2">
                  {visibleRows.map(({ link, r, verdict }) => {
                    const meta = VERDICT_META[verdict];
                    return (
                      <div
                        key={link.id}
                        className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800/60"
                      >
                        <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden">
                          {link.icon ? (
                            <img src={link.icon} alt="" className="w-full h-full object-contain" onError={(e) => handleIconError(e, link.url, link.title)} />
                          ) : (
                            link.title.charAt(0)
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                            {link.title}
                          </div>
                          <div className="text-xs text-slate-400 truncate">
                            {link.url}
                            {verdict === 'warn' && r.status > 0 && (
                              <span className="ml-1">海外状态 {r.status}</span>
                            )}
                            {verdict === 'ok' && r.status > 0 && <span className="ml-1">海外 {r.status}</span>}
                            {verdict === 'dead' && r.status === 0 && <span className="ml-1">海外无响应</span>}
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${meta.cls}`}>
                          {meta.label}
                        </span>
                        <button
                          onClick={() => onDeleteLink(link.id)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors shrink-0"
                          title="删除此链接"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2 bg-slate-50 dark:bg-slate-800/50 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            关闭
          </button>
          {phase !== 'checking' && (
            <button
              onClick={startCheck}
              disabled={links.length === 0}
              className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2 font-medium"
            >
              {phase === 'done' ? <RefreshCw size={15} /> : <Activity size={15} />}
              {phase === 'done' ? '重新检测' : '开始检测'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
