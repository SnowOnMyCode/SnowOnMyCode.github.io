// Memristive SNN with STDP — JS port of network.py.
// 2 input rate channels, 64 LIF output neurons, 128 Biolek HP memristor synapses.
// Independent Poisson realization per (input, output) gives true cross-neuron
// independence so population averaging reduces rate-readout variance ~ 1/sqrt(N).

const N_OUT = 64;
const N_INPUTS = 2;

class MemristorArray {
  constructor(n, opts = {}) {
    this.n = n;
    this.Ron   = opts.Ron   ?? 100;
    this.Roff  = opts.Roff  ?? 16e3;
    this.Rinit = opts.Rinit ?? 8e3;
    this.D     = opts.D     ?? 10e-9;
    this.uv    = opts.uv    ?? 5e-13;
    this.p     = opts.p     ?? 4;
    this.coef  = this.uv * this.Ron / (this.D * this.D);
    const x0 = clamp((this.Roff - this.Rinit) / (this.Roff - this.Ron), 1e-3, 1 - 1e-3);
    this.x = new Float64Array(n).fill(x0);
  }
  R(i) { return this.Ron * this.x[i] + this.Roff * (1 - this.x[i]); }
  step(v, dt) {
    for (let i = 0; i < this.n; i++) {
      const vi = v[i];
      if (vi === 0) continue;  // skip zero-pulse synapses fast
      const R = this.Ron * this.x[i] + this.Roff * (1 - this.x[i]);
      const cur = vi / R;
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
    const spikes = new Uint8Array(this.n);
    const k = dt / this.tau_m;
    for (let i = 0; i < this.n; i++) {
      if (this.refrac[i] > 0) {
        this.refrac[i] = Math.max(0, this.refrac[i] - dt);
      } else {
        this.v[i] += (-(this.v[i] - this.v_rest) + this.R_m * I[i]) * k;
      }
      if (this.v[i] >= this.v_thresh) {
        this.v[i] = this.v_reset;
        this.refrac[i] = this.t_refrac;
        spikes[i] = 1;
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
    this.output = new LIF(N_OUT);
    // Synapses: row-major (input i, output j) -> i*N_OUT + j
    this.syn = new MemristorArray(N_INPUTS * N_OUT);

    this.I_unit = 8e-9;
    this.tau_syn = 5e-3;
    this.I_syn = new Float64Array(N_OUT);

    this.preTrace = new Float64Array(N_INPUTS * N_OUT);  // (i, j) -> i*N_OUT + j
    this.postTrace = new Float64Array(N_OUT);
    this.tau_pre = 20e-3;
    this.tau_post = 20e-3;
    this.V_pot = 2.0;
    this.V_dep = -1.5;

    this.rate_A = 4;
    this.rate_B = 5;
    this.teacher = true;
    this.learning = true;

    // History
    this.spikesA = []; this.spikesB = [];   // representative single realization (output 0)
    this.outSpikes = [];                    // {t, j} pairs for raster
    this.recentOutTimes = [];               // for rate window
    this.rateWindow = 2.0;
    this.tHist = []; this.rateHist = []; this.targetHist = []; this.meanWHist = [];
    this.maxHist = 2000;
    this.sampleEvery = 50;
    this._sc = 0;

    // Buffers reused per step
    this._vSyn = new Float64Array(N_INPUTS * N_OUT);
  }

  get targetRate() { return this.rate_A + this.rate_B; }

  populationRate() {
    return this.recentOutTimes.length / (N_OUT * this.rateWindow);
  }

  reset() {
    this.syn.reset();
    this.preTrace.fill(0);
    this.postTrace.fill(0);
    this.I_syn.fill(0);
  }

  step() {
    const dt = this.dt;
    const x = this.syn.x;       // shared with weights
    const Iu = this.I_unit;
    const decaySyn = Math.exp(-dt / this.tau_syn);
    const decayPre = Math.exp(-dt / this.tau_pre);
    const decayPost = Math.exp(-dt / this.tau_post);
    const pA = this.rate_A * dt;
    const pB = this.rate_B * dt;
    const pT = (this.teacher && this.learning) ? this.targetRate * dt : 0;

    // Decay synaptic current and traces
    for (let j = 0; j < N_OUT; j++) this.I_syn[j] *= decaySyn;
    for (let k = 0; k < N_INPUTS * N_OUT; k++) this.preTrace[k] *= decayPre;
    for (let j = 0; j < N_OUT; j++) this.postTrace[j] *= decayPost;

    // Generate independent Poisson per (input, output), accumulate I_syn
    const preA = new Uint8Array(N_OUT);
    const preB = new Uint8Array(N_OUT);
    for (let j = 0; j < N_OUT; j++) {
      if (Math.random() < pA) {
        preA[j] = 1;
        this.I_syn[j] += Iu * x[j];                     // weight A->j is x[0*N_OUT + j]
      }
      if (Math.random() < pB) {
        preB[j] = 1;
        this.I_syn[j] += Iu * x[N_OUT + j];             // weight B->j is x[1*N_OUT + j]
      }
    }

    // Generate teacher mask (only if learning)
    const teacher = new Uint8Array(N_OUT);
    if (pT > 0) {
      for (let j = 0; j < N_OUT; j++) if (Math.random() < pT) teacher[j] = 1;
    }

    // LIF integrate
    const natural = this.output.step(this.I_syn, dt);
    for (let j = 0; j < N_OUT; j++) {
      if (teacher[j] && !natural[j]) this.output.forceSpike(j);
    }
    const spikes = new Uint8Array(N_OUT);
    for (let j = 0; j < N_OUT; j++) spikes[j] = (natural[j] | teacher[j]);

    // STDP weight update (vectorized over 128 synapses)
    if (this.learning) {
      const Vpot = this.V_pot, Vdep = this.V_dep;
      const vSyn = this._vSyn;
      let touched = false;
      // Potentiation: (i, j) where post j spiked, by pre_trace[i, j]
      for (let j = 0; j < N_OUT; j++) {
        if (spikes[j]) {
          vSyn[j]         = Vpot * this.preTrace[j];
          vSyn[N_OUT + j] = Vpot * this.preTrace[N_OUT + j];
          touched = true;
        } else {
          vSyn[j]         = 0;
          vSyn[N_OUT + j] = 0;
        }
      }
      // Depression: (i, j) where pre[i, j] spiked, by post_trace[j]
      for (let j = 0; j < N_OUT; j++) {
        if (preA[j]) { vSyn[j]         += Vdep * this.postTrace[j]; touched = true; }
        if (preB[j]) { vSyn[N_OUT + j] += Vdep * this.postTrace[j]; touched = true; }
      }
      if (touched) this.syn.step(vSyn, dt);
    }

    // Update traces with current spikes
    for (let j = 0; j < N_OUT; j++) {
      if (preA[j]) this.preTrace[j] += 1;
      if (preB[j]) this.preTrace[N_OUT + j] += 1;
      if (spikes[j]) this.postTrace[j] += 1;
    }

    this.time += dt;

    // Bookkeeping for the dashboard
    if (preA[0]) this.spikesA.push(this.time);
    if (preB[0]) this.spikesB.push(this.time);
    for (let j = 0; j < N_OUT; j++) {
      if (spikes[j]) {
        this.outSpikes.push(this.time, j);   // flat (t, j) pairs
        this.recentOutTimes.push(this.time);
      }
    }
    // Trim recent for rate window
    const cutoff = this.time - this.rateWindow;
    let cut = 0;
    while (cut < this.recentOutTimes.length && this.recentOutTimes[cut] < cutoff) cut++;
    if (cut > 0) this.recentOutTimes.splice(0, cut);

    // Sampled history
    this._sc++;
    if (this._sc >= this.sampleEvery) {
      this._sc = 0;
      this.tHist.push(this.time);
      this.rateHist.push(this.populationRate());
      this.targetHist.push(this.targetRate);
      let s = 0;
      for (let k = 0; k < this.syn.x.length; k++) s += this.syn.x[k];
      this.meanWHist.push(s / this.syn.x.length);
      if (this.tHist.length > this.maxHist) {
        const c = this.tHist.length - this.maxHist;
        this.tHist.splice(0, c);
        this.rateHist.splice(0, c);
        this.targetHist.splice(0, c);
        this.meanWHist.splice(0, c);
      }
    }

    // Trim raster spike arrays (keep last 5 s)
    if (this.spikesA.length > 4096) this.spikesA = pruneOlder(this.spikesA, this.time - 5);
    if (this.spikesB.length > 4096) this.spikesB = pruneOlder(this.spikesB, this.time - 5);
    if (this.outSpikes.length > 60000) {
      const tLo = this.time - 5;
      const filtered = [];
      for (let k = 0; k < this.outSpikes.length; k += 2) {
        if (this.outSpikes[k] > tLo) {
          filtered.push(this.outSpikes[k], this.outSpikes[k + 1]);
        }
      }
      this.outSpikes = filtered;
    }
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

const net = new ArithmeticSNN();
let simSpeed = 1.0;
const MAX_STEPS_PER_FRAME = 8000;
let lastWall = performance.now();

function simTick(now) {
  let wallDt = (now - lastWall) / 1000;
  lastWall = now;
  if (wallDt > 0.1) wallDt = 0.1;
  const target = wallDt * simSpeed;
  const nSteps = Math.min(MAX_STEPS_PER_FRAME, Math.max(0, Math.round(target / net.dt)));
  for (let i = 0; i < nSteps; i++) net.step();
  requestAnimationFrame(simTick);
}
requestAnimationFrame(simTick);

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
  net.sampleEvery = Math.min(200, Math.max(20, Math.round(50 * v)));
});
$('learn').addEventListener('change', e => net.learning = e.target.checked);
$('teach').addEventListener('change', e => net.teacher  = e.target.checked);
$('reset').addEventListener('click', () => net.reset());

const PLOT_CONFIG = { responsive: true, displayModeBar: false };
const COMMON_LAYOUT = { margin: { l: 50, r: 20, t: 36, b: 30 }, font: { size: 11 } };
const C = { A: '#1f77b4', B: '#ff7f0e', OUT: '#2ca02c', TGT: '#7f7f7f' };

// Output spike marker (compact line for raster)
const RASTER_MARKER = sz => ({ symbol: 'line-ns-open', size: sz, line: { color: '#2ca02c', width: 1 } });

Plotly.newPlot('raster', [
  { x: [], y: [], mode: 'markers', name: 'Out',
    marker: { symbol: 'line-ns-open', size: 6, line: { color: C.OUT, width: 1 } } },
  { x: [], y: [], mode: 'markers', name: 'Pre A',
    marker: { symbol: 'line-ns-open', size: 12, line: { color: C.A, width: 2 } } },
  { x: [], y: [], mode: 'markers', name: 'Pre B',
    marker: { symbol: 'line-ns-open', size: 12, line: { color: C.B, width: 2 } } },
], {
  ...COMMON_LAYOUT, title: 'Spike raster (last 2 s)', showlegend: false,
  xaxis: { title: 't (s)' },
  yaxis: {
    range: [-3, N_OUT + 1],
    tickvals: [-2, -1, ...Array(8).fill(0).map((_, i) => i * 8)],
    ticktext: ['A', 'B', ...Array(8).fill(0).map((_, i) => `out ${i*8}`)],
  },
}, PLOT_CONFIG);

Plotly.newPlot('ratehist', [
  { x: [], y: [], mode: 'lines', name: 'output rate', line: { color: C.OUT, width: 2 } },
  { x: [], y: [], mode: 'lines', name: 'target = A + B', line: { color: C.TGT, dash: 'dash' } },
], { ...COMMON_LAYOUT, title: 'Output mean rate vs target (Hz)',
     yaxis: { title: 'Hz' }, xaxis: { title: 't (s)' } }, PLOT_CONFIG);

Plotly.newPlot('weights', [{
  type: 'heatmap',
  z: [Array(N_OUT).fill(0), Array(N_OUT).fill(0)],
  x: Array(N_OUT).fill(0).map((_, j) => j),
  y: ['A → out', 'B → out'],
  colorscale: 'Viridis', zmin: 0, zmax: 1,
  hovertemplate: 'output %{x}<br>weight %{z:.2f}<extra></extra>',
}], { ...COMMON_LAYOUT, title: 'Memristor weights x_{i,j} (heatmap, 2 × 64)',
      yaxis: { tickvals: [0, 1], ticktext: ['A → out', 'B → out'] } }, PLOT_CONFIG);

function uiTick() {
  const tNow = net.time;
  const win = 2.0;
  const tLo = tNow - win;

  const sA = net.spikesA.filter(t => t > tLo);
  const sB = net.spikesB.filter(t => t > tLo);

  // Output spikes within window (flat (t, j) pairs)
  const xOut = [], yOut = [];
  for (let k = 0; k < net.outSpikes.length; k += 2) {
    const t = net.outSpikes[k];
    if (t > tLo) { xOut.push(t); yOut.push(net.outSpikes[k + 1]); }
  }

  Plotly.react('raster', [
    { x: xOut, y: yOut, mode: 'markers', name: 'Out',
      marker: { symbol: 'line-ns-open', size: 6, line: { color: C.OUT, width: 1 } } },
    { x: sA, y: Array(sA.length).fill(-2), mode: 'markers', name: 'Pre A',
      marker: { symbol: 'line-ns-open', size: 12, line: { color: C.A, width: 2 } } },
    { x: sB, y: Array(sB.length).fill(-1), mode: 'markers', name: 'Pre B',
      marker: { symbol: 'line-ns-open', size: 12, line: { color: C.B, width: 2 } } },
  ], {
    ...COMMON_LAYOUT, title: 'Spike raster (last 2 s)', showlegend: false,
    xaxis: { title: 't (s)', range: [tLo, tNow] },
    yaxis: {
      range: [-3, N_OUT],
      tickvals: [-2, -1, 0, 16, 32, 48, 63],
      ticktext: ['A', 'B', 'out 0', 'out 16', 'out 32', 'out 48', 'out 63'],
    },
  });

  Plotly.react('ratehist', [
    { x: net.tHist, y: net.rateHist, mode: 'lines', name: 'output rate',
      line: { color: C.OUT, width: 2 } },
    { x: net.tHist, y: net.targetHist, mode: 'lines', name: 'target = A + B',
      line: { color: C.TGT, dash: 'dash' } },
  ], { ...COMMON_LAYOUT, title: 'Output mean rate vs target (Hz)',
       yaxis: { title: 'Hz', range: [0, Math.max(net.targetRate, 10) * 1.4] },
       xaxis: { title: 't (s)' } });

  // Weight heatmap: row 0 = A->out_j, row 1 = B->out_j
  const wA = Array.from(net.syn.x.subarray(0, N_OUT));
  const wB = Array.from(net.syn.x.subarray(N_OUT, 2 * N_OUT));
  Plotly.react('weights', [{
    type: 'heatmap', z: [wA, wB],
    colorscale: 'Viridis', zmin: 0, zmax: 1,
    hovertemplate: 'output %{x}<br>weight %{z:.2f}<extra></extra>',
  }], { ...COMMON_LAYOUT, title: 'Memristor weights x_{i,j} (heatmap, 2 × 64)',
        yaxis: { tickvals: [0, 1], ticktext: ['A → out', 'B → out'] } });

  const target = net.targetRate;
  const actual = net.populationRate();
  const meanW = net.syn.x.reduce((a, b) => a + b, 0) / net.syn.x.length;

  $('big-actual').textContent = actual.toFixed(2);
  $('big-target').textContent = target.toFixed(1);
  const err = actual - target;
  $('big-error').textContent = (err >= 0 ? '+' : '') + err.toFixed(2);
  $('status').textContent =
    `sim time: ${tNow.toFixed(2)} s   speed: ${simSpeed.toFixed(1)}x\n` +
    `mean weight x = ${meanW.toFixed(3)}\n` +
    `w_A = ${(wA.reduce((a,b)=>a+b,0)/N_OUT).toFixed(3)}   ` +
    `w_B = ${(wB.reduce((a,b)=>a+b,0)/N_OUT).toFixed(3)}`;
}
setInterval(uiTick, 200);

} // end startApp
window.startApp = startApp;
