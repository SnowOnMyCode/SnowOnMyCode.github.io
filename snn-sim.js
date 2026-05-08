// SNN simulation core — 64-output port (matches user's updated sim.js).
// Adds visual hooks: per-output last-spike time, per-(i,j) last STDP-update time + sign.

(function () {
  const N_OUT = 64;
  const N_INPUTS = 2;

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function pruneOlder(arr, tLo) {
    let i = 0;
    while (i < arr.length && arr[i] <= tLo) i++;
    return arr.slice(i);
  }

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
      this.lastUpdateT = new Float64Array(n);
      this.lastUpdateSign = new Int8Array(n); // +1 / -1
    }
    R(i) { return this.Ron * this.x[i] + this.Roff * (1 - this.x[i]); }
    step(v, dt, t) {
      for (let i = 0; i < this.n; i++) {
        const vi = v[i];
        if (vi === 0) continue;
        const R = this.Ron * this.x[i] + this.Roff * (1 - this.x[i]);
        const cur = vi / R;
        const win = 1 - Math.pow(2 * this.x[i] - 1, 2 * this.p);
        let nx = this.x[i] + this.coef * cur * win * dt;
        if (nx < 1e-4) nx = 1e-4;
        else if (nx > 1 - 1e-4) nx = 1 - 1e-4;
        this.x[i] = nx;
        if (t !== undefined) {
          this.lastUpdateT[i] = t;
          this.lastUpdateSign[i] = vi > 0 ? 1 : -1;
        }
      }
    }
    reset() {
      const x0 = clamp((this.Roff - this.Rinit) / (this.Roff - this.Ron), 1e-3, 1 - 1e-3);
      this.x.fill(x0);
      this.lastUpdateT.fill(0);
      this.lastUpdateSign.fill(0);
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
      this.N_OUT = N_OUT;
      this.N_INPUTS = N_INPUTS;
      this.dt = 1e-4;
      this.time = 0;
      this.output = new LIF(N_OUT);
      this.syn = new MemristorArray(N_INPUTS * N_OUT);

      this.I_unit = 8e-9;
      this.tau_syn = 5e-3;
      this.I_syn = new Float64Array(N_OUT);

      this.preTrace = new Float64Array(N_INPUTS * N_OUT);
      this.postTrace = new Float64Array(N_OUT);
      this.tau_pre = 20e-3;
      this.tau_post = 20e-3;
      this.V_pot = 2.0;
      this.V_dep = -1.5;

      this.rate_A = 4;
      this.rate_B = 5;
      this.teacher = true;
      this.learning = true;

      this.spikesA = []; this.spikesB = [];
      this.outSpikes = []; // flat (t, j) pairs
      this.recentOutTimes = [];
      this.rateWindow = 2.0;
      this.tHist = []; this.rateHist = []; this.targetHist = []; this.meanWHist = [];
      this.maxHist = 2000;
      this.sampleEvery = 50;
      this._sc = 0;

      // Visual hooks
      this.lastSpikeA = -1e9;
      this.lastSpikeB = -1e9;
      this.lastSpikeOut = new Float64Array(N_OUT).fill(-1e9);

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
      const x = this.syn.x;
      const Iu = this.I_unit;
      const decaySyn = Math.exp(-dt / this.tau_syn);
      const decayPre = Math.exp(-dt / this.tau_pre);
      const decayPost = Math.exp(-dt / this.tau_post);
      const pA = this.rate_A * dt;
      const pB = this.rate_B * dt;
      const pT = (this.teacher && this.learning) ? this.targetRate * dt : 0;

      for (let j = 0; j < N_OUT; j++) this.I_syn[j] *= decaySyn;
      for (let k = 0; k < N_INPUTS * N_OUT; k++) this.preTrace[k] *= decayPre;
      for (let j = 0; j < N_OUT; j++) this.postTrace[j] *= decayPost;

      const preA = new Uint8Array(N_OUT);
      const preB = new Uint8Array(N_OUT);
      let anyA = false, anyB = false;
      for (let j = 0; j < N_OUT; j++) {
        if (Math.random() < pA) {
          preA[j] = 1; anyA = true;
          this.I_syn[j] += Iu * x[j];
        }
        if (Math.random() < pB) {
          preB[j] = 1; anyB = true;
          this.I_syn[j] += Iu * x[N_OUT + j];
        }
      }
      if (anyA) this.lastSpikeA = this.time;
      if (anyB) this.lastSpikeB = this.time;

      const teacher = new Uint8Array(N_OUT);
      if (pT > 0) {
        for (let j = 0; j < N_OUT; j++) if (Math.random() < pT) teacher[j] = 1;
      }

      const natural = this.output.step(this.I_syn, dt);
      for (let j = 0; j < N_OUT; j++) {
        if (teacher[j] && !natural[j]) this.output.forceSpike(j);
      }
      const spikes = new Uint8Array(N_OUT);
      for (let j = 0; j < N_OUT; j++) spikes[j] = (natural[j] | teacher[j]);

      if (this.learning) {
        const Vpot = this.V_pot, Vdep = this.V_dep;
        const vSyn = this._vSyn;
        let touched = false;
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
        for (let j = 0; j < N_OUT; j++) {
          if (preA[j]) { vSyn[j]         += Vdep * this.postTrace[j]; touched = true; }
          if (preB[j]) { vSyn[N_OUT + j] += Vdep * this.postTrace[j]; touched = true; }
        }
        if (touched) this.syn.step(vSyn, dt, this.time);
      }

      for (let j = 0; j < N_OUT; j++) {
        if (preA[j]) this.preTrace[j] += 1;
        if (preB[j]) this.preTrace[N_OUT + j] += 1;
        if (spikes[j]) this.postTrace[j] += 1;
      }

      this.time += dt;

      if (preA[0]) this.spikesA.push(this.time);
      if (preB[0]) this.spikesB.push(this.time);
      for (let j = 0; j < N_OUT; j++) {
        if (spikes[j]) {
          this.outSpikes.push(this.time, j);
          this.recentOutTimes.push(this.time);
          this.lastSpikeOut[j] = this.time;
        }
      }
      const cutoff = this.time - this.rateWindow;
      let cut = 0;
      while (cut < this.recentOutTimes.length && this.recentOutTimes[cut] < cutoff) cut++;
      if (cut > 0) this.recentOutTimes.splice(0, cut);

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

  window.ArithmeticSNN = ArithmeticSNN;
  window.MemristorArray = MemristorArray;
  window.LIF = LIF;
  window.SNN_N_OUT = N_OUT;
  window.SNN_N_INPUTS = N_INPUTS;
})();
