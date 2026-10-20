(function () {
  let open = null;

  function close() {
    if (!open) return;
    open.popup.remove();
    open.ref.setAttribute('aria-expanded', 'false');
    open = null;
  }

  function position(popup, ref) {
    const r = ref.getBoundingClientRect();
    const margin = 16;
    const viewport = document.documentElement.clientWidth;
    let left = r.left + window.scrollX - popup.offsetWidth / 2;
    left = Math.max(window.scrollX + margin,
      Math.min(left, window.scrollX + viewport - popup.offsetWidth - margin));
    popup.style.left = left + 'px';
    popup.style.top = (r.bottom + window.scrollY + 8) + 'px';
  }

  function show(ref) {
    const id = decodeURIComponent(ref.getAttribute('href').slice(1));
    const note = document.getElementById(id);
    if (!note) return;

    const popup = document.createElement('div');
    popup.className = 'footnote-popup';
    popup.setAttribute('role', 'note');
    popup.innerHTML = note.innerHTML;
    popup.querySelectorAll('.footnote-backref').forEach(function (a) { a.remove(); });

    const num = document.createElement('span');
    num.className = 'footnote-popup-num';
    num.textContent = ref.textContent;
    popup.prepend(num);

    document.body.appendChild(popup);
    position(popup, ref);
    ref.setAttribute('aria-expanded', 'true');
    open = { ref: ref, popup: popup };
  }

  document.addEventListener('click', function (e) {
    const ref = e.target.closest('a.footnote-ref');
    if (!ref) return;
    e.preventDefault();
    const same = open && open.ref === ref;
    close();
    if (!same) show(ref);
  });

  // iOS Safari doesn't dispatch click for taps on non-interactive elements, so dismiss on pointerdown.
  document.addEventListener('pointerdown', function (e) {
    if (!open) return;
    if (open.popup.contains(e.target) || e.target.closest('a.footnote-ref')) return;
    close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  window.addEventListener('resize', function () {
    if (open) position(open.popup, open.ref);
  });
})();
