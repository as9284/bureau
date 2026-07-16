import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/global.css';
import './styles/shell.css';
import './styles/controls.css';
import './styles/panels.css';
import './styles/phase1.css';
import './styles/terminal.css';
import './styles/overview.css';
import './styles/android.css';
import './styles/git.css';
import './styles/files.css';
import 'katex/dist/katex.min.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
