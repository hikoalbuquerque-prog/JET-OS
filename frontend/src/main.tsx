import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';

const style = document.createElement('style');
style.textContent = [
  '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
  'body { font-family: Inter, sans-serif; background: #0d1220; color: #fff; -webkit-font-smoothing: antialiased; overflow: hidden; }',
  'input, button, select, textarea { font-family: inherit; }',
  'button { cursor: pointer; }',
  '::-webkit-scrollbar { width: 4px; }',
  '::-webkit-scrollbar-track { background: transparent; }',
  '::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }'
].join('\n');
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);