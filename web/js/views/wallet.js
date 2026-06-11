// Crew-Wallet (Phone) — Mockup CateringWallet: Markenstand, rotierender
// Einmal-QR (60 s), Verlauf. Der QR ist echt scannbar (eigener Encoder).
import { h, ic, badge } from '../core/dom.js';
import { get } from '../core/api.js';
import { on, store } from '../core/store.js';
import { qrCanvas } from '../core/qr.js';

export async function walletView({ onCleanup, refresh }) {
  const data = await get('/api/catering/wallet');
  onCleanup(on(['catering'], refresh));

  const w = data.wallet;
  const pill = (icon, label, val, used) => h('div', { class: 'card pad row grow', style: { gap: '10px', padding: '12px 14px' } },
    h('span', { style: { width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-success-light)', color: 'var(--color-success)' } }, ic(icon, 18)),
    h('div', { class: 'col grow', style: { gap: 0 } },
      h('span', { class: 'num', style: { fontSize: '19px' } }, val),
      h('span', { class: 'sub', style: { fontSize: '11px' } }, label)),
    h('span', { class: 'sub', style: { fontSize: '10.5px', textAlign: 'right' } }, used));

  // QR + Countdown — erneuert sich selbst, ohne den ganzen View neu zu laden
  const qrBox = h('div', { class: 'qr-box' });
  const codeLine = h('span', { class: 'num wallet-code', style: { fontSize: '15px', letterSpacing: '0.06em' } });
  const ttl = h('span', { class: 'sub', style: { fontSize: '11.5px' } });
  let timer = null;
  const drawCode = (codeData) => {
    qrBox.replaceChildren(qrCanvas(codeData.qr, 4));
    codeLine.textContent = codeData.display;
    let left = codeData.secondsLeft;
    clearInterval(timer);
    timer = setInterval(async () => {
      left -= 1;
      ttl.textContent = `Einmal-Code · erneuert sich in ${Math.max(0, left)} s`;
      if (left <= 0) {
        clearInterval(timer);
        try { drawCode((await get('/api/catering/wallet')).code); } catch { /* nächster Versuch beim Re-Render */ }
      }
    }, 1000);
    ttl.textContent = `Einmal-Code · erneuert sich in ${left} s`;
  };
  drawCode(data.code);
  onCleanup(() => clearInterval(timer));

  return h('div', { class: 'col', style: { gap: '12px', flex: 1, minHeight: 0 } },
    h('div', { class: 'row', style: { gap: '10px' } },
      pill('cup', 'Getränkemarken', `${w.drinks.total - w.drinks.used} / ${w.drinks.total}`, w.drinks.used ? `${w.drinks.used} eingelöst` : 'offen'),
      pill('door', 'Essensmarke' + (w.meals.total > 1 ? 'n' : ''), `${w.meals.total - w.meals.used} / ${w.meals.total}`, w.meals.used ? `${w.meals.used} eingelöst` : 'offen')),
    h('div', { class: 'card pad col', style: { alignItems: 'center', gap: '10px', padding: '18px 16px' } },
      h('span', { class: 'overline' }, 'Am Catering-Stand vorzeigen'),
      qrBox,
      codeLine,
      h('div', { class: 'row', style: { gap: '6px' } },
        h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: 'var(--color-success)' } }),
        ttl)),
    h('div', { class: 'card pad row', style: { gap: '10px', background: 'var(--bg-muted)', boxShadow: 'none', padding: '11px' } },
      ic('shield', 16, { color: 'var(--fg-muted)' }),
      h('span', { class: 'sub', style: { fontSize: '12px' } },
        'Marken sind personengebunden. Jeder Code gilt genau einmal — Screenshots funktionieren nicht.')),
    h('div', { class: 'panel grow', style: { minHeight: '120px', overflow: 'hidden', display: 'flex' } },
      h('div', { class: 'panel-h' }, ic('clock', 16, { color: 'var(--fg-muted)' }), h('span', { class: 't' }, 'Verlauf heute')),
      h('div', { class: 'panel-b scroll', style: { gap: 0, paddingTop: '2px' } },
        data.history.length === 0 ? h('div', { class: 'empty-hint' }, 'Noch nichts eingelöst.')
          : h('div', { class: 'feed' }, data.history.map((r) => h('div', { class: 'f-row' },
            h('span', { class: 'f-time' }, r.time),
            h('div', { class: 'col grow', style: { gap: '1px' } },
              h('span', { class: 'f-txt' },
                [r.drinks ? `${r.drinks} Getränkemarke${r.drinks > 1 ? 'n' : ''}` : null, r.meals ? `${r.meals} Essensmarke${r.meals > 1 ? 'n' : ''}` : null]
                  .filter(Boolean).join(' + ') + ' eingelöst'),
              h('span', { class: 'f-meta' }, r.station))))))));
}
