// Buy menu: weapons grouped by type plus armour and the defuse kit.
// Big touch-friendly cards; anything you can't buy is greyed out with the reason.
import { WEAPONS, BUY_GROUPS, EQUIPMENT, WEAPON_ICONS, canTeamBuy } from './weapons.js';

const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
const SIDE = { atk: 'Attackers', def: 'Defenders', both: 'Both sides' };

const GEAR_ICONS = {
  vest: '<path d="M44 6h10l6 6 6-6h10l12 8-6 10v14H38V24l-6-10z"/>',
  vesthelm: '<path d="M30 10h8l5 5 5-5h8l9 6-5 8v12H26V24l-5-8z"/><path d="M76 24c0-10 8-16 18-16s18 6 18 16v4H76z"/><path d="M74 28h40v4H74z"/>',
  helmet: '<path d="M38 26c0-12 10-20 22-20s22 8 22 20v4H38z"/><path d="M34 30h52v5H34z"/>',
  kit: '<rect x="36" y="10" width="48" height="24" rx="4"/><path d="M52 6h16v6H52z"/><path d="M58 16h4v14h-4zM53 21h14v4H53z" fill="#111"/>',
};

export class BuyMenu {
  constructor(onBuy, onRefund) {
    this.onBuy = onBuy;
    this.onRefund = onRefund;
    this.sig = '';
    this.root = $('buy-groups');
    this.handler = (e) => {
      const b = e.target.closest('[data-item]');
      if (!b || b.disabled) return;
      if (b.dataset.refund) this.onRefund(b.dataset.item);
      else this.onBuy(b.dataset.item);
    };
    this.root.addEventListener('click', this.handler);
  }

  destroy() { this.root.removeEventListener('click', this.handler); this.root.replaceChildren(); }

  // price of a piece of gear for this player, or null if it makes no sense right now
  gearPrice(id, s) {
    if (id === 'vest') return s.armor >= 100 ? null : EQUIPMENT.vest.price;
    if (id === 'vesthelm') {
      const needVest = s.armor < 100, needHelm = !s.helmet;
      if (!needVest && !needHelm) return null;
      return needVest && needHelm ? EQUIPMENT.vesthelm.price : needVest ? EQUIPMENT.vest.price : EQUIPMENT.helmet.price;
    }
    if (id === 'helmet') return s.helmet ? null : EQUIPMENT.helmet.price;
    if (id === 'kit') return s.kit ? null : EQUIPMENT.kit.price;
    return null;
  }

  card(item, name, icon, price, note, state, cls = '') {
    if (state.refund != null) {
      // owned and still refundable: tapping it sells it back
      return `<button class="buy-item owned refundable ${cls}" data-item="${item}" data-refund="1">`
        + `<svg viewBox="0 0 120 40" aria-hidden="true">${icon}</svg>`
        + `<b>${name}</b><span class="price">${money(state.refund)}</span>`
        + `<small>${note}</small><i class="badge refund">↩ Refund ${money(state.refund)}</i></button>`;
    }
    return `<button class="buy-item ${cls}" data-item="${item}" ${state.disabled ? 'disabled' : ''}>`
      + `<svg viewBox="0 0 120 40" aria-hidden="true">${icon}</svg>`
      + `<b>${name}</b><span class="price">${price == null ? '' : money(price)}</span>`
      + `<small>${note}</small>${state.badge ? `<i class="badge">${state.badge}</i>` : ''}</button>`;
  }

  // s: { open, money, team, inv, armor, helmet, kit, canBuy, timeLeft, practice, dm }
  // dm (deathmatch): every gun is free at any time and armour is automatic, so gear is hidden
  update(s) {
    $('buy').classList.toggle('hidden', !s.open);
    if (!s.open) { this.sig = ''; return; }
    const free = s.practice || s.dm;
    $('buy-money').textContent = s.dm ? 'Free in deathmatch' : s.practice ? 'Free in practice' : money(s.money);
    $('buy-time').textContent = free ? '' : (s.canBuy ? `Buy time ${Math.ceil(s.timeLeft)} s` : 'Buy time over');
    $('buy-note').textContent = s.dm ? 'Pick any gun, any time. You keep your choice when you respawn.'
      : s.canBuy ? (s.practice ? 'Practice: everything is free and you can buy anywhere.' : 'Stay in your spawn area to buy.')
        : 'You can only buy in your spawn area during the first 20 seconds of a round.';
    const refunds = s.canBuy && !s.dm ? (s.refunds || {}) : {};
    const sig = JSON.stringify([s.money, s.team, s.inv, s.armor, s.helmet, s.kit, s.canBuy, s.practice, s.dm, refunds]);
    if (sig === this.sig) return;
    this.sig = sig;
    let html = '';
    for (const group of BUY_GROUPS) {
      html += `<section><h3>${group.name}</h3><div class="buy-row">`;
      for (const id of group.ids) {
        const w = WEAPONS[id];
        const owned = s.inv.primary === id || s.inv.secondary === id;
        const wrongSide = !free && !canTeamBuy(w, s.team);
        const poor = !free && s.money < w.price;
        const st = { disabled: !s.canBuy || wrongSide || (poor && !owned), badge: owned ? 'Owned' : wrongSide ? SIDE[w.team] + ' only' : poor ? 'Can’t afford' : '' };
        if (owned && id in refunds) st.refund = refunds[id];
        const cls = `${w.team === 'both' ? '' : 'side-' + w.team}${owned ? ' owned' : ''}`;
        html += s.dm ? this.card(id, w.name, WEAPON_ICONS[id], null, w.blurb, st, owned ? 'owned' : '')
          : this.card(id, w.name, WEAPON_ICONS[id], w.price, `${SIDE[w.team]} · kill ${money(w.reward)}`, st, cls);
      }
      html += '</div></section>';
    }
    if (s.dm) { this.root.innerHTML = html; return; }
    html += '<section><h3>Gear</h3><div class="buy-row">';
    for (const id of ['vest', 'vesthelm', 'helmet', 'kit']) {
      const e = EQUIPMENT[id];
      const price = this.gearPrice(id, s);
      const wrongSide = !s.practice && e.team !== 'both' && e.team !== s.team;
      const owned = price == null;
      const needVest = id === 'helmet' && !s.helmet && s.armor < 100;
      const poor = !s.practice && price != null && s.money < price;
      const st = {
        disabled: !s.canBuy || owned || wrongSide || poor || needVest,
        badge: owned ? 'Owned' : wrongSide ? 'Defenders only' : needVest ? 'Needs full vest' : poor ? 'Can’t afford' : '',
      };
      if (id in refunds) st.refund = refunds[id];
      html += this.card(id, e.name, GEAR_ICONS[id], price == null ? e.price : price, e.blurb, st, 'gear' + (owned ? ' owned' : ''));
    }
    html += '</div></section>';
    this.root.innerHTML = html;
  }
}
