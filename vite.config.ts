import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 说明：这里刻意保持极简。
//  - 原本有 define 注入 process.env.GEMINI_API_KEY，但项目没有 .env 文件，
//    该值永远是 undefined；而且把 API Key 编译进前端产物本身就是坏做法，
//    AI 配置统一由使用者在「设置 → AI 设置」里填（存浏览器本地，不上云）。
//  - 原本还有 '@' 路径别名，但全项目没有任何地方用到，已移除。
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
});
