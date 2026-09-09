/* Read print time and filament weight off a slicer screenshot, in the browser.
 *
 * Ported from SlicerScan.swift, which was proven against real Bambu Studio, OrcaSlicer,
 * PrusaSlicer and Cura screens. Keep the two in step by hand if either learns a new layout.
 *
 * The web version is CAPTURE-then-read, not live. The iOS app runs Vision per frame with
 * streak-gated confidence, which is what makes it lock on; Tesseract needs about a second an
 * image, and a live version of that reads wrong numbers half the time. One still, one read,
 * numbers you can edit.
 *
 * Nothing is uploaded. Tesseract runs as a WASM worker in the page.
 */
(function () {
  'use strict';

  // A number then a unit NOT followed by another letter. That guard is what stops "3DBenchy"
  // reading as 3 days (the D is followed by B) while still allowing "54m24s". A plain \b
  // cannot do both. Horizontal whitespace only — \s spans newlines and would fuse three
  // separate rows into one bogus total.
  var DUR = '\\d+[ \\t]*(?:days?|hours?|minutes?|mins?|seconds?|secs?|[dhms])(?![A-Za-z])';

  // Most specific first. takeMax marks the unlabeled catch-alls: when a panel OCRs as split
  // columns the label and value land in separate fragments in arbitrary order, so only
  // value-shaped matches exist — and the largest duration is the total by construction,
  // since Total >= Prepare/Model on every slicer.
  var TIME = [
    { slicer: 'PrusaSlicer',              re: /estimated\s+printing\s+time\s*:?\s*([0-9dhms\s]+?)(?:\r?\n|$)/i, max: false },
    { slicer: 'Bambu Studio / OrcaSlicer', re: /total\b[^\d:\n]{0,20}:?\s*((?:\d+\s*d\s*)?(?:\d+\s*h\s*)?\d+\s*m(?:in)?(?:\s*\d+\s*s)?\b)/i, max: false },
    // Prusa prints two estimates. Name the normal one, or largest-candidate silently prices
    // every job at the slower stealth figure.
    { slicer: 'PrusaSlicer',              re: /normal\s+mode[^\d\n]{0,12}((?:\d+\s*d\s*)?(?:\d+\s*h\s*)?\d+\s*m(?:in)?(?:\s*\d+\s*s)?)/i, max: false },
    { slicer: 'Ultimaker Cura',           re: /(?<![\d.])((?:\d+[ \t]*days?[ \t]*)?(?:\d+[ \t]*hours?[ \t]*)?\d+[ \t]*min(?:ute)?s?)(?![A-Za-z])/gi, max: true },
    // Unlabeled: matches any layout, so it names no slicer. Reporting "from Ultimaker Cura"
    // off a split-column Bambu panel is a confident wrong statement about the user's tools.
    // Requires TWO or more units, so a lone token ("3D" from a filename, "79m" salvaged from
    // "3.79m") can never win the largest-candidate rule.
    { slicer: null,                       re: new RegExp('(?<![\\d.])((?:' + DUR + '[ \\t]*){2,})', 'gi'), max: true }
  ];

  // Slicers print "324,97 g" in every comma-decimal locale (de, fr, nl, es, it). Matching only
  // a dot made the pattern match the FRAGMENT "97" and report 97 g for a 324.97 g print — a
  // confident wrong number, three times too light, with no warning. Accept both separators and
  // normalize in NUM below.
  var DEC = '\\d+(?:[.,]\\d+)?';

  var WEIGHT = [
    // Prusa sidebar: "Used Filament (g)  150.33 (380.33)" — unit in parentheses BEFORE the
    // value, and the label can wrap. Tolerate a digit-free run, but stop at another
    // "filament" so this can never reach into the "(m)" row and read meters as grams.
    { slicer: 'PrusaSlicer',              re: new RegExp('filament\\s*\\((kg|g)\\)(?:(?!filament)[^\\d]){0,40}(' + DEC + ')', 'i'), max: false, unitFirst: true },
    { slicer: 'PrusaSlicer',              re: new RegExp('filament\\s+used\\s*:?\\s*(' + DEC + ')\\s*(kg|g)\\b', 'i'), max: false },
    { slicer: 'Bambu Studio / OrcaSlicer', re: new RegExp('total\\b[^\\d:\\n]{0,24}:?\\s*(?:' + DEC + '\\s*m\\s+)?(' + DEC + ')\\s*(kg|g)\\b', 'i'), max: false },
    { slicer: 'Bambu Studio / OrcaSlicer', re: new RegExp('filament\\s*:?\\s*(?:' + DEC + '\\s*m\\s+)?(' + DEC + ')\\s*(kg|g)\\b', 'i'), max: false },
    { slicer: null,                       re: new RegExp('\\b(' + DEC + ')\\s*(kg|g)\\b', 'gi'), max: true }
  ];

  // Last resort, web-only. Photographing a screen mangles the unit: Tesseract returns
  // "277.11 ¢g" where Vision returns "277.11 g". Tried only when every strict pattern above
  // has failed, and — like the strict catch-all — it is worthless without a time beside it,
  // because spool boxes have weights printed on them too.
  // The unit class deliberately excludes '9'. Tesseract does sometimes render 'g' as '9',
  // but accepting it means any four-digit number ending in 9 becomes a weight: on a real
  // frame "5209" (a fragment of a table cell) parsed as 520 g and beat the true 277.11,
  // because the largest candidate wins. A missed weight is recoverable by typing; a
  // confident wrong one is the failure this product exists to avoid.
  var GRAM_LOOSE = /(\d{1,4}(?:[.,]\d{1,2})?)[ \t]*[¢c]?[ \t]*[gq](?![A-Za-z0-9])/gi;

  /* "324,97" -> 324.97, but "1,234" -> 1234. A comma with exactly three digits after it and
     no digit following is a thousands grouping; slicers print two decimals, never three. */
  function NUM(raw) {
    var t = String(raw);
    if (t.indexOf(',') >= 0) t = /,\d{3}(?!\d)/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    var v = parseFloat(t);
    return isFinite(v) ? v : null;
  }

  function minutesFrom(token) {
    var total = 0, saw = false;
    var re = /(\d+(?:\.\d+)?)[ \t]*(days?|hours?|minutes?|mins?|seconds?|secs?|[dhms])(?![A-Za-z])/gi, m;
    while ((m = re.exec(token))) {
      var v = parseFloat(m[1]), u = m[2].toLowerCase()[0];
      if (u === 'd') total += v * 1440;
      else if (u === 'h') total += v * 60;
      else if (u === 'm') total += v;
      else if (u === 's') total += v / 60;
      saw = true;
    }
    return saw ? Math.round(total) : null;
  }

  /* ---- The labeled-total anchor -------------------------------------------------------
     Measured on a real 970x1216 Bambu panel (light text on a dark ground, the shape Tesseract
     is worst at): five OCR runs of the SAME file produced four different weights — 126.83,
     520, 277.11, and one refusal. The numbers are unreliable. The LABEL is not: "Total
     Filament:" came back correct in every single run.

     So stop treating the total as one candidate among many. Find the label, read only its own
     line, and if that line cannot be read, refuse — never let a component row answer a question
     about the total. That alone is the difference between "126.83 g" and "type it in": the
     first is a confident wrong number 39% of the truth, the second costs one tap.

     Two repairs are allowed on that line, because both were observed repeatedly and both are
     checkable:
       - a trailing 9 that is really a g   ("324.97 g" -> "324979", also "52.049", "12.809")
       - a lost decimal point              ("32497" for 324.97)
     Neither is guessed blind. A repair is accepted only if the result lands under the 2.5 kg
     ceiling AND is >= the heaviest component row on the panel, which is a physical fact about
     a total, not a heuristic. 324.97 clears both; every misreading above fails one. */
  var TOTAL_LABEL = /total\s*filament\s*:?([^\n]*)/i;
  var CLEAN_ON_LINE = /(\d+(?:[.,]\d{1,3})?)[ \t]*(?:[¢c][ \t]*)?(kg|g)\b/i;
  // A DECIMAL IS REQUIRED. The floor's whole job is to veto an impossible repair, so a poisoned
  // floor is worse than none: on the real panel "5.20 g" OCR'd as "520g" and "5.17 g" as "517g",
  // which made the heaviest component look like 520 and vetoed the true 324.97 total. A
  // component that still carries its decimal point was read cleanly enough to be trusted;
  // a bare integer has already lost information and gets no vote.
  var COMPONENT = /(\d+[.,]\d{1,2})[ \t]*(?:[¢c][ \t]*)?g\b/gi;

  function heaviestComponent(text) {
    var m, best = 0;
    COMPONENT.lastIndex = 0;
    while ((m = COMPONENT.exec(text))) {
      var v = NUM(m[1]);
      if (v != null && v > 0.5 && v <= 2500) best = Math.max(best, v);
    }
    return best;
  }

  /* undefined = no label, carry on normally. null = label found, unreadable, refuse. */
  function totalFromLabel(text) {
    var lab = TOTAL_LABEL.exec(text);
    if (!lab) return undefined;
    // Drop the leading metres figure so "102.35 m" can never be mistaken for the weight.
    var line = String(lab[1]).replace(/^[ \t]*\d+(?:[.,]\d+)?[ \t]*m\b/i, '');
    var floor = heaviestComponent(text), ok = function (v) {
      return v != null && v >= 0.5 && v <= 2500 && v >= floor;
    };

    var clean = CLEAN_ON_LINE.exec(line);
    if (clean) {
      var v = NUM(clean[1]);
      if (clean[2].toLowerCase() === 'kg') v = v * 1000;
      if (ok(v)) return v;
      // A unit is present but the value is impossible — the decimal was dropped ("32497 g").
      if (v != null && v > 2500 && ok(v / 100)) return v / 100;
      return null;
    }

    // No unit survived. Take the line's last digit run and try the two repairs in order.
    var runs = line.match(/\d[\d.,]*/g);
    if (!runs || !runs.length) return null;
    var raw = runs[runs.length - 1];
    var asis = NUM(raw);
    if (ok(asis)) return asis;
    if (/9$/.test(raw)) {                       // the g that OCR turned into a 9
      var cut = raw.slice(0, -1), c = NUM(cut);
      if (ok(c)) return c;
      if (c != null && c > 2500 && ok(c / 100)) return c / 100;   // ...and the decimal too
    }
    if (asis != null && asis > 2500 && ok(asis / 100)) return asis / 100;
    return null;
  }

  function score(v) { return (v && typeof v === 'object' && 'grams' in v) ? v.grams : v; }

  /* Largest candidate wins — the rule the whole split-column strategy rests on, since Total is
     >= every part. But when the candidates carry decimal information, a long bare integer is
     discarded first: it is almost always a decimal reading whose point OCR dropped. */
  function largest(list) {
    if (!list.length) return null;
    var rich = list.filter(function (x) { return x && typeof x === 'object' && 'hasDecimal' in x; });
    if (rich.length && rich.length === list.length) {
      var withDot = rich.filter(function (x) { return x.hasDecimal; });
      var pool = withDot.length ? withDot : rich.filter(function (x) { return x.digits < 4; });
      if (!pool.length) pool = rich;
      return pool.reduce(function (a, b) { return b.grams > a.grams ? b : a; });
    }
    return list.reduce(function (a, b) { return score(b) > score(a) ? b : a; });
  }

  /* `authoritative` is set for weights only, and it is what stops a plausible wrong number.
     A labeled row ("Total filament: …") IS the answer. If one matches and every value it
     offers is thrown out — OCR dropped the decimal and 324.97 came back as "32497", over the
     2.5 kg ceiling — then continuing to the unlabeled catch-all hands the win to the largest
     surviving sub-row, and "Sparse infill 126.83 g" is reported as the print's weight: a
     complete, believable reading worth 39% of the truth. Refusing sends the user to the field
     to type it. Every match on the row is tried before refusing, so a stray "Total: 5 kg"
     elsewhere on the panel cannot veto the real total further down. */
  var REFUSED = { refused: true };

  function firstOrMax(text, table, pick, authoritative) {
    for (var i = 0; i < table.length; i++) {
      var row = table[i], best = null;
      var g = new RegExp(row.re.source, row.re.flags.indexOf('g') < 0 ? row.re.flags + 'g' : row.re.flags);
      var m, all = [], sawMatch = false;
      while ((m = g.exec(text))) {
        sawMatch = true;
        var v = pick(m, row);
        if (v != null) all.push(v);
        if (!row.max && all.length) break;   // strict rows want the first usable match, not the biggest
        if (m.index === g.lastIndex) g.lastIndex++;
      }
      best = row.max ? largest(all) : (all.length ? all[0] : null);
      if (best != null) return { value: score(best), slicer: row.slicer };
      if (authoritative && !row.max && sawMatch) return REFUSED;
    }
    return null;
  }

  function parse(text) {
    var t = firstOrMax(text, TIME, function (m) { return minutesFrom(m[1]); });

    // `unitFirst` belongs to the PATTERN, not the match — Prusa's sidebar prints
    // "Used Filament (g) 150.33", unit before value. Reading it off the match array made it
    // permanently undefined and that whole layout returned no weight at all.
    // The labeled total outranks every pattern below it, including its own strict row.
    var anchored = totalFromLabel(text);
    if (anchored != null) {
      return { minutes: t ? t.value : null, grams: Math.round(anchored * 100) / 100,
               slicer: (t && t.slicer) || 'Bambu Studio / OrcaSlicer', complete: !!t };
    }
    if (anchored === null) {
      return { minutes: t ? t.value : null, grams: null, slicer: t ? t.slicer : null, complete: false };
    }

    var w = firstOrMax(text, WEIGHT, function (m, row) {
      var raw = row.unitFirst ? m[2] : m[1];
      var value = NUM(raw);
      var unit = (row.unitFirst ? m[1] : m[2] || 'g').toLowerCase();
      if (value == null) return null;
      var grams = unit === 'kg' ? value * 1000 : value;
      // A print that weighs more than about 2.5 kg does not come off a consumer printer in one
      // go. The ceiling matters because OCR drops decimal points: on a real Bambu panel the
      // Sparse infill row "126.83 g" came back as "12683", and largest-candidate happily
      // preferred a 12.7 kg print over the true 324.97 g total.
      if (grams < 0.5 || grams > 2500) return null;
      // Slicers print totals to two decimals. When the panel offers any decimal candidate, an
      // integer of four digits or more is far more likely to be one of those with its point
      // lost than a genuine reading, so it is not allowed to win.
      return { grams: grams, hasDecimal: /[.,]/.test(raw), digits: String(raw).replace(/\D/g, '').length };
    }, true);

    // Told apart deliberately: no weight pattern matched at all (loose OCR salvage is worth a
    // try) versus the authoritative row matched and could not be read (nothing downstream may
    // guess, the loose pass least of all — it tolerates a mangled unit and would happily
    // return the same sub-row the strict pass just refused).
    if (w === REFUSED) {
      return { minutes: t ? t.value : null, grams: null, slicer: t ? t.slicer : null, complete: false };
    }

    if (!w && t) {
      // Same two guards as the strict catch-all, and for the same reason: this path already
      // tolerates a mangled unit, so letting it also accept a decimal-stripped integer would
      // stack two guesses and produce a confident wrong weight. A four-digit bare number here
      // is rejected outright — better to ask for the grams than to invent them.
      var cands = [], m2;
      GRAM_LOOSE.lastIndex = 0;
      while ((m2 = GRAM_LOOSE.exec(text))) {
        var raw = m2[1], v = parseFloat(raw.replace(',', '.'));
        if (!isFinite(v) || v < 1 || v > 2500) continue;
        if (!/[.,]/.test(raw) && raw.replace(/\D/g, '').length >= 4) continue;
        cands.push(v);
      }
      if (cands.length) w = { value: Math.max.apply(null, cands), slicer: null, loose: true };
    }

    return {
      minutes: t ? t.value : null,
      grams: w ? Math.round(w.value * 100) / 100 : null,
      slicer: (t && t.slicer) || (w && w.slicer) || null,
      // Both required. A weight on its own must never fire: spool boxes print weights.
      complete: !!(t && w)
    };
  }

  window.SlicerScan = { parse: parse, minutesFrom: minutesFrom };
})();
