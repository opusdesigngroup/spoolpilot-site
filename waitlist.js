// Shared waitlist handler — identical behaviour across every page and every design version.
// Reads MailerLite's real response: celebrates only on genuine success, shows a real error otherwise.
(function () {
  function showSuccess(form) {
    var note = form.nextElementSibling;
    if (note && note.classList.contains('note')) note.remove();
    var box = document.createElement('div');
    box.className = 'waitlist-success';
    box.setAttribute('role', 'status');
    box.innerHTML = '<h3>You’re on the list</h3><p>Occasional product updates, nothing else. Unsubscribe any time.</p>';
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
  // Domain-typo catcher: a one-field form's only common failure is a fat-fingered domain, and a
  // wrong email here means the updates never arrive — the worst silent failure this
  // site can produce. Suggest, never auto-correct: one tap accepts, typing on dismisses.
  var domainFixes = {
    'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com',
    'gmai.com': 'gmail.com', 'gmail.cm': 'gmail.com', 'googlemail.co': 'googlemail.com',
    'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com',
    'hotmial.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmai.com': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com',
    'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com', 'iclould.com': 'icloud.com',
    'aol.co': 'aol.com', 'comcast.nte': 'comcast.net'
  };
  function clearHint(form) {
    var next = form.parentElement.querySelector('.waitlist-hint');
    if (next) next.remove();
  }
  function suggestFix(form, input) {
    clearHint(form);
    var v = input.value.trim();
    var at = v.lastIndexOf('@');
    if (at < 1) return;
    var domain = v.slice(at + 1).toLowerCase();
    var fix = domainFixes[domain];
    if (!fix) return;
    var corrected = v.slice(0, at + 1) + fix;
    var hint = document.createElement('p');
    hint.className = 'waitlist-hint';
    hint.setAttribute('role', 'status');
    hint.innerHTML = 'Did you mean <button type="button">' + corrected.replace(/</g, '&lt;') + '</button>?';
    hint.querySelector('button').addEventListener('click', function () {
      input.value = corrected;
      hint.remove();
      input.focus();
    });
    form.insertAdjacentElement('afterend', hint);
  }
  document.querySelectorAll('form.waitlist').forEach(function (form) {
    var email = form.querySelector('input[type="email"]');
    if (email) {
      email.addEventListener('blur', function () { suggestFix(form, email); });
      email.addEventListener('input', function () { clearHint(form); });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      // Pause once on a suspected domain typo; a second submit of the same value goes through.
      if (email) {
        var v = email.value.trim(), at = v.lastIndexOf('@');
        var fix = at > 0 ? domainFixes[v.slice(at + 1).toLowerCase()] : null;
        if (fix && form.dataset.warned !== v) {
          form.dataset.warned = v;
          suggestFix(form, email);
          return;
        }
      }
      clearHint(form);
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
