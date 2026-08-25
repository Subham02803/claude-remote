/**
 * Subscribing this device to alerts.
 *
 * Needs a secure context — https, or localhost, which is why this works during
 * development without a tunnel and needs `tailscale serve` on a phone.
 */

/**
 * Push keys travel as base64url; the browser wants raw bytes.
 *
 * Returns an ArrayBuffer rather than a Uint8Array: recent TypeScript DOM types
 * no longer accept a possibly-SharedArrayBuffer-backed view here.
 */
function toBytes(base64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export type PushState = 'unsupported' | 'insecure' | 'off' | 'denied' | 'on';

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  // The clearest failure to explain, so it gets its own state rather than
  // looking like the browser is broken.
  if (!window.isSecureContext) return 'insecure';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  const state = await pushState();
  if (state === 'unsupported' || state === 'insecure' || state === 'denied') return state;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const { key } = await fetch('/api/push/key').then((r) => r.json());
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toBytes(key),
    }));

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...sub.toJSON(), label: navigator.userAgent.slice(0, 80) }),
  });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  }
  return 'off';
}

export async function sendTestAlert(): Promise<number> {
  const r = await fetch('/api/push/test', { method: 'POST' });
  const { sent } = await r.json();
  return sent as number;
}
