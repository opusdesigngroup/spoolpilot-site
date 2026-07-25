// Shared waitlist handler — identical behaviour across every page and every design version.
// Reads MailerLite's real response: celebrates only on genuine success, shows a real error otherwise.
(function () {
  function showSuccess(form) {
    var note = form.nextElementSibling;
    if (note && note.classList.contains('note')) note.remove();
    var box = document.createElement('div');
    box.className = 'waitlist-success';
    box.setAttribute('role', 'status');
    box.innerHTML = '<h3>You’re on the list</h3><p>Thanks for being early — we’ll email you the moment the SpoolPilot beta opens.</p>';
    form.replaceWith(box);
  }
  function clearError(form) {
    var next = form.nextElementSibling;
    if (next && next.classList.contains('waitlist-error')) next.remove();
  }
  function showError(form, btn, label) {
    if (btn) { btn.disabled = false; btn.textContent = label; }
    clearError(form);
    var msg = document.createElement('p');
    msg.className = 'waitlist-error';
    msg.setAttribute('role', 'alert');
    msg.textContent = 'That didn’t go through — please check your email and try again.';
    form.insertAdjacentElement('afterend', msg);
  }
  document.querySelectorAll('form.waitlist').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var btn = form.querySelector('button[type="submit"]');
      var label = btn ? btn.textContent : 'Join the waitlist';
      if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }
      clearError(form);
      fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }, function () { return { ok: r.ok, data: {} }; }); })
        .then(function (res) {
          if (res.ok && res.data && res.data.success) { showSuccess(form); } else { showError(form, btn, label); }
        })
        .catch(function () { showError(form, btn, label); });
    });
  });
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
})();
