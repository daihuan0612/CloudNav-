/**
 * 作者署名 —— 防篡改存储
 *
 * 为什么不直接写明文？
 *   署名若以明文出现在源码/打包产物里，别人下载 JS 后一次「搜索 + 替换」
 *   就能把名字改掉。这里改为**字符码**存放、运行时再解码 ——
 *   源码和 dist 产物里都搜不到「空行」这两个字，顺手改署名这条路被堵住。
 *
 * ⚠️ 诚实的边界：代码运行在别人的浏览器里，源码也在他们手上，
 *    所以这只能**提高门槛**，做不到绝对不可改。
 *    真正有约束力的是根目录的 LICENSE / NOTICE.md（署名保留要求）。
 */

// "by 空行" 的字符码（b y 空格 空 行）
const SIGNATURE_CODES = [98, 121, 32, 31354, 34892];

// 作者仓库地址的字符码（https://github.com/daihuan0612/CloudNav-）
const REPO_CODES = [
  104, 116, 116, 112, 115, 58, 47, 47, 103, 105, 116, 104, 117, 98, 46, 99,
  111, 109, 47, 100, 97, 105, 104, 117, 97, 110, 48, 54, 49, 50, 47, 67, 108,
  111, 117, 100, 78, 97, 118, 45,
];

/** 作品署名文字，如 "by 空行" */
export const AUTHOR_SIGNATURE: string = String.fromCharCode(...SIGNATURE_CODES);

/** 作者仓库地址 */
export const AUTHOR_REPO_URL: string = String.fromCharCode(...REPO_CODES);
