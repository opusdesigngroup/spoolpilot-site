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

  /* A phone photo of a slicer panel is light text on a dark panel, small in the frame, with
     screen moire. Tesseract reads that badly as-is. Prepare it first: orient, scale to a
     width the engine likes, grayscale, invert when the image is mostly dark, stretch the
     contrast. The original is kept as a second attempt in case the preparation hurt a clean
     screenshot. Nothing leaves the page; the canvas is local. */
  function prepare(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var target = 2200;
          var scale = Math.min(2.5, Math.max(1, target / img.naturalWidth));
          if (img.naturalWidth > 3200) scale = 3000 / img.naturalWidth;
          var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          var ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, w, h);
          var d = ctx.getImageData(0, 0, w, h), px = d.data, n = px.length / 4;
          var hist = new Uint32Array(256), sum = 0, i, l;
          for (i = 0; i < n; i++) {
            l = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000 | 0;
            px[i * 4] = l; hist[l]++; sum += l;
          }
          var dark = (sum / n) < 118;
          // percentile stretch: 2nd..98th -> 0..255
          var lo = 0, hi = 255, acc = 0;
          for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
          acc = 0;
          for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.02) { hi = i; break; } }
          var range = Math.max(1, hi - lo);
          for (i = 0; i < n; i++) {
            l = Math.max(0, Math.min(255, ((px[i * 4] - lo) * 255 / range) | 0));
            if (dark) l = 255 - l;
            px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = l;
          }
          ctx.putImageData(d, 0, 0);
          URL.revokeObjectURL(url);
          resolve({ prepared: c, inverted: dark });
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      // The browser could not decode it: not an image, or a format it does not open (HEIC in
      // some browsers). That is a different failure from "the reader did not load".
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ undecodable: true }); };
      img.src = url;
    });
  }

  /* Progress from the engine, in the person's words. The first scan on a phone downloads the
     reader and its language data, several megabytes on mobile data, and for that stretch the
     old copy said only "Reading…" while the box sat dimmed. HeyCatch showed people tapping the
     box eight times in a row: nothing they could see was happening. Now the line moves. */
  function progress(m) {
    if (!m || !m.status) return;
    var pct = typeof m.progress === 'number' ? Math.round(m.progress * 100) : null;
    if (/recogniz/i.test(m.status)) {
      say('Reading the image' + (pct != null ? '… ' + pct + '%' : '…'));
    } else if (/traineddata|language/i.test(m.status)) {
      say('Downloading the reader (first time only)' + (pct != null && pct > 0 ? '… ' + pct + '%' : '…'));
    } else {
      say('Getting the reader ready…');
    }
  }

  function recognize(T, source) {
    return T.recognize(source, 'eng', { logger: progress }).then(function (res) { return res.data.text || ''; });
  }

  function handle(file) {
    if (!file) return;
    if (busy) { say('Still reading the last one. One moment.'); return; }
    // Android file providers often hand over a photo with an EMPTY type. Refusing those made the
    // control look dead: pick a photo, nothing happens, pick again. An empty type goes through
    // and the decoder decides; only a type that says it is not an image is turned away here.
    if (file.type && !/^image\//.test(file.type)) {
      say('That file is not an image. Pick a screenshot or a photo of the slicer.', 'warn');
      return;
    }
    busy = true;
    drop.classList.add('busy');
    say(window.Tesseract ? 'Reading…' : 'Loading the reader (first time only)…');

    var engine;
    loadTesseract()
      .then(function (T) { engine = T; return prepare(file); })
      .then(function (prep) {
        if (prep && prep.undecodable) {
          say('That file did not open as an image. Take a photo, or save the screenshot as a JPEG or PNG.', 'warn');
          return null;
        }
        var first = prep ? prep.prepared : file;
        return recognize(engine, first).then(function (raw) {
          var reading = window.SlicerScan.parse(raw);
          if (reading.complete || !prep) return { raw: raw, reading: reading };
          // The prepared image missed. A clean screenshot sometimes reads better untouched.
          return recognize(engine, file).then(function (raw2) {
            var r2 = window.SlicerScan.parse(raw2);
            return r2.complete || (r2.minutes != null || r2.grams != null) && !(reading.minutes != null || reading.grams != null)
              ? { raw: raw2, reading: r2 } : { raw: raw, reading: reading };
          });
        });
      })
      .then(function (out) {
        if (!out) return;
        // Keep the raw OCR on the page object. Nothing is sent anywhere; it exists so a
        // misread can be diagnosed from what the engine actually saw rather than guessed at.
        // `copy(SlicerScan.lastOCR)` in the console hands over the exact text.
        window.SlicerScan.lastOCR = out.raw;
        // Deliberately not "scan failed" on a miss. The likeliest causes are a cropped panel
        // or a photo taken at an angle, both fixable by the person holding the phone.
        apply(out.reading, 'image');
      })
      .catch(function () {
        say('Could not load the scanner. Type the numbers in below instead.', 'warn');
      })
      .then(function () {
        busy = false;
        drop.classList.remove('busy');
      });
  }

  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    // Clear the input so picking the SAME photo again fires change again. Without this a retry
    // with the same file was a tap that did nothing.
    input.value = '';
    handle(f);
  });
  // While a read is running, a tap on the box would open the chooser for a file that would then
  // be ignored. Say what is happening instead.
  drop.addEventListener('click', function (e) {
    if (busy) { e.preventDefault(); say('Still reading the last one. One moment.'); }
  });

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
  ['c-hours', 'c-mins', 'c-grams'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', function () { mark(id, false); });
  });

  function undo() {
    if (!before) return;
    fill('c-hours', before.hours); fill('c-mins', before.mins); fill('c-grams', before.grams);
    mark('c-hours', false); mark('c-mins', false); mark('c-grams', false);
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
    before = { hours: document.getElementById('c-hours').value, mins: document.getElementById('c-mins').value,
               grams: document.getElementById('c-grams').value };
    var h = Math.floor(reading.minutes / 60), m = Math.round(reading.minutes % 60);
    // The slicer shows hours and minutes; the two fields take them as read, no decimal hours.
    fill('c-hours', h); fill('c-mins', m);
    fill('c-grams', reading.grams);
    mark('c-hours', true); mark('c-mins', true); mark('c-grams', true);
    // The fills above recalculated before the marks existed; one more change event lets the
    // calculator see that these numbers came from a scan.
    document.getElementById('c-grams').dispatchEvent(new Event('change', { bubbles: true }));
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

  // The Android ask. iPhone and iPad visitors never see it: they have the app. Everyone else
  // (Android, and desktop, where the phone in the pocket is unknown) sees one line and a
  // field. A demand count, not a launch — the copy in the HTML says so and must keep saying so.
  var ask = document.getElementById('scan-android');
  var ua = navigator.userAgent || '';
  var isApple = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && 'ontouchstart' in window);
  if (ask && !isApple) ask.hidden = false;

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
