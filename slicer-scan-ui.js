/* Wires the scan drop zone to the parser and the calculator's own fields.
 *
 * Tesseract is ~2MB of WASM plus language data, so it is loaded on FIRST USE and never on a
 * plain page view. Someone who only wants to type numbers pays nothing for this existing.
 *
 * The numbers land in the normal inputs and stay editable. OCR of a photographed screen is
 * wrong often enough that presenting a result as settled would be the confident-wrong-number
 * failure the whole product exists to avoid — so the copy says what was read and invites a fix.
 */
(function () {
  'use strict';
  var drop = document.getElementById('scan-drop');
  var input = document.getElementById('scan-file');
  var sub = document.getElementById('scan-sub');
  var out = document.getElementById('scan-result');
  if (!drop || !input || !window.SlicerScan) return;

  var TESSERACT_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js';
  var loading = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = TESSERACT_SRC;
      s.onload = function () { resolve(window.Tesseract); };
      s.onerror = function () { loading = null; reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function say(text, cls) {
    out.hidden = false;
    out.textContent = text;
    out.className = 'scan-result' + (cls ? ' ' + cls : '');
  }

  function fill(id, value) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    // The calculator recalculates on input; dispatching keeps this path identical to typing.
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  var busy = false;

  function handle(file) {
    if (busy || !file || !/^image\//.test(file.type)) return;
    busy = true;
    drop.classList.add('busy');
    say('Reading…');

    loadTesseract()
      .then(function (T) { return T.recognize(file, 'eng'); })
      .then(function (res) {
        var raw = res.data.text || '';
        // Keep the raw OCR on the page object. Nothing is sent anywhere; it exists so a
        // misread can be diagnosed from what the engine actually saw rather than guessed at.
        // `copy(SlicerScan.lastOCR)` in the console hands over the exact text.
        window.SlicerScan.lastOCR = raw;
        // Deliberately not "scan failed" on a miss. The likeliest causes are a cropped panel
        // or a photo taken at an angle, both fixable by the person holding the phone.
        apply(window.SlicerScan.parse(raw), 'image');
      })
      .catch(function () {
        say('Could not load the scanner. Type the numbers in below instead.', 'warn');
      })
      .then(function () {
        busy = false;
        drop.classList.remove('busy');
      });
  }

  input.addEventListener('change', function () { handle(input.files && input.files[0]); });

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handle(f);
  });

  /* Apply a reading that came from anywhere — OCR or pasted text. */
  // What was in the two fields before the last fill, so a wrong read costs one click, not a
  // retype. The scan overwrote typed values silently; a misread weight became the listing price.
  var before = null;

  function mark(id, on) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('scanned', !!on);
  }
  ['c-hours', 'c-grams'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', function () { mark(id, false); });
  });

  function undo() {
    if (!before) return;
    fill('c-hours', before.hours); fill('c-grams', before.grams);
    mark('c-hours', false); mark('c-grams', false);
    before = null;
    say('Put your numbers back.', '');
  }

  function apply(reading, how) {
    if (!reading.complete) {
      // The advice has to match what the person did: a photo is fixed by reframing, a paste by
      // selecting more.
      say(how === 'text'
            ? 'No print time and weight in that text. Copy both Total lines, or type them below.'
            : 'Couldn’t read a time and a weight. Retake straight-on with the whole results panel in frame, or type them below.',
          'warn');
      return false;
    }
    before = { hours: document.getElementById('c-hours').value, grams: document.getElementById('c-grams').value };
    fill('c-hours', Math.round(reading.minutes / 60 * 100) / 100);
    fill('c-grams', reading.grams);
    mark('c-hours', true); mark('c-grams', true);
    var h = Math.floor(reading.minutes / 60), m = reading.minutes % 60;
    say('Read ' + (h ? h + 'h ' : '') + m + 'm and ' + reading.grams + ' g'
        + (reading.slicer ? ' from ' + reading.slicer : '')
        + (how === 'text' ? '.' : '. Check the two fields below.'), 'ok');
    var u = document.createElement('button');
    u.type = 'button'; u.className = 'scan-undo'; u.textContent = 'Undo';
    u.addEventListener('click', undo);
    out.appendChild(u);
    return true;
  }

  // Paste anywhere on the page. Two kinds, and TEXT IS THE BETTER ONE: if the slicer's panel
  // can be selected and copied, parsing it needs no OCR at all — instant, exact, and no 2MB
  // download. So text is tried first and only falls through to the image path when the
  // clipboard holds a picture. Someone who selects the Total Estimation block and hits ⌘V
  // gets a perfect reading; someone who screenshots gets a good one.
  document.addEventListener('paste', function (e) {
    if (!e.clipboardData) return;

    var text = e.clipboardData.getData('text/plain');
    if (text && text.trim().length > 3) {
      var reading = window.SlicerScan.parse(text);
      if (reading.complete) { e.preventDefault(); apply(reading, 'text'); return; }
      // A miss is only worth reporting when the paste plainly WAS slicer output. Text with
      // one of the two numbers and not the other means a partial selection, and saying so
      // is the difference between "nothing happened" and "select a bit more". Text with
      // neither is someone pasting into a field, and must pass through untouched.
      if (reading.minutes != null || reading.grams != null) {
        say(reading.minutes != null
              ? 'Found the print time but no filament weight. Select the Total Filament line too, or type the grams in below.'
              : 'Found a filament weight but no print time. Select the total time line too, or type the hours in below.',
            'warn');
        return;
      }
      // Neither number present: someone is pasting into a field, and the paste must pass
      // through untouched. Clear a WARNING first, though — "select the Total Filament line
      // too" is an instruction about the previous paste, and leaving it up while the user
      // does something else makes it read as a complaint about what they just did. A success
      // line is not cleared: it records where the filled-in numbers came from.
      if (out.classList.contains('warn')) { out.hidden = true; out.textContent = ''; out.className = 'scan-result'; }
    }

    var items = e.clipboardData.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        e.preventDefault();
        handle(items[i].getAsFile());
        return;
      }
    }
  });

  // Only claim the camera where one exists, so desktop copy doesn't promise a phone feature.
  // Copying the text is named first on both, because it needs no OCR and cannot misread.
  if (!('ontouchstart' in window)) {
    // Screenshot first, paste second. Bambu Studio's slicing panel is not selectable text, so
    // "copy the slice results" is impossible advice for the slicer most of these visitors run —
    // and leading with an instruction the reader cannot follow reads as a broken tool. Pasting
    // is still named, because where it IS possible (PrusaSlicer, Cura) it needs no OCR and
    // cannot misread.
    sub.textContent = 'Drop a screenshot here, or paste one. Or paste the text if your slicer lets you copy it. Bambu Studio, OrcaSlicer, PrusaSlicer, Cura. Nothing is uploaded.';
  }
})();
