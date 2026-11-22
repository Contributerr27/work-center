// Music: the Spotify playlists you played last, playable from a side panel.
//
// Two ways to reach Spotify, both optional:
// - The Spotify desktop app (macOS): play, pause, skip and "now playing" through AppleScript. No setup, works
//   on free and Premium accounts.
// - Spotify's Web API, connected once with your own Spotify app's Client ID (PKCE, no client secret). It adds
//   "recently played" and "your playlists", and playback on any device you have open (Premium only).
// The login is kept in <DATA>/music.json (mode 600); the refresh token is encrypted with Electron's
// safeStorage (the macOS Keychain) when the app runs in Electron.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const DEMO = !!process.env.WORK_CENTER_DEMO;
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-recently-played user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private';
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const URI = /^spotify:(playlist|album|artist|track):[A-Za-z0-9]{10,40}$/;
const webUrl = (uri) => { const [, type, id] = uri.split(':'); return `https://open.spotify.com/${type}/${id}`; };

let safe = null;
try { const e = require('electron'); if (e?.safeStorage) safe = e.safeStorage; } catch { /* plain Node (npm run web) */ }
const seal = (s) => (s && safe?.isEncryptionAvailable?.() ? { enc: safe.encryptString(s).toString('base64') } : { raw: s || null });
const unseal = (v) => { try { return v?.enc ? safe.decryptString(Buffer.from(v.enc, 'base64')) : v?.raw || null; } catch { return null; } };

// ---------- The Spotify desktop app (macOS) ----------
const appPath = () => (process.platform === 'darwin'
  ? ['/Applications/Spotify.app', path.join(require('node:os').homedir(), 'Applications/Spotify.app')].find((p) => fs.existsSync(p)) || null : null);
function osa(script) {
  return new Promise((resolve, reject) => execFile('osascript', ['-e', script], { timeout: 6000 }, (e, out) => (e ? reject(e) : resolve(String(out).trim()))));
}
const desktop = {
  // Only ask when the app already runs: AppleScript would otherwise launch it.
  async running() { return (await osa('application "Spotify" is running').catch(() => 'false')) === 'true'; },
  async now() {
    if (!(await this.running())) return null;
    const out = await osa('tell application "Spotify" to return (player state as string) & "\\n" & name of current track & "\\n" & artist of current track & "\\n" & artwork url of current track & "\\n" & spotify url of current track').catch(() => '');
    const [state, name, artist, art, uri] = out.split('\n');
    return name ? { playing: state === 'playing', name, artist, image: art || null, uri, device: 'Spotify app' } : null;
  },
  play: (uri) => osa(`tell application "Spotify" to play track "${uri}"`),
  control: (a) => osa(`tell application "Spotify" to ${{ toggle: 'playpause', next: 'next track', prev: 'previous track' }[a]}`),
};

// ---------- Demo data (npm run demo) ----------
const art = (a, b) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>`)}`;
const DEMO_LISTS = [
  ['Morning Focus', 'Riley Chen', '#3a7bd5', '#00d2ff', 0.4],
  ['Lo-fi for Deploys', 'Riley Chen', '#8e44ad', '#f39c12', 3],
  ['Rainy Day Coding', 'Acme Pay Music Club', '#2c3e50', '#4ca1af', 20],
  ['Friday Wrap-up', 'Riley Chen', '#e96443', '#904e95', 30],
  ['Night Shift Synthwave', 'Sam Ortiz', '#fc466b', '#3f5efb', 52],
].map(([name, owner, a, b, h], i) => ({ uri: `spotify:playlist:demo${String(i).padStart(18, '0')}`, type: 'playlist', name, owner, image: art(a, b), tracks: 20 + i * 7, playedAt: new Date(Date.now() - h * 3600e3).toISOString() }));

module.exports = {
  setup(ctx) {
    const FILE = path.join(ctx.DATA, 'music.json');
    const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
    const write = (s) => { fs.writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 }); try { fs.chmodSync(FILE, 0o600); } catch { /* */ } };
    let access = null; // { token, until }
    let pending = null; // { state, verifier, redirect, at }
    let cache = { at: 0, recent: [], mine: [] };
    let demoNow = { playing: false, ...DEMO_LISTS[0], name: 'Quiet Morning', artist: 'The Placeholders', device: 'Demo' };

    const redirectFor = (req) => `http://127.0.0.1:${req.socket.localPort}/api/music/callback`;

    async function token() {
      const s = read();
      if (access && access.until > Date.now() + 30e3) return access.token;
      const refresh = unseal(s.refresh);
      if (!s.clientId || !refresh) return null;
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: s.clientId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.error === 'invalid_grant') { write({ clientId: s.clientId }); access = null; }
        throw err(`Spotify login failed: ${j.error_description || j.error || r.status}`, 502);
      }
      access = { token: j.access_token, until: Date.now() + (j.expires_in || 3600) * 1000 };
      if (j.refresh_token) write({ ...s, refresh: seal(j.refresh_token) });
      return access.token;
    }
    async function api(p, opts = {}) {
      const t = await token();
      if (!t) throw err('Spotify is not connected', 409);
      const r = await fetch(`${API}${p}`, { ...opts, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(opts.headers || {}) } });
      if (r.status === 204) return null;
      const j = await r.json().catch(() => null);
      if (!r.ok) throw Object.assign(err(j?.error?.message || `Spotify said ${r.status}`, r.status === 401 ? 502 : r.status), { reason: j?.error?.reason });
      return j;
    }

    const brief = (x, type, playedAt) => x && ({
      uri: x.uri, type, name: x.name, playedAt,
      owner: x.owner?.display_name || x.artists?.map((a) => a.name).join(', ') || '',
      image: (x.images || []).slice(-2)[0]?.url || x.images?.[0]?.url || null,
      tracks: x.tracks?.total ?? x.total_tracks ?? null,
    });

    async function lists(force) {
      if (!force && Date.now() - cache.at < 60e3) return cache;
      const [recent, mine] = await Promise.all([api('/me/player/recently-played?limit=50'), api('/me/playlists?limit=30').catch(() => ({ items: [] }))]);
      const mineBy = new Map((mine.items || []).filter(Boolean).map((p) => [p.uri, brief(p, 'playlist')]));
      // Each context (playlist, album) once, newest first.
      const seen = new Map();
      for (const it of recent.items || []) {
        const c = it.context;
        if (!c?.uri || !/^spotify:(playlist|album):/.test(c.uri) || seen.has(c.uri)) continue;
        seen.set(c.uri, { uri: c.uri, type: c.type, playedAt: it.played_at, fallback: it.track?.album });
        if (seen.size >= 8) break;
      }
      const out = await Promise.all([...seen.values()].map(async (c) => {
        if (mineBy.has(c.uri)) return { ...mineBy.get(c.uri), playedAt: c.playedAt };
        const id = c.uri.split(':')[2];
        // Spotify's own mixes can't be read by apps made after Nov 2024: keep the row with a plain name.
        const x = await api(c.type === 'album' ? `/albums/${id}` : `/playlists/${id}?fields=uri,name,images,owner(display_name),tracks(total)`).catch(() => null);
        return brief(x, c.type, c.playedAt) || { uri: c.uri, type: c.type, playedAt: c.playedAt, name: c.type === 'album' ? c.fallback?.name || 'Album' : 'Spotify playlist', owner: c.type === 'playlist' ? 'Made by Spotify' : '', image: c.type === 'album' ? c.fallback?.images?.[0]?.url : null };
      }));
      cache = { at: Date.now(), recent: out, mine: [...mineBy.values()].slice(0, 30) };
      return cache;
    }

    async function now() {
      const d = appPath() ? await desktop.now() : null;
      if (d) return d;
      if (!read().refresh) return null;
      const p = await api('/me/player').catch(() => null);
      if (!p?.item) return null;
      return { playing: !!p.is_playing, name: p.item.name, artist: (p.item.artists || []).map((a) => a.name).join(', '), image: p.item.album?.images?.slice(-2)[0]?.url || null, uri: p.item.uri, device: p.device?.name || null, context: p.context?.uri || null };
    }

    ctx.route('GET', '/api/music', async ({ url, req }) => {
      if (DEMO) return { demo: true, connected: true, app: false, now: demoNow, recent: DEMO_LISTS, mine: DEMO_LISTS.slice(0, 3) };
      const s = read();
      const base = { connected: !!s.refresh, clientId: s.clientId || '', redirect: redirectFor(req), app: !!appPath(), premium: s.premium ?? null };
      let l = { recent: [], mine: [] }, error = null;
      if (base.connected) l = await lists(url.searchParams.get('force') === '1').catch((e) => { error = e.message; return cache; });
      return { ...base, now: await now().catch(() => null), recent: l.recent, mine: l.mine, error };
    });
    ctx.route('GET', '/api/music/now', async () => ({ now: DEMO ? demoNow : await now().catch(() => null) }));

    // Start the login: the page opens the returned link in the browser; Spotify comes back to /api/music/callback.
    ctx.route('POST', '/api/music/connect', ({ body, req }) => {
      const clientId = String(body?.clientId || read().clientId || '').trim();
      if (!/^[a-f0-9]{32}$/i.test(clientId)) throw err('That doesn\'t look like a Spotify Client ID (32 letters and digits)');
      write({ ...read(), clientId });
      const verifier = crypto.randomBytes(48).toString('base64url');
      pending = { state: crypto.randomBytes(16).toString('hex'), verifier, redirect: redirectFor(req), at: Date.now() };
      const q = new URLSearchParams({
        client_id: clientId, response_type: 'code', redirect_uri: pending.redirect, scope: SCOPES, state: pending.state,
        code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      });
      return { url: `https://accounts.spotify.com/authorize?${q}` };
    });
    ctx.route('GET', '/api/music/callback', async ({ url }) => {
      const page = (title, msg) => ({ status: 200, html: `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0;background:#111;color:#eee"><div style="text-align:center"><h2>${title}</h2><p>${msg}</p></div></body>` });
      const p = pending;
      if (!p || url.searchParams.get('state') !== p.state || Date.now() - p.at > 10 * 60e3) return page('Link expired', 'Go back to Work Center and press Connect again.');
      pending = null;
      if (url.searchParams.get('error')) return page('Not connected', 'Spotify access was not granted. You can close this tab.');
      const s = read();
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: p.redirect, client_id: s.clientId, code_verifier: p.verifier }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.refresh_token) return page('Not connected', 'Spotify turned the login down. Check the Redirect URI in your Spotify app, then try again.');
      access = { token: j.access_token, until: Date.now() + (j.expires_in || 3600) * 1000 };
      write({ clientId: s.clientId, refresh: seal(j.refresh_token), connectedAt: new Date().toISOString() });
      cache.at = 0;
      const me = await api('/me').catch(() => null);
      if (me?.product) write({ ...read(), premium: me.product === 'premium' });
      return page('Spotify connected', 'You can close this tab and go back to Work Center.');
    });
    ctx.route('POST', '/api/music/disconnect', () => { const s = read(); write({ clientId: s.clientId }); access = null; cache = { at: 0, recent: [], mine: [] }; return { ok: true }; });

    // Play a playlist or album. Order: the desktop app, then a Spotify device through the Web API (Premium),
    // otherwise hand back a link to open it in Spotify.
    ctx.route('POST', '/api/music/play', async ({ body }) => {
      const uri = String(body?.uri || '');
      if (!URI.test(uri)) throw err('Not a Spotify link');
      if (DEMO) { demoNow = { ...demoNow, ...DEMO_LISTS.find((x) => x.uri === uri), name: 'Quiet Morning', artist: 'The Placeholders', playing: true, context: uri }; return { via: 'demo' }; }
      if (appPath()) { await desktop.play(uri); return { via: 'app' }; }
      if (!read().refresh) return { via: 'link', url: webUrl(uri) };
      try {
        const devices = (await api('/me/player/devices'))?.devices || [];
        const dev = devices.find((d) => d.is_active) || devices[0];
        if (!dev) return { via: 'link', url: webUrl(uri), reason: 'no-device' };
        await api(`/me/player/play?device_id=${encodeURIComponent(dev.id)}`, { method: 'PUT', body: JSON.stringify({ context_uri: uri }) });
        return { via: 'api', device: dev.name };
      } catch (e) {
        if (e.reason === 'PREMIUM_REQUIRED' || e.status === 403) { write({ ...read(), premium: false }); return { via: 'link', url: webUrl(uri), reason: 'premium' }; }
        throw e;
      }
    });
    ctx.route('POST', '/api/music/control', async ({ body }) => {
      const a = body?.action;
      if (!['toggle', 'next', 'prev'].includes(a)) throw err('Unknown action');
      if (DEMO) { if (a === 'toggle') demoNow = { ...demoNow, playing: !demoNow.playing }; return { ok: true }; }
      if (appPath() && (await desktop.running())) { await desktop.control(a); return { ok: true }; }
      const playing = a === 'toggle' ? !!(await api('/me/player').catch(() => null))?.is_playing : null;
      try {
        if (a === 'toggle') await api(`/me/player/${playing ? 'pause' : 'play'}`, { method: 'PUT' });
        else await api(`/me/player/${a === 'next' ? 'next' : 'previous'}`, { method: 'POST' });
      } catch (e) {
        if (e.reason === 'PREMIUM_REQUIRED' || e.status === 403) throw err('Play, pause and skip from Work Center need Spotify Premium (or the Spotify desktop app).', 403);
        if (e.status === 404) throw err('Nothing is playing. Open Spotify on a device first.', 404);
        throw e;
      }
      return { ok: true };
    });
  },
};
