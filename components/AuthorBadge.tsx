import { useEffect, useRef } from 'react';
import { GitFork } from 'lucide-react';
import { AUTHOR_SIGNATURE, AUTHOR_REPO_URL } from '../utils/author';

/**
 * 署名徽标（带自愈防护）
 *
 * 目标：署名被「改掉」或「删掉」之后自动恢复。
 *
 * 原理：
 *   监听 DOM 变动（MutationObserver）+ 定时兜底，发现下面三种情况就当场修复：
 *     ① 整块被移出文档   → 挂回原父容器
 *     ② 文案被改/被删    → 复原文字（span 没了就重建）
 *     ③ 链接被改         → 复原 href
 *
 * 为什么不用「换 key 让 React 重挂载」：
 *   试过，会崩。React 删旧节点时会执行 removeChild，而那个节点已被外部移除，
 *   于是抛 NotFoundError 把整棵树带崩，反而永远恢复不了。纯 DOM 修复更可靠。
 *
 * ⚠️ 边界：这是「劝退」级防护，不是加密锁。代码在对方浏览器里运行，
 *    下决心的人总能绕过（比如把这段逻辑本身删掉）；
 *    真正有约束力的是 LICENSE 的署名保留条款。
 */

interface Props {
  className?: string;
}

const DEFAULT_CLASS =
  'flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors';

const TITLE_TEXT = '作者仓库';

export default function AuthorBadge({ className }: Props) {
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const parentRef = useRef<Node | null>(null);
  const lastHealRef = useRef<number>(0);

  useEffect(() => {
    // 记下 React 把这个徽标挂在哪里，供「被删后挂回去」使用
    parentRef.current = anchorRef.current?.parentNode ?? null;

    const heal = () => {
      const anchor = anchorRef.current;
      const parent = parentRef.current;
      if (!anchor || !parent) return;

      let changed = false;

      // ① 整块被移出文档 → 挂回原父容器
      if (!anchor.isConnected) {
        parent.appendChild(anchor);
        changed = true;
      }

      // ② 文案被改/被删 → 复原（span 不在就重建一个）
      const span = textRef.current;
      if (!span || !span.isConnected) {
        const fresh = document.createElement('span');
        fresh.textContent = AUTHOR_SIGNATURE;
        textRef.current = fresh;
        anchor.appendChild(fresh);
        changed = true;
      } else if (span.textContent !== AUTHOR_SIGNATURE) {
        span.textContent = AUTHOR_SIGNATURE;
        changed = true;
      }

      // ③ 链接 / 提示被改 → 复原
      if (anchor.getAttribute('href') !== AUTHOR_REPO_URL) {
        anchor.setAttribute('href', AUTHOR_REPO_URL);
        changed = true;
      }
      if (anchor.getAttribute('title') !== TITLE_TEXT) {
        anchor.setAttribute('title', TITLE_TEXT);
        changed = true;
      }

      if (changed) {
        lastHealRef.current = Date.now();
      }
    };

    const onMutation = () => {
      // 限流：1 秒内最多自愈一次，避免异常情况下反复空转
      if (Date.now() - lastHealRef.current < 1000) return;
      heal();
    };

    const observer = new MutationObserver(onMutation);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'title'],
    });

    // 定时兜底：应对「只改文案但没触发可观察变动」之类的情况
    const timer = window.setInterval(heal, 2000);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <a
      ref={anchorRef}
      href={AUTHOR_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={TITLE_TEXT}
      className={className || DEFAULT_CLASS}
    >
      <GitFork size={14} />
      <span ref={textRef}>{AUTHOR_SIGNATURE}</span>
    </a>
  );
}
