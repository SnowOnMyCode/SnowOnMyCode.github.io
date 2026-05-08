// Plotly chart components — 64-output port. All dark-themed.

const PLOT_CONFIG = { responsive: true, displayModeBar: false };

function darkLayout(theme, extras = {}) {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 50, r: 18, t: 28, b: 36 },
    font: {
      family: 'JetBrains Mono, ui-monospace, monospace',
      size: 10,
      color: theme.textDim,
    },
    xaxis: {
      gridcolor: theme.grid, zerolinecolor: theme.grid,
      linecolor: theme.border, tickcolor: theme.border, color: theme.textMute,
    },
    yaxis: {
      gridcolor: theme.grid, zerolinecolor: theme.grid,
      linecolor: theme.border, tickcolor: theme.border, color: theme.textMute,
    },
    showlegend: false,
    ...extras,
  };
}

function hexToA(hex, a) {
  const { r, g, b } = window.hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function clampLocal(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

// 64-row spike raster + A/B at top
const RasterPlot = ({ snn, tick, theme }) => {
  const id = 'plot-raster';
  React.useEffect(() => {
    Plotly.newPlot(id, [], darkLayout(theme), PLOT_CONFIG);
  }, []);
  React.useEffect(() => {
    if (!snn) return;
    const N = snn.N_OUT;
    const tNow = snn.time;
    const win = 2.0;
    const tLo = tNow - win;
    const sA = snn.spikesA.filter(t => t > tLo);
    const sB = snn.spikesB.filter(t => t > tLo);
    const xOut = [], yOut = [];
    for (let k = 0; k < snn.outSpikes.length; k += 2) {
      const t = snn.outSpikes[k];
      if (t > tLo) { xOut.push(t); yOut.push(snn.outSpikes[k + 1]); }
    }
    Plotly.react(id, [
      { x: xOut, y: yOut, mode: 'markers', name: 'Out',
        marker: { symbol: 'line-ns-open', size: 5, line: { color: theme.OUT, width: 1 } },
        hoverinfo: 'skip' },
      { x: sA, y: Array(sA.length).fill(-2), mode: 'markers', name: 'A',
        marker: { symbol: 'line-ns-open', size: 12, line: { color: theme.A, width: 2 } },
        hoverinfo: 'skip' },
      { x: sB, y: Array(sB.length).fill(-1), mode: 'markers', name: 'B',
        marker: { symbol: 'line-ns-open', size: 12, line: { color: theme.B, width: 2 } },
        hoverinfo: 'skip' },
    ], darkLayout(theme, {
      yaxis: {
        range: [-3, N],
        tickvals: [-2, -1, 0, 16, 32, 48, 63],
        ticktext: ['A', 'B', 'out 0', '16', '32', '48', '63'],
        gridcolor: theme.grid, color: theme.textMute,
      },
      xaxis: { range: [tLo, tNow], color: theme.textMute, gridcolor: theme.grid,
               title: { text: 't · s', font: { size: 9, color: theme.textMute } } },
    }), PLOT_CONFIG);
  }, [tick, theme]);
  return <div id={id} style={{ width: '100%', height: '100%' }} />;
};

// Output mean rate vs target — line plot, all-time
const RatePlot = ({ snn, tick, theme }) => {
  const id = 'plot-rate';
  React.useEffect(() => { Plotly.newPlot(id, [], darkLayout(theme), PLOT_CONFIG); }, []);
  React.useEffect(() => {
    if (!snn) return;
    Plotly.react(id, [
      { x: snn.tHist, y: snn.targetHist, mode: 'lines', name: 'target',
        line: { color: theme.textDim, width: 1.4, dash: 'dash' } },
      { x: snn.tHist, y: snn.rateHist, mode: 'lines', name: 'output',
        line: { color: theme.OUT, width: 1.6 },
        fill: 'tozeroy', fillcolor: hexToA(theme.OUT, 0.08) },
    ], darkLayout(theme, {
      yaxis: { range: [0, Math.max(snn.targetRate, 5) * 1.4],
               color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'Hz', font: { size: 9, color: theme.textMute } } },
      xaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 't · s', font: { size: 9, color: theme.textMute } } },
    }), PLOT_CONFIG);
  }, [tick, theme]);
  return <div id={id} style={{ width: '100%', height: '100%' }} />;
};

// 2×64 weight heatmap
const WeightPlot = ({ snn, tick, theme }) => {
  const id = 'plot-w';
  React.useEffect(() => { Plotly.newPlot(id, [], darkLayout(theme), PLOT_CONFIG); }, []);
  React.useEffect(() => {
    if (!snn) return;
    const N = snn.N_OUT;
    const wA = Array.from(snn.syn.x.subarray(0, N));
    const wB = Array.from(snn.syn.x.subarray(N, 2 * N));
    Plotly.react(id, [{
      type: 'heatmap', z: [wA, wB],
      x: Array.from({ length: N }, (_, j) => j),
      y: ['A → out', 'B → out'],
      colorscale: [
        [0, hexToA(theme.bg, 1)],
        [0.5, hexToA(theme.accent, 0.55)],
        [1, theme.accent],
      ],
      zmin: 0, zmax: 1,
      colorbar: {
        thickness: 8, len: 0.8, outlinewidth: 0,
        tickfont: { color: theme.textMute, size: 9 },
        title: { text: 'x', font: { color: theme.textMute, size: 9 } },
      },
      hovertemplate: 'output %{x}<br>weight %{z:.2f}<extra></extra>',
    }], darkLayout(theme, {
      yaxis: { tickvals: [0, 1], ticktext: ['A', 'B'], color: theme.textMute },
      xaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'output index j', font: { size: 9, color: theme.textMute } } },
    }), PLOT_CONFIG);
  }, [tick, theme]);
  return <div id={id} style={{ width: '100%', height: '100%' }} />;
};

// Mean weight x over time
const MeanWPlot = ({ snn, tick, theme }) => {
  const id = 'plot-meanw';
  React.useEffect(() => { Plotly.newPlot(id, [], darkLayout(theme), PLOT_CONFIG); }, []);
  React.useEffect(() => {
    if (!snn) return;
    Plotly.react(id, [
      { x: snn.tHist, y: snn.meanWHist, mode: 'lines',
        line: { color: theme.accent, width: 1.4 },
        fill: 'tozeroy', fillcolor: hexToA(theme.accent, 0.06) },
    ], darkLayout(theme, {
      yaxis: { range: [0, 1], color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'mean x', font: { size: 9, color: theme.textMute } } },
      xaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 't · s', font: { size: 9, color: theme.textMute } } },
    }), PLOT_CONFIG);
  }, [tick, theme]);
  return <div id={id} style={{ width: '100%', height: '100%' }} />;
};

// Resistance Ω heatmap (snapshot, 2x64, log scale via tick text)
const RPlot = ({ snn, tick, theme }) => {
  const id = 'plot-r';
  React.useEffect(() => { Plotly.newPlot(id, [], darkLayout(theme), PLOT_CONFIG); }, []);
  React.useEffect(() => {
    if (!snn) return;
    const N = snn.N_OUT;
    const rA = Array.from({ length: N }, (_, j) => snn.syn.R(j));
    const rB = Array.from({ length: N }, (_, j) => snn.syn.R(N + j));
    Plotly.react(id, [{
      type: 'heatmap', z: [rA.map(r => Math.log10(r)), rB.map(r => Math.log10(r))],
      x: Array.from({ length: N }, (_, j) => j),
      y: ['A → out', 'B → out'],
      colorscale: [
        [0, theme.accent],
        [0.5, hexToA(theme.accent, 0.55)],
        [1, hexToA(theme.bg, 1)],
      ],
      zmin: Math.log10(snn.syn.Ron), zmax: Math.log10(snn.syn.Roff),
      colorbar: {
        thickness: 8, len: 0.8, outlinewidth: 0,
        tickvals: [2, 3, 4],
        ticktext: ['100Ω', '1kΩ', '10kΩ'],
        tickfont: { color: theme.textMute, size: 9 },
      },
      hovertemplate: 'output %{x}<br>log₁₀ R %{z:.2f}<extra></extra>',
    }], darkLayout(theme, {
      yaxis: { tickvals: [0, 1], ticktext: ['A', 'B'], color: theme.textMute },
      xaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'output index j', font: { size: 9, color: theme.textMute } } },
    }), PLOT_CONFIG);
  }, [tick, theme]);
  return <div id={id} style={{ width: '100%', height: '100%' }} />;
};

// Per-output firing rate bar (snapshot of recent 2s window)
const PerOutputRatePlot = ({ snn, tick, theme }) => {
  const id = 'plot-perj';
  React.useEffect(() => { Plotly.newPlot(id, [], darkLayout(theme), PLOT_CONFIG); }, []);
  React.useEffect(() => {
    if (!snn) return;
    const N = snn.N_OUT;
    const tLo = snn.time - 2.0;
    const counts = new Array(N).fill(0);
    for (let k = 0; k < snn.outSpikes.length; k += 2) {
      if (snn.outSpikes[k] > tLo) counts[snn.outSpikes[k + 1]]++;
    }
    const rates = counts.map(c => c / 2.0);
    const target = snn.targetRate;
    Plotly.react(id, [
      { x: Array.from({ length: N }, (_, j) => j), y: rates, type: 'bar',
        marker: { color: theme.OUT, opacity: 0.85,
                  line: { color: theme.OUT, width: 0 } },
        hovertemplate: 'out %{x}<br>%{y:.1f} Hz<extra></extra>' },
    ], darkLayout(theme, {
      yaxis: { range: [0, Math.max(target * 1.6, 10)],
               color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'Hz', font: { size: 9, color: theme.textMute } } },
      xaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'output j', font: { size: 9, color: theme.textMute } } },
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: target, y1: target,
                 line: { color: theme.textDim, dash: 'dash', width: 1 } }],
    }), PLOT_CONFIG);
  }, [tick, theme]);
  return <div id={id} style={{ width: '100%', height: '100%' }} />;
};

// Static STDP window
const StdpWindowPlot = ({ snn, theme }) => {
  const id = 'plot-stdp';
  React.useEffect(() => {
    const tau_pre = snn ? snn.tau_pre : 20e-3;
    const tau_post = snn ? snn.tau_post : 20e-3;
    const Vp = snn ? snn.V_pot : 2;
    const Vd = snn ? snn.V_dep : -1.5;
    const xs = [], yPos = [], yNeg = [];
    for (let i = -100; i <= 100; i++) {
      const dt = i * 1e-3;
      xs.push(dt * 1000);
      yPos.push(dt > 0 ? Vp * Math.exp(-dt / tau_pre) : null);
      yNeg.push(dt < 0 ? Vd * Math.exp(dt / tau_post) : null);
    }
    Plotly.newPlot(id, [
      { x: xs, y: yPos, mode: 'lines', line: { color: theme.OUT, width: 1.6 },
        fill: 'tozeroy', fillcolor: hexToA(theme.OUT, 0.12) },
      { x: xs, y: yNeg, mode: 'lines', line: { color: theme.T, width: 1.6 },
        fill: 'tozeroy', fillcolor: hexToA(theme.T, 0.12) },
    ], darkLayout(theme, {
      yaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'Δw (a.u.)', font: { size: 9, color: theme.textMute } },
               zeroline: true, zerolinecolor: theme.borderStrong, zerolinewidth: 1 },
      xaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'Δt = t_post − t_pre  (ms)', font: { size: 9, color: theme.textMute } },
               zeroline: true, zerolinecolor: theme.borderStrong, zerolinewidth: 1 },
    }), PLOT_CONFIG);
  }, [theme, snn]);
  return <div id={id} style={{ width: '100%', height: '100%' }} />;
};

// Live IV hysteresis loop using current x as initial state
const IVPlot = ({ snn, tick, theme }) => {
  const id = 'plot-iv';
  React.useEffect(() => { Plotly.newPlot(id, [], darkLayout(theme), PLOT_CONFIG); }, []);
  React.useEffect(() => {
    if (!snn) return;
    const x0 = snn.syn.x[0];
    const Ron = snn.syn.Ron, Roff = snn.syn.Roff, p = snn.syn.p, coef = snn.syn.coef;
    const f = 1.0; const Vpk = 1.5;
    const dt = 1e-4; const N = 1000;
    let x = x0;
    const Vs = [], Is = [];
    for (let i = 0; i < N; i++) {
      const t = i * dt * 10;
      const V = Vpk * Math.sin(2 * Math.PI * f * t);
      const R = Ron * x + Roff * (1 - x);
      const cur = V / R;
      Vs.push(V); Is.push(cur * 1e3);
      const win = 1 - Math.pow(2 * x - 1, 2 * p);
      x = clampLocal(x + coef * cur * win * dt * 10, 1e-4, 1 - 1e-4);
    }
    Plotly.react(id, [
      { x: Vs, y: Is, mode: 'lines',
        line: { color: theme.accent, width: 1.4 }, opacity: 0.85 },
    ], darkLayout(theme, {
      yaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'I · mA', font: { size: 9, color: theme.textMute } },
               zeroline: true, zerolinecolor: theme.borderStrong },
      xaxis: { color: theme.textMute, gridcolor: theme.grid,
               title: { text: 'V', font: { size: 9, color: theme.textMute } },
               zeroline: true, zerolinecolor: theme.borderStrong },
    }), PLOT_CONFIG);
  }, [tick, theme]);
  return <div id={id} style={{ width: '100%', height: '100%' }} />;
};

window.RasterPlot = RasterPlot;
window.RatePlot = RatePlot;
window.WeightPlot = WeightPlot;
window.MeanWPlot = MeanWPlot;
window.RPlot = RPlot;
window.PerOutputRatePlot = PerOutputRatePlot;
window.StdpWindowPlot = StdpWindowPlot;
window.IVPlot = IVPlot;
window.hexToA = hexToA;
