// Login + Registrierung + Rollenwahl — nach den Mockups login.jsx
import { h, ic, ghostMark, badge } from '../core/dom.js';
import { post, get } from '../core/api.js';
import { toast } from '../core/ui.js';

export function renderLogin(onLogin) {
  let mode = 'login';
  const wrap = h('div', { class: 'login-page' });

  const draw = () => {
    wrap.replaceChildren(
      h('div', { class: 'login-hero', style: { width: '100%', background: 'transparent', paddingBottom: '10px' } },
        ghostMark(64, 16),
        h('div', { class: 'col', style: { gap: '4px', alignItems: 'center' } },
          h('span', { class: 'wordmark', style: { fontSize: '28px', color: '#fff' }, html: 'Horrorgeticon&nbsp;<em>Ops</em>' }),
          h('span', { style: { fontSize: '12.5px', color: 'rgba(255,255,255,0.65)', fontWeight: 600 } }, 'Leitstand für den Wahnsinn vor Ort')),
        badge('plain', ['Horrornacht · Fr 31.10. · Event aktiv'], { dot: true, style: { background: 'rgba(242,153,74,0.18)', color: '#F2B27C' } })),
      h('div', { class: 'login-card' },
        h('div', { class: 'login-body' },
          h('div', { class: 'login-tabs' },
            h('span', { class: mode === 'login' ? 'on' : '', onclick: () => { mode = 'login'; draw(); } }, 'Anmelden'),
            h('span', { class: mode === 'register' ? 'on' : '', onclick: () => { mode = 'register'; draw(); } }, 'Profil erstellen')),
          mode === 'login' ? loginForm(onLogin) : registerForm(onLogin),
          h('div', { class: 'sep' }),
          demoHint(),
          h('span', { class: 'sub', style: { textAlign: 'center' } }, 'Zugang nur für eingeteilte Crew · v1.0'))));
  };
  draw();
  return wrap;
}

function loginForm(onLogin) {
  const code = h('input', { placeholder: 'z. B. LK-0427', autocomplete: 'username', autocapitalize: 'characters' });
  const pin = h('input', { type: 'password', placeholder: '••••••', inputmode: 'numeric', autocomplete: 'current-password' });
  const btn = h('button', { class: 'btn lg' }, 'Anmelden', ic('chev', 17));
  const submit = async () => {
    btn.disabled = true;
    try {
      const res = await post('/api/auth/login', { code: code.value.trim(), pin: pin.value });
      onLogin(res);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  };
  btn.addEventListener('click', submit);
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') pin.focus(); });
  setTimeout(() => code.focus(), 50);
  return h('div', { class: 'col', style: { gap: '14px' } },
    h('label', { class: 'fld' }, 'Personal-Code', h('div', { class: 'inp' }, ic('user', 17), code)),
    h('label', { class: 'fld' }, 'PIN', h('div', { class: 'inp' }, ic('shield', 17), pin)),
    btn,
    h('div', { class: 'row', style: { justifyContent: 'center', gap: '6px' } },
      h('span', { class: 'sub' }, 'Code vergessen?'),
      h('span', { style: { fontSize: '12px', fontWeight: 700, color: 'var(--fg-brand)' } }, 'Crew-Büro kontaktieren')));
}

function registerForm(onLogin) {
  const name = h('input', { placeholder: 'Vor- und Nachname', autocomplete: 'name' });
  const kontakt = h('input', { placeholder: 'E-Mail oder Handy (optional)' });
  const ortSel = h('select', {}, h('option', { value: '' }, 'Ort wählen (für Fahrgruppen)'));
  get('/api/auth/orte').then((orte) => {
    for (const o of orte) ortSel.appendChild(h('option', { value: o }, o));
  }).catch(() => { /* Ortswahl ist optional */ });
  const pin = h('input', { type: 'password', placeholder: 'mind. 4 Stellen', inputmode: 'numeric' });
  const btn = h('button', { class: 'btn lg orange' }, 'Scare-Actor-Profil anlegen', ic('chev', 17));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await post('/api/auth/register', {
        name: name.value.trim(), kontakt: kontakt.value.trim(), ort: ortSel.value, pin: pin.value,
      });
      toast(`Willkommen, ${res.person.name}! Dein Personal-Code: ${res.person.code}`, 'ok');
      onLogin(res);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  });
  return h('div', { class: 'col', style: { gap: '14px' } },
    h('div', { class: 'card pad row', style: { gap: '10px', background: 'var(--bg-muted)', boxShadow: 'none' } },
      ic('link', 16, { color: 'var(--fg-muted)' }),
      h('span', { class: 'sub', style: { fontSize: '12.5px' } },
        'Du legst dein eigenes Profil an. Mit dem Verknüpfungscode vom Crew-Büro wird es danach mit der Verwaltung verbunden — erst dann zählt dein Live-Tracking richtig.')),
    h('label', { class: 'fld' }, 'Name', h('div', { class: 'inp' }, ic('user', 17), name)),
    h('label', { class: 'fld' }, 'Kontakt', h('div', { class: 'inp' }, ic('send', 17), kontakt)),
    h('label', { class: 'fld' }, 'Wohnort', h('div', { class: 'inp' }, ic('pin', 17), ortSel)),
    h('label', { class: 'fld' }, 'PIN wählen', h('div', { class: 'inp' }, ic('shield', 17), pin)),
    btn);
}

function demoHint() {
  const open = h('div', { class: 'col', style: { gap: '6px', display: 'none' } },
    ...[['DR-0001', '4711', 'Management · Leitstand'], ['MT-0301', '1234', 'Maze Lead · Asylum'],
      ['LK-0427', '1234', 'Scare Actor · A3'], ['SB-0901', '1234', 'Catering · Station Nord']]
      .map(([c, p, r]) => h('div', { class: 'row', style: { fontSize: '12px', gap: '8px' } },
        h('b', { class: 'mono' }, c), h('span', { class: 'mono', style: { color: 'var(--fg-muted)' } }, `PIN ${p}`),
        h('span', { class: 'sub' }, r))));
  const head = h('div', { class: 'card pad row', style: { gap: '10px', cursor: 'pointer' } },
    h('span', { class: 'qa ic-ring info', style: { width: '34px', height: '34px', minHeight: 0, padding: 0, border: 'none', boxShadow: 'none', background: 'var(--color-info-light)', color: 'var(--color-info)', borderRadius: '50%' } }, ic('qr', 17)),
    h('div', { class: 'col grow', style: { gap: '1px' } },
      h('span', { style: { fontSize: '13px', fontWeight: 700 } }, 'Demo-Zugänge anzeigen'),
      h('span', { class: 'sub' }, 'Vier Rollen zum Ausprobieren')),
    ic('chev', 16, { color: 'var(--fg-muted)' }));
  head.addEventListener('click', () => { open.style.display = open.style.display === 'none' ? 'flex' : 'none'; });
  return h('div', { class: 'col', style: { gap: '8px' } }, head, open);
}

// ───────── Rollenwahl (Mockup RoleScreen) ─────────
const ROLE_META = {
  actor: { ic: 'walk', t: 'Scare Actor', d: 'Schicht, Karte, Pausen, Marken — auf dem Handy' },
  springer: { ic: 'walk', t: 'Springer', d: 'Wie Scare Actor, plus Einsprung-Anfragen' },
  lead: { ic: 'users', t: 'Maze Lead', d: 'Team, Pausen-Freigaben, Vorfälle — fürs Tablet' },
  catering: { ic: 'cup', t: 'Catering-Station', d: 'Marken scannen und entwerten' },
  management: { ic: 'grid', t: 'Management', d: 'Voller Leitstand auf Desktop & Tablet' },
};

export function renderRoleSelect(me, onPick, onLogout) {
  const roles = me.roles || [];
  return h('div', { class: 'login-page' },
    h('div', { class: 'login-card', style: { marginTop: '60px' } },
      h('div', { class: 'login-body' },
        h('div', { class: 'col', style: { gap: '2px' } },
          h('span', { class: 'overline' }, 'Rollenwahl'),
          h('span', { style: { fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '24px' } },
            `Willkommen, ${me.person.name.split(' ')[0]} 👋`),
          h('span', { class: 'sub', style: { fontSize: '13px' } },
            'Du bist für die Horrornacht eingeteilt. In welchem Modus möchtest du starten?')),
        ...roles.map((r) => {
          const m = ROLE_META[r] || ROLE_META.actor;
          return h('div', {
            class: 'card pad row role-card', style: { gap: '12px', padding: '16px' },
            onclick: () => onPick(r),
          },
            h('span', { class: 'av lg navy', style: { borderRadius: '12px' } }, ic(m.ic, 21)),
            h('div', { class: 'col grow', style: { gap: '3px' } },
              h('span', { style: { fontSize: '15.5px', fontWeight: 800, fontFamily: 'var(--font-display)' } }, m.t),
              h('span', { class: 'sub' }, m.d)),
            ic('chev', 17, { color: 'var(--fg-muted)' }));
        }),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('span', { style: { fontSize: '12.5px', fontWeight: 700, color: 'var(--fg-muted)', cursor: 'pointer' }, onclick: onLogout }, 'Abmelden')))));
}
