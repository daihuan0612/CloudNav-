/**
 * 生成一个唯一 id（字符串）。
 *
 * 为什么不直接用 `Date.now().toString()`：
 *   同一个毫秒内连续生成两条（批量导入、拖拽后连续新增、插件并发保存）会拿到**同一个 id**，
 *   于是 React 的 key 撞车、`findIndex(l => l.id === ...)` 会命中错的那条，
 *   表现为"删一个少两个 / 排序错位 / 编辑改了别的卡片"。
 *
 * 优先用 `crypto.randomUUID()`（现代浏览器、https、以及 Cloudflare Workers 都有）；
 * 老环境（http 内网、极老的浏览器）退回"时间戳 + 随机串"，仍然远好于纯时间戳。
 * 注意：id 只用于前端比对和 DOM key，**不参与任何数值运算**，
 * 所以换成非纯数字字符串对老数据没有影响（老数据里的数字 id 照旧能用）。
 */
export const newId = (): string => {
  try {
    const c = typeof crypto !== 'undefined' ? (crypto as Crypto) : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch (e) {
    /* 某些老环境访问 crypto 会抛异常，走下面的兜底 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
