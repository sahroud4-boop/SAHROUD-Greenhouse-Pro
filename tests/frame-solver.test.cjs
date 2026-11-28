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

const names = ["frame2DStiffness", "frame2DTransform", "matVec", "transpose", "matMul", "solveLinearSystem", "analyzeFrame2D", "frameElasticExtremeFiberStress", "frameAxialForceScreen", "frameSectionDemandScreen", "frameSectionPropertiesForAxis", "frameEulerBucklingForAxis", "frameEulerBucklingMinimum", "validateSectionProfileData"];
const code = names.map(name => extractFunction(scriptMatch[1], name)).join("\n") +
  "\nglobalThis.api = { analyzeFrame2D, frameElasticExtremeFiberStress, frameAxialForceScreen, frameSectionDemandScreen, frameSectionPropertiesForAxis, frameEulerBucklingForAxis, frameEulerBucklingMinimum, validateSectionProfileData };";
const context = vm.createContext({});
vm.runInContext(code, context, { timeout: 5000 });
const analyze = context.api.analyzeFrame2D;
const stressScreen = context.api.frameElasticExtremeFiberStress;
const axialScreen = context.api.frameAxialForceScreen;
const sectionDemandScreen = context.api.frameSectionDemandScreen;
const sectionPropertiesForAxis = context.api.frameSectionPropertiesForAxis;
const eulerBucklingForAxis = context.api.frameEulerBucklingForAxis;
const eulerBucklingMinimum = context.api.frameEulerBucklingMinimum;
const sectionProfile = { name: "TEST-I", area: 1200, E: 200000, Fy: 250, Ix: 8e6, Iy: 2e6, Wx: 4e5, Wy: 1e5, Av: 600 };
const xAxisProperties = sectionPropertiesForAxis(sectionProfile, "x");
const yAxisProperties = sectionPropertiesForAxis(sectionProfile, "y");
assert.equal(xAxisProperties.I, 8e6, "X bending axis must use Ix");
assert.equal(xAxisProperties.W, 4e5, "X bending axis must use Wx, never the smaller arbitrary modulus");
assert.equal(yAxisProperties.I, 2e6, "Y bending axis must use Iy");
assert.equal(yAxisProperties.W, 1e5, "Y bending axis must use Wy");
assert.equal(sectionPropertiesForAxis(sectionProfile, null), null, "an unspecified bending axis must disable section property mapping");

const eulerX = eulerBucklingForAxis(sectionProfile, "x", 2, 1, 3000);
const eulerY = eulerBucklingForAxis(sectionProfile, "y", 2, 1, 3000);
near(eulerX.I, sectionProfile.Ix, 1e-9, "X-axis Euler screen uses Ix");
near(eulerX.K, 2, 1e-12, "X-axis Euler screen uses Kx");
near(eulerY.I, sectionProfile.Iy, 1e-9, "Y-axis Euler screen uses Iy");
near(eulerY.K, 1, 1e-12, "Y-axis Euler screen uses Ky");
near(eulerX.pcr, Math.PI ** 2 * sectionProfile.E * sectionProfile.Ix / (2 * 3000) ** 2, 1e-9,
  "X-axis Euler critical load formula");
near(eulerY.pcr, Math.PI ** 2 * sectionProfile.E * sectionProfile.Iy / (1 * 3000) ** 2, 1e-9,
  "Y-axis Euler critical load formula");
assert.throws(() => eulerBucklingForAxis(sectionProfile, null, 2, 1, 3000), /محور خمشی/,
  "Euler screening requires an explicit selected bending axis");
const eulerMinimum = eulerBucklingMinimum(sectionProfile, 2, 1, 3000);
near(eulerMinimum.x.pcr, eulerX.pcr, 1e-9, "two-axis Euler minimum retains X-axis result");
near(eulerMinimum.y.pcr, eulerY.pcr, 1e-9, "two-axis Euler minimum retains Y-axis result");
near(eulerMinimum.minimum, Math.min(eulerX.pcr, eulerY.pcr), 1e-9,
  "column candidate screening uses the lower of both Euler axis loads");
assert.equal(eulerMinimum.axis, "x", "weaker Euler axis is identified");


const demand = sectionDemandScreen({
  length_mm: 3000,
  local_end_forces_N_Nmm: [-100000, 15000, 0, -100000, -15000, 0],
  uniform_load_local_N_per_mm: { qx: 0, qy: -10 }
}, { A: 1000, W: 100000, Fy: 250, Av: 1000 });
assert.ok(Math.abs(demand.maxM_Nmm - 11250000) < 1e-6, "maximum moment is found at the internal zero-shear station");
assert.ok(Math.abs(demand.MAt_mm - 1500) < 1e-9, "maximum moment location is retained");
assert.ok(Math.abs(demand.maxNormalStress_MPa - 212.5) < 1e-9, "normal stress combines axial and bending demand at the same station");
assert.ok(Math.abs(demand.normalAt_mm - 1500) < 1e-9, "critical normal stress location is retained");
assert.ok(Math.abs(demand.maxShearStress_MPa - 15) < 1e-9, "shear stress uses the section shear area");
assert.equal(demand.shearAt_mm, 0, "critical shear location is retained");
assert.ok(demand.interactionRatio < 1, "von Mises interaction is evaluated at common stations");
const offGridCritical = sectionDemandScreen({
  length_mm: 3000,
  local_end_forces_N_Nmm: [0, 1375, 0, 0, -1625, 0],
  uniform_load_local_N_per_mm: { qx: 0, qy: -1 }
}, { A: 1000, W: 100000, Fy: 250, Av: 1000 });
assert.ok(Math.abs(offGridCritical.MAt_mm - 1375) < 1e-9, "analytical zero-shear station is retained even when it falls between uniform samples");
assert.ok(Math.abs(offGridCritical.maxM_Nmm - 945312.5) < 1e-6, "moment maximum is evaluated exactly at the off-grid station");
assert.ok(Math.abs(offGridCritical.normalAt_mm - 1375) < 1e-9, "normal stress maximum uses analytical stationary candidate");

const noAv = sectionDemandScreen({
  length_mm: 1000, local_end_forces_N_Nmm: [0, 1000, 0, 0, -1000, 0],
  uniform_load_local_N_per_mm: { qx: 0, qy: -2 }
}, { A: 1000, W: 10000, Fy: 250 });
assert.equal(noAv.maxShearStress_MPa, null, "shear stress is withheld when Av is not supplied");
assert.equal(noAv.interactionRatio, null, "von Mises interaction is withheld when Av is not supplied");
assert.throws(() => sectionDemandScreen({ length_mm: 0 }, { A: 1, W: 1, Fy: 1 }), /طول و نیروهای انتهایی/, "invalid member geometry is rejected");
const axialForces = axialScreen({ force_diagram_local: [
  { x_mm: 0, N_N: -120000 }, { x_mm: 1500, N_N: 50000 }, { x_mm: 3000, N_N: 180000 }
] });
assert.equal(axialForces.maxTension_N, 180000, "maximum tension is reported independently");
assert.equal(axialForces.tensionAt_mm, 3000, "maximum tension station is retained");
assert.equal(axialForces.maxCompression_N, 120000, "maximum compression magnitude is reported independently");
assert.equal(axialForces.compressionAt_mm, 0, "maximum compression station is retained");
const interiorCompression = axialScreen({ force_diagram_local: [
  { x_mm: 0, N_N: 10000 }, { x_mm: 1250, N_N: -95000 }, { x_mm: 3000, N_N: -20000 }
] });
assert.equal(interiorCompression.maxCompression_N, 95000, "internal axial force station governs compression demand");
assert.equal(interiorCompression.compressionAt_mm, 1250, "internal compression location is retained");
assert.throws(() => axialScreen({ force_diagram_local: [] }), /نمودار نیروی محوری/, "empty axial force diagram is rejected");
const stressResult = stressScreen({ local_end_forces_N_Nmm: [100000, 0, 0, 0, 0, 8000000] }, 1000, 100000, 250);
assert.equal(stressResult.criticalEnd, "i", "critical elastic stress is selected at the same physical end");
assert.ok(Math.abs(stressResult.stressAbs - 100) < 1e-12, "same-end axial and bending stress is evaluated consistently");
assert.ok(Math.abs(stressResult.ratio - 0.4) < 1e-12, "elastic stress-to-yield ratio");
assert.equal(stressResult.axialCriticalEnd, "i", "axial-only screening identifies its critical member end");
assert.ok(Math.abs(stressResult.axialStressAbs - 100) < 1e-12, "axial-only elastic stress");
assert.ok(Math.abs(stressResult.axialRatio - 0.4) < 1e-12, "axial-only stress-to-yield ratio");
const oppositeEndAxial = stressScreen({ local_end_forces_N_Nmm: [100000,0,0,200000,0,0] }, 1000, 100000, 250);
assert.equal(oppositeEndAxial.axialCriticalEnd, "j", "axial-only critical end is selected independently");
assert.ok(Math.abs(oppositeEndAxial.axialRatio - 0.8) < 1e-12, "axial-only maximum is taken across both member ends");
assert.throws(() => stressScreen({ local_end_forces_N_Nmm: [1, 2] }, 1000, 100000, 250),
  /نیروهای انتهایی/, "incomplete member end forces are rejected");
console.log("PASS: same-end elastic extreme-fiber stress screening and input validation");


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

const comboSource = scriptMatch[1];
const comboNames = ["frameTopologySignature", "runFrameCombinations"];
const comboCode = comboNames.map(name => extractFunction(comboSource, name)).join("\n") + `
let frameCombinationLast = null;
const ui = Object.create(null);
function $(id) { return ui[id] || (ui[id] = { value: "", innerHTML: "" }); }
function status(id, message) { $(id).textContent = message; }
function fmt(v) { return String(v); }
function esc(v) { return String(v); }
globalThis.comboApi = { runFrameCombinations, getLast: () => frameCombinationLast, ui, get: $ };
`;
vm.runInContext(code + "\n" + comboCode, context, { timeout: 5000 });
const combo = context.comboApi;
const beam = {
  nodes: [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
  elements: [{ id: "BEAM-1", i: 0, j: 1, A: 2000, E: 200000, I: 80000000 }],
  restraints: [{ node: 0, dofs: [true, true, false] }, { node: 1, dofs: [true, true, false] }],
  loads: [],
  elementLoads: [{ element: 0, qx: 0, qy: -1 }]
};
function runCases(g, gf, sCase, sf) {
  const ui = combo.ui, get = combo.get;
  get("cmbModelG").value = g ? JSON.stringify(g) : "";
  get("cmbFactorG").value = String(gf ?? 1);
  get("cmbModelS").value = sCase ? JSON.stringify(sCase) : "";
  get("cmbFactorS").value = String(sf ?? 1);
  get("cmbModelW").value = "";
  get("cmbFactorW").value = "1";
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


// Regression coverage: combined nodal responses, reactions, zero factors and mixed load types.
function near(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ": expected " + expected + ", received " + actual);
}
function keyedValues(rows, key) {
  return new Map(rows.map(row => [key(row), row.value]));
}
function assertCombinedVector(actual, a, af, b, bf, key, label) {
  const av = keyedValues(a, key), bv = keyedValues(b, key);
  for (const row of actual) {
    const id = key(row);
    near(row.value, af * (av.get(id) || 0) + bf * (bv.get(id) || 0), 1e-8, label + " " + id);
  }
}
const doubledDisplacements = keyedValues(doubledCombo.displacements, x => x.node + ":" + x.dof);
for (const row of single.displacements) {
  near(doubledDisplacements.get(row.node + ":" + row.dof), 2 * row.value, 1e-8,
    "doubling factor doubles displacement " + row.node + ":" + row.dof);
}
const doubledReactions = keyedValues(doubledCombo.reactions, x => x.node + ":" + x.dof);
for (const row of single.reactions) {
  near(doubledReactions.get(row.node + ":" + row.dof), 2 * row.value, 1e-7,
    "doubling factor doubles reaction " + row.node + ":" + row.dof);
}
for (const row of cancelled.displacements) near(row.value, 0, 1e-9, "cancelled displacement");
for (const row of cancelled.reactions) near(row.value, 0, 1e-8, "cancelled reaction");
const zeroFactor = runCases(beam, 0, null, 1);
assert.equal(zeroFactor, null, "zero-factor-only input must not create an active load case");
assert.ok(String(combo.ui.cmbStatus.textContent).includes("حداقل یک مدل"),
  "zero-factor-only input must explain that no active case remains");

// A cantilever allows a true nodal point load and a distinct uniform member load
// to be superposed on exactly the same topology and support conditions.
const mixedBase = {
  nodes: [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
  elements: [{ id: "MIX-1", i: 0, j: 1, A: 2000, E: 200000, I: 80000000 }],
  restraints: [{ node: 0, dofs: [true, true, true] }],
  loads: [], elementLoads: []
};
const uniformCase = { ...mixedBase, elementLoads: [{ element: 0, qx: 0, qy: -0.8 }] };
const pointCase = { ...mixedBase, loads: [{ node: 1, fx: 0, fy: -700, mz: 0 }] };
const mixed = runCases(uniformCase, 1.25, pointCase, -0.4);
assert.ok(mixed, "different load types with signed factors must combine");
const directUniform = analyze(uniformCase), directPoint = analyze(pointCase);
assertCombinedVector(mixed.displacements, directUniform.displacements, 1.25,
  directPoint.displacements, -0.4, x => x.node + ":" + x.dof, "mixed displacement");
assertCombinedVector(mixed.reactions, directUniform.reactions, 1.25,
  directPoint.reactions, -0.4, x => x.node + ":" + x.dof, "mixed reaction");
const uniformMember = directUniform.members[0], pointMember = directPoint.members[0];
for (const p of mixed.members[0].force_diagram_local) {
  const q = uniformMember.local_end_forces_N_Nmm, uq = uniformMember.uniform_load_local_N_per_mm;
  const r = pointMember.local_end_forces_N_Nmm, rq = pointMember.uniform_load_local_N_per_mm;
  const x = p.x_mm;
  const expectedN = 1.25 * (-q[0] - uq.qx * x) - 0.4 * (-r[0] - rq.qx * x);
  const expectedV = 1.25 * (q[1] + uq.qy * x) - 0.4 * (r[1] + rq.qy * x);
  const expectedM = 1.25 * (-q[2] + q[1] * x + uq.qy * x * x / 2) -
    0.4 * (-r[2] + r[1] * x + rq.qy * x * x / 2);
  near(p.N_N, expectedN, 1e-7, "mixed axial force at " + x);
  near(p.V_N, expectedV, 1e-7, "mixed shear at " + x);
  near(p.M_Nmm, expectedM, 1e-6, "mixed moment at " + x);
}
const zeroPlusActive = runCases(uniformCase, 0, pointCase, 1);
assert.ok(zeroPlusActive, "a zero factor must be ignored when another case is active");
const pointOnly = analyze(pointCase);
assertCombinedVector(zeroPlusActive.displacements, pointOnly.displacements, 1,
  pointOnly.displacements, 0, x => x.node + ":" + x.dof, "zero-factor displacement");
assertCombinedVector(zeroPlusActive.reactions, pointOnly.reactions, 1,
  pointOnly.reactions, 0, x => x.node + ":" + x.dof, "zero-factor reaction");

console.log("PASS: combined displacement/reaction scaling and cancellation, zero factors, and mixed nodal/distributed signed superposition");

assert.ok(mixed.equilibrium && mixed.equilibrium.passed,
  "mixed load-case combination must independently pass global equilibrium");
for (const component of ["fx", "fy", "mz"]) {
  near(mixed.equilibrium.residual[component], 0, 1e-7,
    "mixed combined global equilibrium residual " + component);
}
assert.ok(cancelled.equilibrium && cancelled.equilibrium.passed,
  "equal and opposite cases must retain equilibrium after cancellation");
for (const component of ["fx", "fy", "mz"]) {
  near(cancelled.equilibrium.applied[component], 0, 1e-9,
    "cancelled combined applied resultant " + component);
  near(cancelled.equilibrium.support[component], 0, 1e-8,
    "cancelled combined support resultant " + component);
}
console.log("PASS: independent global force and moment equilibrium of signed load combinations");


// Regression coverage: signed local member-deflection superposition and combined shear-zero station.
const combinedCurve = mixed.members[0].deflection_curve_local;
const uniformCurve = directUniform.members[0].deflection_curve_local;
const pointCurve = directPoint.members[0].deflection_curve_local;
assert.equal(combinedCurve.length, uniformCurve.length, "combined deflection curve keeps the reference station count");
assert.equal(combinedCurve.length, pointCurve.length, "all load cases must share deflection stations");
for (let k = 0; k < combinedCurve.length; k++) {
  const c = combinedCurve[k], u = uniformCurve[k], p = pointCurve[k];
  near(c.x_mm, u.x_mm, 1e-8, "uniform deflection station " + k);
  near(c.x_mm, p.x_mm, 1e-8, "point-load deflection station " + k);
  near(c.axial_mm, 1.25 * u.axial_mm - 0.4 * p.axial_mm, 1e-10,
    "signed combined axial member displacement at " + c.x_mm);
  near(c.transverse_mm, 1.25 * u.transverse_mm - 0.4 * p.transverse_mm, 1e-10,
    "signed combined transverse member displacement at " + c.x_mm);
}
const independentlyCritical = combinedCurve.reduce((best, p) =>
  Math.abs(p.transverse_mm) > Math.abs(best.transverse_mm) ? p : best, combinedCurve[0]);
near(mixed.members[0].max_transverse_deflection.value_mm,
  independentlyCritical.transverse_mm, 1e-10, "combined critical deflection retains its signed value");
near(mixed.members[0].max_transverse_deflection.x_mm,
  independentlyCritical.x_mm, 1e-8, "combined critical deflection station");
assert.ok(Math.abs(independentlyCritical.transverse_mm) > 1e-6,
  "mixed load case must produce a non-zero combined local deflection");

// The signed-deflection checks above use two distinct load types. The zero-shear
// station is covered by the solver's existing uniform-load midpoint regression;
 // do not assume every support/load arrangement has an interior shear zero.
console.log("PASS: signed local deflection superposition and critical-deflection recomputation");


// Regression coverage: profile-bank validation for geometry and imported records.
const validateProfile = context.api.validateSectionProfileData;
const validIProfile = {
  name: "I-TEST-300", mass: 42.5, shape: "i",
  depth: 300, flangeWidth: 150, webThickness: 8, flangeThickness: 12,
  bendingAxis: "x", area: 5400, Ix: 8e7, Iy: 6e6, Wx: 5.3e5, Wy: 8e4
};
assert.equal(validateProfile(validIProfile), "",
  "a positive, geometrically compatible I-section profile must pass basic data validation");
assert.match(validateProfile({...validIProfile, mass: 0}), /جرم واحد طول/,
  "zero mass must be rejected");
assert.match(validateProfile({...validIProfile, shape: "unknown"}),
  /نوع شکل مقطع/,
  "unknown shape values must be rejected");
assert.match(validateProfile({...validIProfile, bendingAxis: "z"}),
  /محور خمشی/,
  "unsupported bending axis must be rejected");
assert.match(validateProfile({...validIProfile, Ix: "not-a-number"}),
  /فیلد Ix/,
  "non-numeric entered section properties must be rejected");
assert.match(validateProfile({...validIProfile, depth: 20, flangeThickness: 12}),
  /ابعاد واردشده/,
  "incompatible flange and overall depth dimensions must be rejected");
assert.match(validateProfile({...validIProfile, webThickness: 160}),
  /ابعاد واردشده/,
  "web thickness greater than flange width must be rejected");
assert.match(validateProfile({...validIProfile, flangeThickness: null, webThickness: null}),
  /d و bf و tw و tf/,
  "I-section geometry must not silently pass with missing required dimensions");
assert.equal(validateProfile({name:"LEGACY",mass:7,area:900}),
  "",
  "legacy profiles without optional shape metadata remain import-compatible");
assert.match(validateProfile({name:" ",mass:7}), /نام یا کد/,
  "blank profile names must be rejected");
console.log("PASS: section-profile bank validation, geometry consistency, and legacy import compatibility");
