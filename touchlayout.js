// Phone / tablet button layout: every touch button can be moved, resized and faded.
// settings.touchLayout = { 'btn-fire': { x, y, s, o }, … } — x / y are the button centre as a
// share of the screen width / height, s = size (1 = normal), o = opacity. Missing = default spot.

const EDITABLE = ['btn-fire', 'btn-fire-left', 'btn-jump', 'btn-reload', 'btn-alt', 'btn-swap', 'btn-use',
  'btn-buy', 'btn-drop', 'btn-inspect', 'btn-chat', 'btn-light', 'btn-score', 'btn-menu'];

export function applyTouchLayout(layout) {
  for (const id of EDITABLE) {
    const el = document.getElementById(id);
    if (!el) continue;
    const c = layout && layout[id];
    if (!c) {
      el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = el.style.opacity = '';
      continue;
    }
    el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.left = `${(c.x * 100).toFixed(2)}%`;
    el.style.top = `${(c.y * 100).toFixed(2)}%`;
    el.style.transform = `translate(-50%, -50%) scale(${c.s || 1})`;
    el.style.opacity = c.o != null ? String(c.o) : '';
  }
}

// Full-screen editor. onDone(layout) is called with the new layout.
export function openLayoutEditor(layout, onSave) {
  const L = JSON.parse(JSON.stringify(layout || {}));
  const root = document.getElementById('touch');
  const panel = document.getElementById('layout-editor');
  const $ = id => document.getElementById(id);
  document.body.classList.add('layout-edit');
  panel.classList.remove('hidden');
  applyTouchLayout(L);
  let sel = null, drag = null;

  const centreOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight };
  };
  const entry = (el) => {
    if (!L[el.id]) { const c = centreOf(el); L[el.id] = { x: c.x, y: c.y, s: 1, o: 1 }; }
    return L[el.id];
  };
  const select = (el) => {
    if (sel) sel.classList.remove('le-selected');
    sel = el;
    const on = !!el;
    for (const id of ['le-size', 'le-op', 'le-reset-one']) $(id).disabled = !on;
    if (!el) { $('le-title').textContent = 'Tap a button to change it, drag to move it'; return; }
    el.classList.add('le-selected');
    // keep the panel away from the button being edited
    const r = el.getBoundingClientRect();
    panel.classList.toggle('bottom', r.top + r.height / 2 < innerHeight * 0.45);
    const e = L[el.id] || { s: 1, o: 1 };
    $('le-title').textContent = `Button: ${el.getAttribute('aria-label') || el.id}`;
    $('le-size').value = e.s || 1; $('le-size-out').textContent = `${Math.round((e.s || 1) * 100)}%`;
    $('le-op').value = e.o != null ? e.o : 1; $('le-op-out').textContent = `${Math.round((e.o != null ? e.o : 1) * 100)}%`;
  };

  const down = (e) => {
    const btn = e.target.closest('button');
    if (!btn || !EDITABLE.includes(btn.id)) { select(null); return; }
    e.preventDefault(); e.stopPropagation();
    select(btn);
    const c = entry(btn);
    drag = { id: e.pointerId, el: btn, dx: e.clientX / innerWidth - c.x, dy: e.clientY / innerHeight - c.y };
    try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const c = L[drag.el.id];
    c.x = Math.max(0.03, Math.min(0.97, e.clientX / innerWidth - drag.dx));
    c.y = Math.max(0.04, Math.min(0.96, e.clientY / innerHeight - drag.dy));
    applyTouchLayout(L);
  };
  const up = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  // capture phase so the game's own touch handlers never see these
  root.addEventListener('pointerdown', down, true);
  root.addEventListener('pointermove', move, true);
  root.addEventListener('pointerup', up, true);
  root.addEventListener('pointercancel', up, true);

  const onSize = (e) => { if (!sel) return; entry(sel).s = Number(e.target.value); $('le-size-out').textContent = `${Math.round(e.target.value * 100)}%`; applyTouchLayout(L); };
  const onOp = (e) => { if (!sel) return; entry(sel).o = Number(e.target.value); $('le-op-out').textContent = `${Math.round(e.target.value * 100)}%`; applyTouchLayout(L); };
  const resetOne = () => { if (!sel) return; delete L[sel.id]; applyTouchLayout(L); select(sel); };
  const resetAll = () => { for (const k of Object.keys(L)) delete L[k]; applyTouchLayout(L); select(null); };
  const done = () => {
    root.removeEventListener('pointerdown', down, true);
    root.removeEventListener('pointermove', move, true);
    root.removeEventListener('pointerup', up, true);
    root.removeEventListener('pointercancel', up, true);
    $('le-size').removeEventListener('input', onSize);
    $('le-op').removeEventListener('input', onOp);
    $('le-reset-one').removeEventListener('click', resetOne);
    $('le-reset-all').removeEventListener('click', resetAll);
    $('le-done').removeEventListener('click', done);
    select(null);
    document.body.classList.remove('layout-edit');
    panel.classList.add('hidden');
    onSave(L);
  };
  $('le-size').addEventListener('input', onSize);
  $('le-op').addEventListener('input', onOp);
  $('le-reset-one').addEventListener('click', resetOne);
  $('le-reset-all').addEventListener('click', resetAll);
  $('le-done').addEventListener('click', done);
  select(null);
}
