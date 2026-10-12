import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ReactApp';
import './index.css';

const savedTheme = localStorage.getItem('theme');
document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';

const root = document.getElementById('app');
if (!root) throw new Error('App root is missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
