import React from 'react';
import ReactDOM from 'react-dom/client';
// Fonte Inter LOCAL (embutida no bundle): antes vinha da CDN do Google a cada boot,
// bloqueando a primeira pintura — e offline caía na fonte de fallback.
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// Fonte de emoji NOSSA (Twemoji COLR, ~466KB, embutida): os emoji da UI passam a
// renderizar iguais em qualquer Windows, offline, sem depender da fonte de emoji do
// sistema (que varia de máquina, sai monocromática ou até vazia em builds antigos).
import 'twemoji-colr-font/twemoji.css';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
