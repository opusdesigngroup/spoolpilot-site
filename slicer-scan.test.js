const fs = require('fs'), vm = require('vm');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/slicer-scan.js', 'utf8'), ctx);
const parse = ctx.window.SlicerScan.parse;

// minutes, grams, complete. null = must not read anything.
const CASES = [
["Bambu Studio, clean OCR", `Slicing Result
Total time: 4h22m
Prepare time: 2m5s
Model printing time: 4h19m
Total filament: 12.99 m  324.97 g
Model filament: 12.99 m  324.97 g
Cost: $6.50`, 262, 324.97],

["Bambu, THE BUG: infill row loses its decimal point", `Slicing Result
Total time 4h 22m
Total filament 324.97 g
Sparse infill 12683 g
Inner wall 8814 g`, 262, 324.97],

["Bambu, split columns (labels and values separated)", `Slicing Result
Total time
Prepare time
Model printing
4h 22m
2m 5s
4h 19m
Total filament
324.97 g
126.83 g`, 262, 324.97],

["Bambu, every weight loses its point -> RECOVER the total from its label", `Slicing Result
Total time 4h 22m
Total filament 32497 g
Sparse infill 12683 g`, 262, 324.97],

["PrusaSlicer sidebar, unit before value", `Used Filament (g)
150.33 (380.33)
Used Filament (m)
50.42 (127.55)
Estimated printing time:
normal mode  3h 21m 15s
stealth mode 4h 55m 02s`, 201, 150.33],

["PrusaSlicer, must take normal not stealth mode", `Estimated printing time:
normal mode 2h 10m
stealth mode 9h 45m
Used Filament (g) 88.10`, 130, 88.10],

["Cura", `08 hours 32 minutes
Material: 45.2 g
1.52 m`, 512, 45.2],

["kg unit converts", `Total time 12h 0m
Total filament 1.2 kg`, 720, 1200],

["GUARD: 3DBenchy filename must not read as 3 days", `3DBenchy.gcode
Total time 1h 5m
Total filament 12.4 g`, 65, 12.4],

["GUARD: spool box, no time -> never completes (UI fills nothing)", `eSUN PLA+ 1.75mm
Net Weight 1000 g`, null, 1000],

["12.7kg is impossible -> read it as the 126.83 g it must be", `Total time 4h 22m
Total filament 12683 g`, 262, 126.83],

["GUARD: empty input", ``, null, null],
["REGRESSION comma decimal (de/fr/nl/es)", `Total time 4h 22m
Total filament 324,97 g`, 262, 324.97],

["REGRESSION comma thousands is not a decimal", `Total time 26h 10m
Total filament 1,240 g`, 1570, 1240],

["REGRESSION total mangled -> recover it, never fall to a sub-row", `Total time 4h 22m
Total filament 12.99 m 32497 g
Sparse infill 5.07 m 126.83 g`, 262, 324.97],

["REGRESSION real Tesseract output (g as 9, cent-g, lost points)", `Slicing Result

Total time 4h22m

Total filament 1299 m 324.97g
Sparse infill 5.07m 126.83\u00a2g
Outer wall 211m 52.909
`, 262, 324.97],
["label present but its line is unreadable -> refuse", `Total time 4h 22m
Total Filament:
Sparse infill 126.83 g`, 262, null],

["anchored total must beat a heavier-looking component", `Total time 8h 43m
Sparse infill 39.95 m 126.83 g
Total Filament: 102.35 m 324979`, 523, 324.97],
];

let pass = 0, fail = 0;
for (const [name, text, wantMin, wantG] of CASES) {
  const r = parse(text);
  const okM = r.minutes === wantMin, okG = r.grams === wantG;
  const wantComplete = wantMin !== null && wantG !== null;
  const okC = r.complete === wantComplete;
  if (okM && okG && okC) { pass++; console.log(`  PASS  ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}`);
    console.log(`          minutes: got ${r.minutes}  want ${wantMin}   ${okM?'':'  <-- '}`);
    console.log(`          grams:   got ${r.grams}  want ${wantG}   ${okG?'':'  <-- '}`);
    console.log(`          complete:got ${r.complete}  want ${wantComplete}   ${okC?'':'  <-- '}`);
    console.log(`          slicer:  ${r.slicer}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${CASES.length} total`);
process.exit(fail ? 1 : 0);
