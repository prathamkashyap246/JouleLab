// Shared 3D effects: scroll reveal (rotateX + rise) and pointer tilt on [data-tilt] cards
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
const scan = () => document.querySelectorAll('.card,.insight,.cmp>div,.code-panel,.how-copy,.dl,.modes,.spec,.ed,.res').forEach(el => {
  if (!el.dataset.rv) { el.dataset.rv = 1; el.classList.add('rv'); io.observe(el); }
});
scan();
const root = document.getElementById('root');
if (root) new MutationObserver(scan).observe(root, { childList: true });
document.addEventListener('pointermove', e => {
  const el = e.target.closest && e.target.closest('[data-tilt]');
  document.querySelectorAll('[data-tilt].hov').forEach(n => { if (n !== el) { n.classList.remove('hov'); n.style.transform = ''; } });
  if (!el) return;
  const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  el.classList.add('hov'); el.style.transform = `perspective(900px) rotateY(${x * 9}deg) rotateX(${-y * 9}deg) translateZ(8px)`;
});
