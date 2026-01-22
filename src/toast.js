(function(global){
  if (global.__clarityread_toast) return;
  global.__clarityread_toast = true;

  function ensureContainer() {
  let c = document.querySelector('.clarity-toast-container');
  if (!c) {
    c = document.createElement('div');
    c.className = 'clarity-toast-container';
    // prefer appending to body for stability; fall back to documentElement
    const parent = document.body || document.documentElement || document.head || document;
    try { parent.appendChild(c); } catch (e) { document.documentElement.appendChild(c); }
  }
  return c;
}


  function showToast(message, { type = 'info', timeout = 4500 } = {}) {
    try {
      const container = ensureContainer();
      const el = document.createElement('div');
      el.className = 'clarity-toast';
      el.setAttribute('role','status');
      el.setAttribute('aria-live','polite');
      el.innerHTML = `<span class="toast-${type}">${type === 'info' ? 'Info' : type === 'error' ? 'Error' : 'OK'}</span>&nbsp;<span class="toast-msg"></span>`;
      el.querySelector('.toast-msg').textContent = String(message || '');
      const btn = document.createElement('button');
      btn.className = 'toast-close';
      btn.type = 'button';
      btn.innerText = '✕';
      btn.addEventListener('click', () => {
        hide(el);
      });
      el.appendChild(btn);

      container.appendChild(el);
      // force layout for animation
      requestAnimationFrame(() => el.classList.add('show'));

      const t = setTimeout(() => hide(el), timeout);
      el.__clarity_toast_timeout = t;

      function hide(node) {
        clearTimeout(node.__clarity_toast_timeout);
        node.classList.remove('show');
        node.addEventListener('transitionend', () => {
          try { node.remove(); } catch(e){}
        }, { once: true });
      }
      return { hide: () => hide(el) };
    } catch (e) { try { console.warn('toast error', e); } catch(_){} return null; }
  }

  // expose
  global.ClarityReadToast = { showToast, ensureContainer };
})(window);
