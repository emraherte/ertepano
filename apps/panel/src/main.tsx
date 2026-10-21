import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { App } from './App';
import { ConfirmProvider, ThemeProvider, ToastHost } from './ui';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <MotionConfig reducedMotion="user">
          <ToastHost>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastHost>
        </MotionConfig>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
