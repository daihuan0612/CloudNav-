
# CloudNav (云航) - 私人导航站（私有增强版）

<div align="center">

![React](https://img.shields.io/badge/React-18-blue?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.0-38bdf8?style=flat-square&logo=tailwindcss)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange?style=flat-square&logo=cloudflare)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

<br/>

**基于 [CloudNav-](https://github.com/sese972010/CloudNav-) fork 的个人私有导航站。**
**无需购买服务器，依托 Cloudflare 免费托管，实现多端数据实时同步。**

[功能特性](#-核心功能) • [部署教程](#-部署教程-免费) • [使用指南](#-使用指南) • [改动记录](#-改动记录)

</div>

---

## ✨ 核心功能

### 🔒 纯私有访问模式（本版新增）
*   **整站访问密码**：打开站点先看到解锁界面，**不输密码看不到任何导航内容**。
*   **读取接口鉴权**：`GET /api/storage` 等接口同样要求密码，直接访问接口也拿不到数据。
*   **7 天免密**：解锁后同一浏览器 7 天内免输，过期自动回锁；改密码后旧登录态自动失效。
*   **目录锁**：支持对特定分类单独设置密码，隐藏敏感内容（原版功能）。

### 🩺 死链检测（本版新增）
*   **双端探测**：浏览器本地探测（反映你当前网络）+ Cloudflare Worker 海外探测（边缘节点）。
*   **四色判定**：
    | 判定 | 含义 |
    |---|---|
    | 🟢 正常 | 本地通，或本地通+海外通 |
    | 🟡 可能被墙 | 本地不通但海外通（不是你网络的问题） |
    | 🔴 疑似死链 | 本地海外都不通 |
    | ⚪ 跳过 | `http://` 链接本地不测，只看海外 |
*   支持按状态筛选、一键删除疑似死链。

### 🧠 AI 深度集成
*   **多模型支持**：兼容任何 OpenAI 接口的模型（Gemini / OpenAI / DeepSeek / Claude 等）。
*   **一键批量补全**：设置面板一键扫描，**只为没有备注的书签生成中文简介**，有备注的不动。
*   **智能分类**：添加链接时自动推荐最合适的分类。

### 📥 导入增强（本版新增）
*   **备注解析**：导入 Chrome 书签 HTML 时读取 `<DD>` 描述作为链接备注。
*   **以新文件为准**：重复链接不再被拦截——"保持原目录结构"模式会**全量覆盖**（恢复/更新备份专用），不会累积重复。
*   **合并模式**：跳过已存在、只加新增（用于多数据源合并）。

### ☁️ 数据同步与安全
*   **Cloudflare KV 同步**：边缘存储，公司、家里、手机三端数据秒级同步。
*   **WebDAV 双重备份**：支持坚果云、Nextcloud 等 WebDAV 网盘备份（已补鉴权保护）。

### 🎨 界面
*   **大卡片布局**：`repeat(auto-fill, minmax(280px, 1fr))`，桌面多列、手机单列自适应。
*   **老站同款呈现**：柔和阴影、hover 实色蓝边 + 上浮 + 蓝紫渐变盖层。
*   **全局美化**：毛玻璃侧边栏/顶栏、背景光斑、卡片入场动画、中文优化字体。

### 🧩 Chrome 扩展插件 (Pro)
*   **一键保存**：右键/点击图标快速将当前网页保存到指定分类。
*   **侧边栏导航**：快捷键 (如 Ctrl+Shift+E) 呼出侧边栏，在任意网页浏览管理书签。
*   **兼容说明**：扩展生成时内置网站地址与密码，**不受整站解锁影响**；修改 PASSWORD 后需重新生成插件。

---

## 🚀 部署教程 (免费)

本应用完全基于 **Cloudflare Pages** + **KV** 构建，无需服务器，永久免费。

> **📥 [点击下载完整图文教程 (.docx)](图文教程.docx)**

### 📋 简明部署步骤

1.  **Fork 项目**: 点击右上角 Fork 按钮，将本项目克隆到您的 GitHub 账号。
2.  **创建 Pages 应用**: Cloudflare Dashboard -> Workers & Pages -> 创建应用程序 -> Pages -> 连接到 Git -> 选择您的 `CloudNav-` 仓库。
3.  **配置构建**:
    *   框架预设: **无 (None)**
    *   构建命令: `npm run build`
    *   输出目录: `dist`
4.  **创建数据库**: Workers & Pages -> KV -> 新建命名空间，命名 `CLOUDNAV_DB`。
5.  **绑定变量**:
    *   项目设置 -> 绑定 (Bindings) -> 添加 KV 命名空间 -> 变量名填 `CLOUDNAV_KV`，值选 `CLOUDNAV_DB`。
    *   环境变量 (Environment variables) -> 添加变量 `PASSWORD`，值为您的访问密码。
6.  **部署**: 重新部署项目即可（**绑定/改密码后必须重新部署才生效**）。

---

## 📖 使用指南

### 首次使用
1.  打开部署后的地址 → 输入 `PASSWORD` 解锁（7 天免密）。
2.  侧边栏 **导入** → 选择 Chrome 书签 HTML（含备注）→ "保持原目录结构"导入。
3.  侧边栏 **设置** → 配置 AI（可选）→ 一键批量补全缺失的备注。

### 配置 AI
| 项目 | 填写 |
|---|---|
| 提供商 | OpenAI Compatible |
| Base URL | `https://你的反代地址/v1`（代码自动拼接 `/chat/completions`） |
| API Key | 你的 Key |
| 模型 | 你反代后台可用的模型 ID |

### 死链检测
侧边栏 **检测** → 开始检测 → 按颜色查看状态 → 筛选"疑似死链"批量删除。
> 判定基于你的本地网络 + 海外 Worker，VPN 开/关会影响"可能被墙"结果，属预期行为。

### 数据备份
*   **导出 JSON**：侧边栏 备份 → 一键下载（推荐定期做）。
*   **WebDAV**：设置里配置坚果云/Nextcloud 自动备份。
*   **恢复**：导入同一份 JSON / 书签文件即可全量覆盖恢复。

---

## 📦 目录结构

```
├── components/          # 界面组件（含 UnlockScreen 解锁、DeadLinkCheckModal 检测）
├── functions/api/       # Cloudflare Functions
│   ├── storage.ts       # 数据读写（GET/POST 均鉴权）
│   ├── link.ts          # 扩展保存链接（鉴权）
│   ├── check.ts         # 死链检测海外探测（鉴权 + SSRF 防护）
│   ├── verify.ts        # 解锁密码校验
│   └── webdav.ts        # WebDAV 备份代理（已补鉴权）
├── services/            # AI 调用、书签解析、备份服务
├── index.html           # 入口 + Tailwind 配置 + 全局样式
├── App.tsx              # 主应用
└── types.ts             # 类型定义
```

---

## 🛠️ 代码审核说明

本版在上线前经过一轮代码审查，结论：**整体架构清晰、可正常使用**，主要安全点均已处理。

| 检查项 | 结论 |
|---|---|
| 数据接口鉴权（storage/link/check/verify） | ✅ 均校验 `x-auth-password` |
| WebDAV 代理 | ✅ 已补鉴权（原版遗漏，本版修复） |
| 死链检测端点 | ✅ 限 50 URL/次、8s 超时、释放连接；已加 SSRF 防护（拒绝内网/回环/链路本地地址） |
| XSS 面 | ✅ React 转义渲染标题/备注；图标走 `img` 不受脚本影响 |
| 密码存储 | ⚠️ 已知说明：前端 localStorage 存解锁密码（7 天过期缓解暴露窗口）；AI Key 存浏览器，解锁后可见——纯私有场景可接受 |
| 暴力破解 | ⚠️ 已知说明：解锁/接口无速率限制，私用低风险；如需可加 CF 限流规则 |

---

## 📝 改动记录

| 版本 | 内容 |
|---|---|
| v2.x | 纯私有模式（整站解锁 + 接口鉴权 + 7 天免密）、死链检测、导入备注解析与覆盖、UI 美化与大卡片、代码安全修复（webdav 鉴权、check SSRF）、README 重写 |
| v1.x | 原版 CloudNav（fork 基线） |

---

## 🙏 致谢

*   本项目 fork 自 [sese972010/CloudNav-](https://github.com/sese972010/CloudNav-)，感谢原作者的开源贡献。
*   部分设计灵感参考 [CloudNav-abcd](https://github.com/aabacada/CloudNav-abcd)。

## 📄 License

[MIT](LICENSE)
