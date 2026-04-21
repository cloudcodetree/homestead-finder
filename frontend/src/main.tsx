import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// `import.meta.env.BASE_URL` is "/homestead-finder/" under GitHub Pages
// and "/" in dev; BrowserRouter's basename lets react-router share the
// same prefix so URLs like "/homestead-finder/p/<id>" resolve correctly.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
