(() => {
  'use strict';
  const tab = crypto.randomUUID();
  const route = action => '/api/local/' + action + '?id=' + encodeURIComponent(tab);
  let timer = null;
  function heartbeat() {
    fetch(route('heartbeat'), { method: 'POST', cache: 'no-store', keepalive: true }).catch(() => {});
  }
  window.addEventListener('pageshow', () => {
    heartbeat();
    if (timer === null) timer = setInterval(heartbeat, 15000);
  });
  window.addEventListener('pagehide', () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    navigator.sendBeacon(route('release'));
  });
})();
