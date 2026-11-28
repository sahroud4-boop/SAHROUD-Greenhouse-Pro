"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scriptMatch = html.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "main inline application script must exist");

function extractFunction(source, name) {
  const marker = new RegExp("function\\s+" + name + "\\s*\\(");
  const found = marker.exec(source);
  assert.ok(found, "missing function: " + name);
  const start = found.index;
  const open = source.indexOf("{", found.index);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false, template = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (lineComment) { if (c === "\n") lineComment = false; continue; }
    if (blockComment) { if (c === "*" && n === "/") { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (template) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === "`") template = false;
      continue;
    }
    if (c === "/" && n === "/") { lineComment = true; i++; continue; }
    if (c === "/" && n === "*") { blockComment = true; i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "`") { template = true; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("unterminated function: " + name);
}

const names = ["frame2DStiffness", "frame2DTransform", "matVec", "transpose", "matMul", "solveLinearSystem", "analyzeFrame2D"];
const code = names.map(name => extractFunction(scriptMatch[1], name)).join("\n") +
  "\nglobalThis.api = { analyzeFrame2D };";
const context = vm.createContext({});
vm.runInContext(code, context, { timeout: 5000 });
const analyze = context.api.analyzeFrame2D;

const base = {
  nodes: [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
  elements: [{ id: "CANT-1", i: 0, j: 1, A: 2000, E: 200000, I: 80000000 }],
  restraints: [{ node: 0, dofs: [true, true, true] }],
  loads: [{ node: 1, fx: 0, fy: -1000, mz: 0 }]
};
const first = analyze(base);
assert.equal(first.equilibrium.passed, true, "cantilever equilibrium");
const uy = first.displacements.find(x => x.node === 1 && x.dof === "uy_mm").value;
const expectedUy = -(1000 * Math.pow(3000, 3)) / (3 * 200000 * 80000000);
assert.ok(Math.abs(uy - expectedUy) < 1e-9, "cantilever tip deflection matches Euler-Bernoulli closed form");
assert.ok(Math.abs(first.equilibrium.support.fy - 1000) < 1e-7, "vertical support reaction");

const doubled = analyze({ ...base, loads: [{ node: 1, fy: -2000 }] });
const uy2 = doubled.displacements.find(x => x.node === 1 && x.dof === "uy_mm").value;
assert.ok(Math.abs(uy2 - 2 * uy) < 1e-9, "linear scaling: doubled load doubles displacement");

const reversed = analyze({ ...base, loads: [{ node: 1, fy: 1000 }] });
const uyReverse = reversed.displacements.find(x => x.node === 1 && x.dof === "uy_mm").value;
assert.ok(Math.abs(uyReverse + uy) < 1e-9, "load reversal reverses signed displacement");

const distributed = analyze({
  nodes: base.nodes, elements: base.elements, restraints: base.restraints,
  loads: [], elementLoads: [{ element: 0, qx: 0, qy: -1 }]
});
assert.equal(distributed.equilibrium.passed, true, "uniform member-load equilibrium");
assert.ok(Math.abs(distributed.equilibrium.support.fy - 3000) < 1e-7, "uniform load resultant reaction");
const maxM = Math.max(...distributed.members[0].force_diagram_local.map(p => Math.abs(p.M_Nmm)));
assert.ok(Math.abs(maxM - 4500000) < 1e-5, "uniform-load fixed-end moment");

console.log("PASS: cantilever closed-form deflection and reaction");
console.log("PASS: linear load scaling and signed load reversal");
console.log("PASS: uniform member load equilibrium and fixed-end moment");
console.log("All 4 frame-solver regression checks passed.");

function extractFunction(source, name) {
  const marker = new RegExp("function\\\\s+" + name + "\\\\s*\\\\(");
  const found = marker.exec(source);
  assert.ok(found, "missing function: " + name);
  const start = found.index, open = source.indexOf("{", found.index);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false, template = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (lineComment) { if (c === "\\n") lineComment = false; continue; }
    if (blockComment) { if (c === "*" && n === "/") { blockComment = false; i++; } continue; }
    if (quote) { if (escaped) { escaped = false; continue; } if (c === "\\\\") { escaped = true; continue; } if (c === quote) quote = null; continue; }
    if (template) { if (escaped) { escaped = false; continue; } if (c === "\\\\") { escaped = true; continue; } if (c === "`") template = false; continue; }
    if (c === "/" && n === "/") { lineComment = true; i++; continue; }
    if (c === "/" && n === "*") { blockComment = true; i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "`") { template = true; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("unterminated function: " + name);
}

const comboSource = scriptMatch[1];
const comboNames = ["frameTopologySignature", "runFrameCombinations"];
const comboCode = comboNames.map(name => extractFunction(comboSource, name)).join("\\n") + `
let frameCombinationLast = null;
const ui = Object.create(null);
function $(id) { return ui[id] || (ui[id] = { value: "", innerHTML: "" }); }
function status(id, message) { $(id).textContent = message; }
function fmt(v) { return String(v); }
function esc(v) { return String(v); }
globalThis.comboApi = { runFrameCombinations, getLast: () => frameCombinationLast, ui };
`;
vm.runInContext(code + "\\n" + comboCode, context, { timeout: 5000 });
const combo = context.comboApi;
const beam = {
  nodes: [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
  elements: [{ id: "BEAM-1", i: 0, j: 1, A: 2000, E: 200000, I: 80000000 }],
  restraints: [{ node: 0, dofs: [true, true, false] }, { node: 1, dofs: [true, true, false] }],
  loads: [],
  elementLoads: [{ element: 0, qx: 0, qy: -1 }]
};
function runCases(g, gf, sCase, sf) {
  const ui = combo.ui;
  ui.cmbModelG.value = g ? JSON.stringify(g) : "";
  ui.cmbFactorG.value = String(gf ?? 1);
  ui.cmbModelS.value = sCase ? JSON.stringify(sCase) : "";
  ui.cmbFactorS.value = String(sf ?? 1);
  ui.cmbModelW.value = "";
  ui.cmbFactorW.value = "1";
  combo.runFrameCombinations();
  return combo.getLast();
}
const single = runCases(beam, 1);
assert.ok(single, "single active case must calculate");
const directBeam = analyze(beam);
assert.ok(Math.abs(single.displacements.find(x => x.dof === "uy_mm" && x.node === 0).value -
  directBeam.displacements.find(x => x.dof === "uy_mm" && x.node === 0).value) < 1e-9,
  "factor 1 must reproduce independent analysis");
const doubledCombo = runCases(beam, 1, beam, 1);
assert.ok(doubledCombo, "two identical active cases must calculate");
const singleMoment = single.members[0].force_diagram_local.find(p => Math.abs(p.M_Nmm) > 1).M_Nmm;
const doubleMoment = doubledCombo.members[0].force_diagram_local.find(p => Math.abs(p.M_Nmm) > 1).M_Nmm;
assert.ok(Math.abs(doubleMoment - 2 * singleMoment) < 1e-7, "two identical cases must double signed member moment");
const cancelled = runCases(beam, 1, beam, -1);
assert.ok(cancelled, "opposite factors must calculate");
assert.ok(cancelled.members[0].force_diagram_local.every(p => Math.abs(p.M_Nmm) < 1e-7 && Math.abs(p.V_N) < 1e-7),
  "equal and opposite cases must cancel signed member actions");
assert.ok(cancelled.members[0].deflection_curve_local.every(p => Math.abs(p.transverse_mm) < 1e-9),
  "equal and opposite cases must cancel local deflection");
assert.ok(single.members[0].force_diagram_local.some(p => Math.abs(p.x_mm - 1500) < 1e-8),
  "uniform-load shear-zero station must be included at midspan");
const mismatched = JSON.parse(JSON.stringify(beam));
mismatched.nodes[1].x = 3200;
assert.equal(runCases(beam, 1, mismatched, 1), null, "different geometry must be rejected");
assert.ok(String(combo.ui.cmbStatus.textContent).includes("خطا"), "mismatched topology must report a validation error");

console.log("PASS: load-combination identity, doubling, signed cancellation, critical station and topology rejection");
console.log("All frame solver and load-combination regression checks passed.");

