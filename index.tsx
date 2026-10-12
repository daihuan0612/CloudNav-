import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* 防护层：任何渲染错误都被兜住，避免整页白屏且无法自救 */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);