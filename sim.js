// Memristive SNN with STDP — pure JS port of network.py, runs in the browser.
// Biolek HP memristor (Joglekar window) + LIF neurons + pair-based STDP.

class MemristorArray {
  constructor(n, opts = {}) {
    this.n = n;
    this.Ron   = opts.Ron   ?? 100;
    this.Roff  = opts.Roff  ?? 16e3;
    this.Rinit = opts.Rinit ?? 8e3;
    this.D     = opts.D     ?? 10e-9;
    this.uv    = opts.uv    ?? 1e-13;
    this.p     = opts.p     ?? 4;
    this.coef  = this.uv * this.Ron / (this.D * this.D);
    const x0 = clamp((this.Roff - this.Rinit) / (this.Roff - this.Ron), 1e-3, 1 - 1e-3);
    this.x = new Float64Array(n).fill(x0);
  }
  R(i) { return this.Ron * this.x[i] + this.Roff * (1 - this.x[i]); }
  step(v, dt) {
    for (let i = 0; i < this.n; i++) {
      const R = this.Ron * this.x[i] + this.Roff * (1 - this.x[i]);
      const cur = v[i] / R;
      const win = 1 - Math.pow(2 * this.x[i] - 1, 2 * this.p);
      let nx = this.x[i] + this.coef * cur * win * dt;
      if (nx < 1e-4) nx = 1e-4;
      else if (nx > 1 - 1e-4) nx = 1 - 1e-4;
      this.x[i] = nx;
    }
  }
  reset() {
    const x0 = clamp((this.Roff - this.Rinit) / (this.Roff - this.Ron), 1e-3, 1 - 1e-3);
    this.x.fill(x0);
  }
}

class LIF {
  constructor(n, opts = {}) {
    this.n        = n;
    this.tau_m    = opts.tau_m    ?? 20e-3;
    this.v_rest   = opts.v_rest   ?? -70e-3;
    this.v_reset  = opts.v_reset  ?? -75e-3;
    this.v_thresh = opts.v_thresh ?? -54e-3;
    this.R_m      = opts.R_m      ?? 20e6;
    this.t_refrac = opts.t_refrac ?? 2e-3;
    this.v        = new Float64Array(n).fill(this.v_rest);
    this.refrac   = new Float64Array(n);
  }
  step(I, dt) {
    const spikes = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      if (this.refrac[i] <= 0) {
        const dv = (-(this.v[i] - this.v_rest) + this.R_m * I[i]) * (dt / this.tau_m);
        this.v[i] += dv;
      } else {
        this.refrac[i] = Math.max(0, this.refrac[i] - dt);
      }
      if (this.v[i] >= this.v_thresh) {
        this.v[i] = this.v_reset;
        this.refrac[i] = this.t_refrac;
        spikes[i] = true;
      } else {
        spikes[i] = false;
      }
    }
    return spikes;
  }
  forceSpike(i) {
    this.v[i] = this.v_reset;
    this.refrac[i] = this.t_refrac;
  }
}

class ArithmeticSNN {
  constructor() {
    this.dt = 1e-4;
    this.time = 0;
    this.output = new LIF(1);
    this.syn = new MemristorArray(2);

    this.I_unit = 2e-9;
    this.tau_syn = 5e-3;
    this.I_syn = 0;

    this.preTrace = [0, 0];
    this.postTrace = 0;
    this.tau_pre = 20e-3;
    this.tau_post = 20e-3;
    this.V_pot = 2;
    this.V_dep = -1.5;

    this.rate_A = 5;
    this.rate_B = 5;
    this.teacher = true;
    this.learning = true;

    this.spikesA = []; this.spikesB = []; this.spikesO = []; this.spikesT = [];
    this.tHist = []; this.vHist = []; this.wHist = []; this.preHist = [];
    this.maxHist = 4000;
    this.sampleEvery = 10;
    this._sc = 0;
  }

  step() {
    const dt = this.dt;
    const sA = Math.random() < this.rate_A * dt;
    const sB = Math.random() < this.rate_B * dt;

    this.I_syn *= Math.exp(-dt / this.tau_syn);
    if (sA || sB) {
      const w = this.syn.x;
      this.I_syn += this.I_unit * ((sA ? w[0] : 0) + (sB ? w[1] : 0));
    }

    const target = this.rate_A + this.rate_B;
    const teacher = this.teacher && this.learning && Math.random() < target * dt;

    const natural = this.output.step([this.I_syn], dt);
    let outSpike = natural[0];
    if (teacher && !outSpike) {
      this.output.forceSpike(0);
      outSpike = true;
    }

    const dpre  = Math.exp(-dt / this.tau_pre);
    const dpost = Math.exp(-dt / this.tau_post);
    this.preTrace[0] *= dpre;
    this.preTrace[1] *= dpre;
    this.postTrace *= dpost;

    let v0 = 0, v1 = 0;
    if (outSpike) {
      v0 += this.V_pot * this.preTrace[0];
      v1 += this.V_pot * this.preTrace[1];
    }
    if (sA) v0 += this.V_dep * this.postTrace;
    if (sB) v1 += this.V_dep * this.postTrace;

    if (this.learning && (Math.abs(v0) > 1e-12 || Math.abs(v1) > 1e-12)) {
      this.syn.step([v0, v1], dt);
    }

    if (sA) this.preTrace[0] += 1;
    if (sB) this.preTrace[1] += 1;
    if (outSpike) this.postTrace += 1;

    this.time += dt;

    if (sA) this.spikesA.push(this.time);
    if (sB) this.spikesB.push(this.time);
    if (outSpike) this.spikesO.push(this.time);
    if (teacher) this.spikesT.push(this.time);

    this._sc++;
    if (this._sc >= this.sampleEvery) {
      this._sc = 0;
      this.tHist.push(this.time);
      this.vHist.push(this.output.v[0]);
      this.wHist.push([this.syn.x[0], this.syn.x[1]]);
      this.preHist.push([this.preTrace[0], this.preTrace[1]]);
      if (this.tHist.length > this.maxHist) {
        const cut = this.tHist.length - this.maxHist;
        this.tHist.splice(0, cut);
        this.vHist.splice(0, cut);
        this.wHist.splice(0, cut);
        this.preHist.splice(0, cut);
      }
    }

    // Periodically prune spike arrays to last 5 s
    if (this.spikesA.length > 8192) this.spikesA = pruneOlder(this.spikesA, this.time - 5);
    if (this.spikesB.length > 8192) this.spikesB = pruneOlder(this.spikesB, this.time - 5);
    if (this.spikesO.length > 8192) this.spikesO = pruneOlder(this.spikesO, this.time - 5);
    if (this.spikesT.length > 8192) this.spikesT = pruneOlder(this.spikesT, this.time - 5);
  }
}

function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function pruneOlder(arr, tLo) {
  let i = 0;
  while (i < arr.length && arr[i] <= tLo) i++;
  return arr.slice(i);
}

// ---- App boot (called by gate.js after passcode unlock) ----
function startApp() {
// ---- Simulation driver ----
const net = new ArithmeticSNN();
let simSpeed = 1.0;
const MAX_STEPS_PER_FRAME = 30000;
let lastWall = performance.now();

function simTick(now) {
  let wallDt = (now - lastWall) / 1000;
  lastWall = now;
  if (wallDt > 0.1) wallDt = 0.1;          // cap when tab regains focus
  const simTarget = wallDt * simSpeed;
  const nSteps = Math.min(MAX_STEPS_PER_FRAME,
                          Math.max(0, Math.round(simTarget / net.dt)));
  for (let i = 0; i < nSteps; i++) net.step();
  requestAnimationFrame(simTick);
}
requestAnimationFrame(simTick);

// ---- UI ----
const $ = id => document.getElementById(id);
function bindRange(id, valId, fn) {
  const el = $(id), v = $(valId);
  const update = () => { v.textContent = el.value; fn(parseFloat(el.value)); };
  el.addEventListener('input', update);
  update();
}
bindRange('rate-a', 'rate-a-val', v => net.rate_A = v);
bindRange('rate-b', 'rate-b-val', v => net.rate_B = v);
bindRange('speed',  'speed-val',  v => {
  simSpeed = v;
  net.sampleEvery = Math.min(200, Math.max(10, Math.round(20 * v)));
});
$('learn').addEventListener('change', e => net.learning = e.target.checked);
$('teach').addEventListener('change', e => net.teacher  = e.target.checked);
$('reset').addEventListener('click', () => net.syn.reset());

// ---- Plots ----
const PLOT_CONFIG = { responsive: true, displayModeBar: false };
const COMMON_LAYOUT = { margin: { l: 50, r: 20, t: 40, b: 30 }, font: { size: 11 } };
const C = { A: '#1f77b4', B: '#ff7f0e', OUT: '#2ca02c', T: '#d62728' };

function rasterTrace(times, y, color, marker = 'line-ns-open', size = 14) {
  const symbol = marker;
  const m = symbol === 'line-ns-open'
    ? { symbol, size, line: { color, width: 2 } }
    : { symbol, size, color };
  return { x: times, y: Array(times.length).fill(y), mode: 'markers', marker: m, hoverinfo: 'skip' };
}

Plotly.newPlot('raster', [
  rasterTrace([], 3, C.A),
  rasterTrace([], 2, C.B),
  rasterTrace([], 1, C.OUT),
  rasterTrace([], 0.5, C.T, 'triangle-up', 8),
], {
  ...COMMON_LAYOUT, title: 'Spike raster (last 2 s)', showlegend: false,
  yaxis: { tickvals: [3, 2, 1, 0.5], ticktext: ['A', 'B', 'Out', 'Teach'], range: [0, 3.6] },
  xaxis: { title: 't (s)' },
}, PLOT_CONFIG);

Plotly.newPlot('vhist',
  [{ x: [], y: [], mode: 'lines', line: { color: C.OUT } }],
  { ...COMMON_LAYOUT, title: 'Output membrane potential (mV)',
    yaxis: { range: [-80, -45] }, xaxis: { title: 't (s)' },
    shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: -54, y1: -54,
               line: { dash: 'dash', color: '#888', width: 1 } }] },
  PLOT_CONFIG);

Plotly.newPlot('ptrace', [
  { x: [], y: [], mode: 'lines', name: 'A trace', line: { color: C.A } },
  { x: [], y: [], mode: 'lines', name: 'B trace', line: { color: C.B } },
], { ...COMMON_LAYOUT, title: 'Input pre-trace activity',
     yaxis: { range: [0, 1.1] }, xaxis: { title: 't (s)' } }, PLOT_CONFIG);

Plotly.newPlot('weights', [
  { x: [], y: [], mode: 'lines', name: 'w_A', line: { color: C.A } },
  { x: [], y: [], mode: 'lines', name: 'w_B', line: { color: C.B } },
], { ...COMMON_LAYOUT, title: 'Memristor state x (synaptic weight)',
     yaxis: { range: [0, 1] }, xaxis: { title: 't (s)' } }, PLOT_CONFIG);

Plotly.newPlot('rates', [
  { x: ['Target (A + B)', 'Output (actual)'], y: [0, 0], type: 'bar',
    marker: { color: ['#7f7f7f', C.OUT] },
    text: ['', ''], textposition: 'outside' }
], { ...COMMON_LAYOUT, title: 'Firing rate comparison',
     yaxis: { title: 'Hz', range: [0, 30] } }, PLOT_CONFIG);

// ---- UI redraw loop ----
function uiTick() {
  const tNow = net.time;
  const win = 2.0;
  const tLo = tNow - win;

  const sA = net.spikesA.filter(t => t > tLo);
  const sB = net.spikesB.filter(t => t > tLo);
  const sO = net.spikesO.filter(t => t > tLo);
  const sT = net.spikesT.filter(t => t > tLo);

  const tH = net.tHist;
  let lo = 0;
  for (let i = tH.length - 1; i >= 0; i--) {
    if (tH[i] <= tLo) { lo = i; break; }
  }
  const tv = tH.slice(lo);
  const vv = net.vHist.slice(lo);
  const pp = net.preHist.slice(lo);

  Plotly.react('raster', [
    rasterTrace(sA, 3, C.A),
    rasterTrace(sB, 2, C.B),
    rasterTrace(sO, 1, C.OUT),
    rasterTrace(sT, 0.5, C.T, 'triangle-up', 8),
  ], {
    ...COMMON_LAYOUT, title: 'Spike raster (last 2 s)', showlegend: false,
    yaxis: { tickvals: [3, 2, 1, 0.5], ticktext: ['A', 'B', 'Out', 'Teach'], range: [0, 3.6] },
    xaxis: { title: 't (s)', range: [tLo, tNow] },
  });

  const vmV = new Array(vv.length);
  for (let i = 0; i < vv.length; i++) vmV[i] = vv[i] * 1e3;
  Plotly.react('vhist',
    [{ x: tv, y: vmV, mode: 'lines', line: { color: C.OUT } }],
    { ...COMMON_LAYOUT, title: 'Output membrane potential (mV)',
      yaxis: { range: [-80, -45] }, xaxis: { title: 't (s)', range: [tLo, tNow] },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: -54, y1: -54,
                 line: { dash: 'dash', color: '#888', width: 1 } }] });

  Plotly.react('ptrace', [
    { x: tv, y: pp.map(p => p[0]), mode: 'lines', name: 'A trace', line: { color: C.A } },
    { x: tv, y: pp.map(p => p[1]), mode: 'lines', name: 'B trace', line: { color: C.B } },
  ], { ...COMMON_LAYOUT, title: 'Input pre-trace activity',
       yaxis: { range: [0, 1.1] }, xaxis: { title: 't (s)', range: [tLo, tNow] } });

  Plotly.react('weights', [
    { x: net.tHist, y: net.wHist.map(w => w[0]), mode: 'lines', name: 'w_A', line: { color: C.A } },
    { x: net.tHist, y: net.wHist.map(w => w[1]), mode: 'lines', name: 'w_B', line: { color: C.B } },
  ], { ...COMMON_LAYOUT, title: 'Memristor state x (synaptic weight)',
       yaxis: { range: [0, 1] }, xaxis: { title: 't (s)' } });

  const target = net.rate_A + net.rate_B;
  const actual = sO.length / win;
  Plotly.react('rates', [
    { x: ['Target (A + B)', 'Output (actual)'], y: [target, actual], type: 'bar',
      marker: { color: ['#7f7f7f', C.OUT] },
      text: [`${target.toFixed(1)} Hz`, `${actual.toFixed(1)} Hz`],
      textposition: 'outside' }
  ], { ...COMMON_LAYOUT, title: 'Firing rate comparison',
       yaxis: { title: 'Hz', range: [0, Math.max(target, actual, 10) * 1.3] } });

  $('status').textContent =
    `sim time: ${tNow.toFixed(2)} s   (speed: ${simSpeed.toFixed(1)}x)\n` +
    `w_A = ${net.syn.x[0].toFixed(3)}   R_A = ${net.syn.R(0).toFixed(0)} Ω\n` +
    `w_B = ${net.syn.x[1].toFixed(3)}   R_B = ${net.syn.R(1).toFixed(0)} Ω`;
}
setInterval(uiTick, 200);
} // end startApp
window.startApp = startApp;
