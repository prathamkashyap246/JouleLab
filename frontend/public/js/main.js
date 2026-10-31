// Vanilla JS: hero layer explode (with per-layer details) + "how it works" accordion
const stage = document.getElementById('stage'), legend = document.getElementById('legend'), btn = document.getElementById('explode');
let tick;
const highlight = n => n ? stage.setAttribute('data-hl', n) : stage.removeAttribute('data-hl');
const items = [...legend.querySelectorAll('li')];
const setOn = n => items.forEach(li => li.classList.toggle('on', li.dataset.l === String(n)));

btn.addEventListener('click', () => {
  const on = stage.classList.toggle('exploded'); document.querySelector('.hero-art').classList.toggle('ex', on);
  btn.setAttribute('aria-expanded', on);
  document.getElementById('exlabel').textContent = on ? 'Collapse layers' : 'Explode layers';
  btn.querySelector('span').textContent = on ? '−' : '+';
  highlight(null); setOn(null);
  clearInterval(tick);
  if (on) tick = setInterval(() => { // small live jitter on the profiling card
    document.getElementById('volt').firstChild.textContent = (3.3 + (Math.random() - .5) * .04).toFixed(2);
    document.getElementById('amp').textContent = 'I ' + (3.4 + Math.random() * .3).toFixed(2) + ' mA';
  }, 800);
});
items.forEach(li => {
  const on = () => { highlight(li.dataset.l); setOn(li.dataset.l); }, off = () => { highlight(null); setOn(null); };
  li.addEventListener('mouseenter', on); li.addEventListener('focus', on);
  li.addEventListener('mouseleave', off); li.addEventListener('blur', off);
});
stage.querySelectorAll('.layer').forEach(l => {
  l.addEventListener('mouseenter', () => { if (stage.classList.contains('exploded')) { highlight(l.dataset.l); setOn(l.dataset.l); } });
  l.addEventListener('mouseleave', () => { highlight(null); setOn(null); });
});

document.querySelectorAll('.acc .item button').forEach(b => b.addEventListener('click', () => {
  const item = b.parentElement, open = item.classList.contains('open');
  document.querySelectorAll('.acc .item').forEach(i => { i.classList.remove('open'); i.querySelector('i').textContent = '+'; });
  if (!open) { item.classList.add('open'); b.querySelector('i').textContent = '×'; }
}));

// 3D motion: the hero board floats and follows the pointer (perspective tilt)
const hero = document.querySelector('.hero'), tilt = document.getElementById('tilt');
const calm = matchMedia('(prefers-reduced-motion:reduce)').matches;
let tx = 0, ty = 0, cx = 0, cy = 0;
hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - .5) * 2; ty = ((e.clientY - r.top) / r.height - .5) * 2; });
hero.addEventListener('pointerleave', () => { tx = ty = 0; });
(function loop(t) {
  cx += (tx - cx) * .06; cy += (ty - cy) * .06;
  if (!calm) tilt.style.transform = `rotateX(${-cy * 9}deg) rotateY(${cx * 12}deg) translateY(${Math.sin(t / 900) * 7}px)`;
  requestAnimationFrame(loop);
})(0);
