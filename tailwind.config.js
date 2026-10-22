/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // 扫描范围：把可能带 class 的源码都包含进来（原来靠 CDN 在浏览器里运行时扫描 DOM，
  // 改成构建时扫描后，漏掉哪个文件，那个文件的样式就会失效）。
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './types.ts',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#64748b',
        dark: '#0f172a',
        card: '#1e293b',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(59,130,246,.10), 0 8px 30px -6px rgba(59,130,246,.25)',
        card: '0 1px 2px 0 rgba(0,0,0,0.05)',
      },
    },
  },
  plugins: [],
};
