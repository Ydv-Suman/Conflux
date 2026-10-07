import './index.css';
import { startApp } from './app';

const savedTheme = localStorage.getItem('theme');
document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';

startApp();
