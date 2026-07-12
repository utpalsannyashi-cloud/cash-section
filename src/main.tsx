import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './index.css';

// Block pinch-zoom without touching normal one-finger scrolling. The
// touch-action CSS approach we used before had a bug on some mobile
// browsers where it let a pinch zoom IN but then wouldn't let a pinch
// zoom back OUT, leaving the page stuck zoomed. Stopping any two-finger
// touchmove (and Safari's gesture events) before it starts avoids that
// failure mode entirely, since the zoom never happens in the first place.
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false }
);
document.addEventListener('gesturestart', (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
