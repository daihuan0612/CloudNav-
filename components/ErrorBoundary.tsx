import { Component, type ReactNode, type ErrorInfo } from 'react';

/**
 * 全局错误边界（防护层）
 *
 * 作用：任何子组件在「渲染 / 生命周期」中抛错时，不再让整页变成白屏，
 *      而是显示一个可操作的恢复界面。
 *
 * 为什么必须有：
 *   本地缓存（localStorage）里的脏数据是最常见的崩溃来源。
 *   一旦渲染崩溃又没兜住，用户会连「设置」页都打不开，完全无法自救 ——
 *   只能手动清浏览器数据。有了这个边界，就多了一个逃生按钮。
 *
 * 注意：这里刻意使用**内联样式**，不依赖 Tailwind。
 *      因为崩的时候 CDN 样式可能没加载上，错误页本身必须绝对可靠地显示出来。
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 本应用自己使用的 localStorage 键（重置时只清这些，不动其他站点数据） */
const OWN_STORAGE_KEYS = [
  'cloudnav_data_cache',
  'cloudnav_auth_token',
  'cloudnav_auth_expiry',
  'cloudnav_webdav_config',
  'cloudnav_ai_config',
  'cloudnav_search_engines',
  'cloudnav_site_settings',
];

export default class ErrorBoundary extends Component<Props, State> {
  // 说明：本项目未安装 @types/react，基类的 props 无法被推断出来，故显式声明。
  // （同类历史问题：utils/favicon.ts 也因缺少 React 类型而报 TS2503）
  declare props: Readonly<Props>;

  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CloudNav] 渲染出错，已被错误边界捕获：', error, info);
  }

  /** 只重新加载（本地数据保留） */
  private handleReload = () => {
    window.location.reload();
  };

  /** 清空本应用的本地缓存后重新加载 —— 最后的自救手段 */
  private handleResetLocal = () => {
    try {
      OWN_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      /* localStorage 不可用时忽略 */
    }
    window.location.reload();
  };

  /** 带时间戳重新加载，绕过 HTTP 缓存强制拉取最新版本 */
  private handleHardReload = () => {
    try {
      window.location.href = window.location.pathname + '?reload=' + Date.now();
    } catch (e) {
      window.location.reload();
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '560px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            padding: '28px',
            boxShadow: '0 10px 30px rgba(15,23,42,.08)',
          }}
        >
          <div style={{ fontSize: '32px', lineHeight: 1, marginBottom: '12px' }}>
            🛠️
          </div>

          <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px' }}>
            页面出错了，但数据没事
          </h1>

          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.7,
              color: '#475569',
              margin: '0 0 16px',
            }}
          >
            已经拦住了这次崩溃，你的书签数据存在云端，没有丢失。
            通常刷新一下就能恢复；如果一直打不开，就清一下本地缓存再看。
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 18px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#ffffff',
                background: '#3b82f6',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
              }}
            >
              刷新页面
            </button>

            <button
              onClick={this.handleResetLocal}
              style={{
                padding: '10px 18px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#b91c1c',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '10px',
                cursor: 'pointer',
              }}
            >
              清空本地缓存并重试
            </button>

            <button
              onClick={this.handleHardReload}
              style={{
                padding: '10px 18px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#475569',
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                cursor: 'pointer',
              }}
            >
              强制重新加载
            </button>
          </div>

          <details style={{ marginTop: '18px' }}>
            <summary
              style={{
                fontSize: '12px',
                color: '#94a3b8',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              查看错误详情（排查用）
            </summary>
            <pre
              style={{
                marginTop: '10px',
                padding: '12px',
                background: '#0f172a',
                color: '#e2e8f0',
                borderRadius: '10px',
                fontSize: '11px',
                lineHeight: 1.6,
                overflow: 'auto',
                maxHeight: '220px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {String(error?.stack || error?.message || error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
