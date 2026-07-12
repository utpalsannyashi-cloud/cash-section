import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './index.css';

// Pinch-zoom guard, belt-and-braces:
// 1) touch-action: pan-x pan-y in index.css hints the browser to hand
//    two-finger gestures to JS instead of handling them natively on the
//    compositor thread, which is what makes preventDefault below actually
//    have a chance to run before the browser starts zooming.
// 2) Block the gesture in JS too, for browsers that don't fully respect
//    touch-action.
// 3) As a safety net, if a zoom slips through anyway (double-tap zoom,
//    accessibility zoom, or any browser quirk we haven't hit yet), snap
//    the page back to 100% automatically instead of leaving it stuck.
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false }
);
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => {
  e.preventDefault();
  resetZoom();
});
document.addEventListener('touchend', () => {
  if (window.visualViewport && window.visualViewport.scale > 1.02) resetZoom();
});

// Toggling maximum-scale on the viewport <meta> tag is the standard trick
// mobile browsers respect to force an existing pinch-zoom back to 1x. We
// restore the original tag right after so normal scrolling and the
// deliberate absence of a permanent maximum-scale (see index.html) keep
// working as before.
function resetZoom() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) return;
  const original = viewport.getAttribute('content') ?? '';
  viewport.setAttribute('content', `${original}, maximum-scale=1`);
  window.setTimeout(() => viewport.setAttribute('content', original), 60);
}

if (window.visualViewport) {
  let resetTimer: number | null = null;
  window.visualViewport.addEventListener('resize', () => {
    if (window.visualViewport!.scale > 1.02) {
      if (resetTimer !== null) window.clearTimeout(resetTimer);
      // Debounced so we snap back once the gesture (or whatever caused the
      // zoom) has settled, rather than fighting a pinch mid-motion.
      resetTimer = window.setTimeout(resetZoom, 200);
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
