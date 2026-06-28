import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';

const style = document.createElement('style');
style.textContent = [
  '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
  'body { font-family: Inter, sans-serif; background: #0d1220; color: #fff; -webkit-font-smoothing: antialiased; overflow: hidden; }',
  'input, button, select, textarea { font-family: inherit; }',
  'button { cursor: pointer; min-height: 36px; }',
  '::-webkit-scrollbar { width: 4px; }',
  '::-webkit-scrollbar-track { background: transparent; }',
  '::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }',
  ':focus-visible { outline: 2px solid #307FE2; outline-offset: 2px; }',
  'table tr:nth-child(even) td { background: rgba(255,255,255,.02); }',
  'table tr:hover td { background: rgba(255,255,255,.04); }',
  '@media (max-width: 640px) { .jet-header-desktop { display: none !important; } .jet-fab-group { bottom: 70px !important; } }',
  '.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }',
].join('\n');
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);