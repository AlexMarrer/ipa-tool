import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme/tokens.css';
import './theme/typography.css';
import './components/components.css';
import './layout/layout.css';
import './markdown/markdown.css';
import './pages/pages.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Wurzelelement fehlt');
createRoot(container).render(
  <StrictMode>
    <App api={window.ipa} />
  </StrictMode>,
);
