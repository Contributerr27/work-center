/* Work Center quick capture: the small always-on-top window behind the global hotkey (Cmd/Ctrl+Shift+Space).
   Enter sends the text as an AI command for the chosen mission; Cmd/Ctrl+Enter or "＋ Task" makes a task. */
(function () {
  const $ = (id) => document.getElementById(id);
  const hash = new URLSearchParams(location.hash.slice(1));
  let token = hash.get('t') || null;
  const MAC = /Mac/.test(navigator.platform);
  $('mod').textContent = MAC ? '⌘' : 'Ctrl';

  // Missions come from the main window (core ones plus any added by features); fall back to the core five.
  let sections = [['github', 'Pull requests'], ['jira', 'Jira'], ['slack', 'Slack'], ['work', 'Work'], ['meet', 'Meetings']];
  try { const m = JSON.parse(hash.get('m') || 'null'); if (Array.isArray(m) && m.length) sections = m; } catch (e) { /* keep defaults */ }
  const want = hash.get('s') || 'work';
  for (const [id, name] of sections) {
    const o = document.createElement('option');
    o.value = id; o.textContent = name;
    if (id === want) o.selected = true;
    $('section').append(o);
  }

  async function getToken() {
    if (token) return token;
    token = (await (await fetch('/api/all')).json()).token;
    return token;
  }
  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-desk-token': await getToken() }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }

  let busy = false;
  function say(text, kind) {
    const m = $('msg');
    m.textContent = text;
    m.className = `msg ${kind || ''}`;
    m.hidden = false;
  }
  async function send(asTask) {
    const text = $('text').value.trim();
    if (busy) return;
    if (text.length < 2) { say('Type what the AI should do', 'bad'); return; }
    busy = true;
    $('box').classList.add('busy');
    const sel = $('section');
    const name = sel.options[sel.selectedIndex]?.textContent || sel.value;
    try {
      if (asTask) {
        await post('/api/task/create', { section: 'work', ref: { label: text } });
        say('✓ Planning the task · it shows up in My tasks', 'ok');
      } else {
        await post('/api/command', { section: sel.value, text });
        say(`✓ Sent to ${name} · progress shows in Work Center`, 'ok');
      }
      $('text').value = '';
      setTimeout(() => window.close(), 1100);
    } catch (e) {
      say(e.message, 'bad');
      busy = false;
      $('box').classList.remove('busy');
    }
  }

  $('box').addEventListener('submit', (e) => { e.preventDefault(); send(false); });
  $('task').addEventListener('click', () => send(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); window.close(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(true); }
  });
  $('text').addEventListener('input', () => { if (!busy) $('msg').hidden = true; });
  window.addEventListener('focus', () => $('text').focus());
  $('text').focus();
})();
