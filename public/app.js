(() => {
  const started = Date.now();
  const visitorKey = 'anonymous_visitor_id';
  let visitorId = localStorage.getItem(visitorKey);
  if (!visitorId) {
    visitorId = crypto.randomUUID();
    localStorage.setItem(visitorKey, visitorId);
  }

  function detect() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '其他';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS/iPadOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '其他';
    const deviceType = /Mobi|Android|iPhone/.test(ua) ? '手机' : /iPad|Tablet/.test(ua) ? '平板' : '电脑';
    return { browser, os, deviceType };
  }

  async function shortHash(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].slice(0, 8).map(v => v.toString(16).padStart(2, '0')).join('');
  }

  async function start() {
    const device = detect();
    const screenValue = `${screen.width}×${screen.height}`;
    const deviceKey = await shortHash([visitorId, device.browser, device.os, screenValue].join('|'));
    const response = await fetch('/api/visit/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        deviceKey,
        ...device,
        screen: screenValue,
        viewport: `${innerWidth}×${innerHeight}`,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        referrer: document.referrer
      })
    });
    if (!response.ok) return;
    const { visitId } = await response.json();
    const duration = () => Math.round((Date.now() - started) / 1000);
    const update = (action, beacon = false) => {
      const url = `/api/visit/${visitId}/${action}`;
      const data = JSON.stringify({ durationSeconds: duration() });
      if (beacon) navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));
      else fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true }).catch(() => {});
    };
    setInterval(() => update('heartbeat'), 15000);
    addEventListener('pagehide', () => update('end', true), { once: true });
  }

  start().catch(() => {});
})();
