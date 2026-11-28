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
console.log("DIAGNOSTIC uniform-load maxM =", maxM, "diagram =", JSON.stringify(distributed.members[0].force_diagram_local));
assert.ok(Math.abs(maxM - 4500000) < 1e-5, "uniform-load fixed-end moment");

console.log("PASS: cantilever closed-form deflection and reaction");
console.log("PASS: linear load scaling and signed load reversal");
console.log("PASS: uniform member load equilibrium and fixed-end moment");
console.log("All 4 frame-solver regression checks passed.");
