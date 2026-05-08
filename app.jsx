// Main React app — 64-output port. Tabs: Overview / Network / Telemetry / STDP.

const { useState, useEffect, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "scope",
  "pulseStyle": "dot",
  "showField": false
}/*EDITMODE-END*/;

function useSimulation() {
  const snnRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(true);
  const [simSpeed, setSimSpeed] = useState(1.0);
  const runningRef = useRef(running);
  const speedRef = useRef(simSpeed);
  runningRef.current = running;
  speedRef.current = simSpeed;

  useEffect(() => {
    snnRef.current = new window.ArithmeticSNN();
    let lastWall = performance.now();
    let raf = 0;
    const MAX_STEPS = 8000;
    const tickFn = (now) => {
      let wallDt = (now - lastWall) / 1000;
      lastWall = now;
      if (wallDt > 0.1) wallDt = 0.1;
      if (runningRef.current) {
        const simTarget = wallDt * speedRef.current;
        const nSteps = Math.min(MAX_STEPS,
          Math.max(0, Math.round(simTarget / snnRef.current.dt)));
        for (let i = 0; i < nSteps; i++) snnRef.current.step();
      }
      raf = requestAnimationFrame(tickFn);
    };
    raf = requestAnimationFrame(tickFn);
    const redraw = setInterval(() => setTick(t => (t + 1) % 1e9), 50);
    return () => { cancelAnimationFrame(raf); clearInterval(redraw); };
  }, []);

  return { snn: snnRef.current, tick, running, setRunning, simSpeed, setSimSpeed };
}

const Slider = ({ label, value, unit, min, max, step, onChange, color, fixed = 0 }) => (
  <div className="slider-block">
    <div className="slider-head">
      <span className="slider-label">{label}</span>
      <span className="slider-val" style={{ color }}>
        {Number(value).toFixed(fixed)}<span className="slider-unit">{unit}</span>
      </span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
           onChange={(e) => onChange(parseFloat(e.target.value))}
           className="slider-input" style={{ '--c': color }} />
  </div>
);

const Toggle = ({ label, value, onChange }) => (
  <label className="toggle-block">
    <div className={`toggle-track ${value ? 'on' : ''}`}>
      <div className="toggle-thumb" />
    </div>
    <span className="toggle-label">{label}</span>
    <input type="checkbox" checked={value}
           onChange={(e) => onChange(e.target.checked)} style={{ display: 'none' }} />
  </label>
);

const Controls = ({ snn, theme, simSpeed, setSimSpeed, running, setRunning }) => {
  const [rateA, setRateA] = useState(4);
  const [rateB, setRateB] = useState(5);
  const [learning, setLearning] = useState(true);
  const [teacher, setTeacher] = useState(true);

  useEffect(() => { if (snn) snn.rate_A = rateA; }, [rateA, snn]);
  useEffect(() => { if (snn) snn.rate_B = rateB; }, [rateB, snn]);
  useEffect(() => { if (snn) snn.learning = learning; }, [learning, snn]);
  useEffect(() => { if (snn) snn.teacher = teacher; }, [teacher, snn]);

  const reset = () => snn && snn.reset();
  const resetAll = () => {
    if (!snn) return;
    snn.reset();
    snn.tHist.length = 0;
    snn.rateHist.length = 0;
    snn.targetHist.length = 0;
    snn.meanWHist.length = 0;
    snn.spikesA.length = 0;
    snn.spikesB.length = 0;
    snn.outSpikes.length = 0;
    snn.recentOutTimes.length = 0;
    snn.time = 0;
  };

  return (
    <div className="controls-panel">
      <div className="ctrl-section-label">INPUTS</div>
      <Slider label="Rate A" value={rateA} unit="Hz" min={0} max={40} step={1}
              onChange={setRateA} color={theme.A} />
      <Slider label="Rate B" value={rateB} unit="Hz" min={0} max={40} step={1}
              onChange={setRateB} color={theme.B} />

      <div className="ctrl-section-label">SIMULATION</div>
      <Slider label="Speed" value={simSpeed} unit="×" min={0.2} max={10} step={0.2}
              onChange={(v) => { setSimSpeed(v); if (snn) snn.sampleEvery = Math.min(200, Math.max(20, Math.round(50 * v))); }}
              color={theme.accent} fixed={1} />
      <div className="ctrl-row">
        <button className="ctrl-btn" onClick={() => setRunning(r => !r)}>
          {running ? '◼ pause' : '▶ run'}
        </button>
        <button className="ctrl-btn ghost" onClick={reset}>reset weights</button>
      </div>
      <div className="ctrl-row">
        <button className="ctrl-btn ghost" onClick={resetAll}>reset all</button>
      </div>

      <div className="ctrl-section-label">LEARNING</div>
      <Toggle label="STDP on" value={learning} onChange={setLearning} />
      <Toggle label="Teacher forcing" value={teacher} onChange={setTeacher} />

      <div className="ctrl-section-label">POPULATION</div>
      <div className="pop-stat">
        <div className="pop-stat-row"><span>N out</span><b>64</b></div>
        <div className="pop-stat-row"><span>Synapses</span><b>128</b></div>
        <div className="pop-stat-row"><span>I_unit</span><b>8 nA</b></div>
      </div>
    </div>
  );
};

const StatusBar = ({ snn, tick, theme, simSpeed, running }) => {
  if (!snn) return null;
  const target = snn.targetRate;
  const tNow = snn.time;
  const actual = snn.populationRate();
  const err = Math.abs(actual - target);
  const conv = target > 0 ? Math.max(0, 1 - err / Math.max(1, target)) : 0;

  return (
    <div className="status-bar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="10" fill="none" stroke={theme.accent} strokeWidth="1" opacity="0.5" />
            <circle cx="11" cy="11" r="3" fill={theme.accent} />
            <line x1="1" y1="11" x2="8" y2="11" stroke={theme.accent} strokeWidth="1" opacity="0.6" />
            <line x1="14" y1="11" x2="21" y2="11" stroke={theme.accent} strokeWidth="1" opacity="0.6" />
            <line x1="11" y1="1" x2="11" y2="8" stroke={theme.accent} strokeWidth="1" opacity="0.6" />
            <line x1="11" y1="14" x2="11" y2="21" stroke={theme.accent} strokeWidth="1" opacity="0.6" />
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-title">MEMRISTIVE SNN · 2 → 64</div>
          <div className="brand-sub">online STDP · A + B summation · pop. readout</div>
        </div>
      </div>
      <div className="status-stats">
        <Stat label="t · sim" value={tNow.toFixed(2) + ' s'} theme={theme} />
        <Stat label="speed"   value={simSpeed.toFixed(1) + '×'} theme={theme} />
        <Stat label="state"   value={running ? '● live' : '◼ paused'} theme={theme}
              color={running ? theme.accent : theme.textMute} />
        <Stat label="target"  value={target.toFixed(1) + ' Hz'} theme={theme} color={theme.textDim} />
        <Stat label="output"  value={actual.toFixed(2) + ' Hz'} theme={theme} color={theme.OUT} />
        <Stat label="conv"    value={(conv * 100).toFixed(0) + '%'} theme={theme}
              color={conv > 0.85 ? theme.accent : conv > 0.5 ? theme.textDim : theme.T} />
      </div>
    </div>
  );
};

const Stat = ({ label, value, theme, color }) => (
  <div className="stat">
    <div className="stat-label">{label}</div>
    <div className="stat-value" style={{ color: color || theme.text }}>{value}</div>
  </div>
);

const TabBar = ({ tabs, active, onPick }) => (
  <div className="tabbar">
    {tabs.map(t => (
      <button key={t.id}
        className={`tab ${active === t.id ? 'active' : ''}`}
        onClick={() => onPick(t.id)}>
        <span className="tab-id">{t.idx}</span>
        <span className="tab-label">{t.label}</span>
      </button>
    ))}
    <div className="tabbar-fill" />
  </div>
);

const Card = ({ title, kicker, children, className = '', style, action }) => (
  <div className={`card ${className}`} style={style}>
    <div className="card-head">
      {kicker && <span className="card-kicker">{kicker}</span>}
      <span className="card-title">{title}</span>
      <div className="card-head-fill" />
      {action}
      <div className="card-corners">
        <span /><span /><span /><span />
      </div>
    </div>
    <div className="card-body">{children}</div>
  </div>
);

const EqCard = ({ title, lines }) => (
  <Card title={title} kicker="MODEL" className="eq-card">
    {lines.map((l, i) => <div key={i} className="eq-line">{l}</div>)}
  </Card>
);

const ReadoutBig = ({ snn, theme }) => {
  if (!snn) return null;
  const target = snn.targetRate;
  const actual = snn.populationRate();
  const err = actual - target;
  return (
    <div className="readout-big">
      <div className="rb-cell">
        <div className="rb-lbl">target  A + B</div>
        <div className="rb-val" style={{ color: theme.textDim }}>
          {target.toFixed(1)}<span className="rb-u">Hz</span>
        </div>
      </div>
      <div className="rb-cell big">
        <div className="rb-lbl">output  population mean</div>
        <div className="rb-val primary" style={{ color: theme.OUT }}>
          {actual.toFixed(2)}<span className="rb-u">Hz</span>
        </div>
      </div>
      <div className="rb-cell">
        <div className="rb-lbl">error</div>
        <div className="rb-val" style={{ color: Math.abs(err) < 0.5 ? theme.accent : theme.T }}>
          {(err >= 0 ? '+' : '') + err.toFixed(2)}<span className="rb-u">Hz</span>
        </div>
      </div>
    </div>
  );
};

const OverviewTab = ({ snn, tick, theme, pulseStyle }) => (
  <div className="grid-overview">
    <Card title="POPULATION READOUT" kicker="A0" className="span-2">
      <ReadoutBig snn={snn} theme={theme} />
    </Card>
    <Card title="LIVE NETWORK · 2 → 64" kicker="A1" className="span-2 row-2">
      <div className="net-live">
        <NetworkViz snn={snn} tick={tick} theme={theme} pulseStyle={pulseStyle} />
      </div>
    </Card>
    <Card title="SPIKE RASTER" kicker="A2" className="span-2">
      <div className="plot-h"><RasterPlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <Card title="WEIGHTS · 2×64" kicker="A3">
      <div className="plot-h"><WeightPlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <Card title="RATE VS TARGET" kicker="A4">
      <div className="plot-h"><RatePlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
  </div>
);

const NetworkTab = ({ snn, tick, theme, pulseStyle }) => (
  <div className="grid-network">
    <Card title="LITERAL TOPOLOGY · 2 inputs → 2×64 syn → 64 LIF" kicker="B1" className="span-2">
      <div className="net-large">
        <NetworkViz snn={snn} tick={tick} theme={theme} pulseStyle={pulseStyle} />
      </div>
    </Card>
    <Card title="DECORATIVE CROSSBAR · M×N" kicker="B2" className="span-2">
      <div className="crossbar-host">
        <CrossbarFlourish snn={snn} tick={tick} theme={theme} />
      </div>
      <div className="crossbar-caption">
        Stylized full crossbar — your live 2 input rows + 64 output columns are sampled across
        the highlighted intersections. Every cell is a Biolek HP memristor.
      </div>
    </Card>
    <EqCard title="LEAKY INTEGRATE-AND-FIRE"
            lines={[
              'τₘ dV/dt = −(V − V_rest) + Rₘ I_syn',
              'if  V ≥ V_thresh  →  spike, V ← V_reset',
              'τₘ = 20 ms · V_thresh = −54 mV · t_ref = 2 ms',
              '64 independent output neurons',
            ]} />
    <EqCard title="BIOLEK HP MEMRISTOR"
            lines={[
              'R(x) = R_on · x + R_off · (1 − x)',
              'dx/dt = (μᵥ R_on / D²) · i(t) · f(x)',
              'f(x) = 1 − (2x − 1)^{2p}      (Joglekar window)',
              '2 inputs × 64 outputs = 128 devices',
            ]} />
  </div>
);

const TelemetryTab = ({ snn, tick, theme }) => (
  <div className="grid-telemetry">
    <Card title="SPIKE RASTER · 2 s window · 64 outputs" kicker="C1" className="span-2">
      <div className="plot-h tall"><RasterPlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <Card title="MEAN WEIGHT x · all time" kicker="C2">
      <div className="plot-h"><MeanWPlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <Card title="WEIGHTS x · 2 × 64 heatmap" kicker="C3">
      <div className="plot-h"><WeightPlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <Card title="RESISTANCE · 2 × 64 heatmap" kicker="C4">
      <div className="plot-h"><RPlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <Card title="PER-OUTPUT FIRING RATE · 2 s" kicker="C5">
      <div className="plot-h"><PerOutputRatePlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <Card title="POP. RATE VS TARGET" kicker="C6" className="span-2">
      <div className="plot-h"><RatePlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
  </div>
);

const StdpTab = ({ snn, tick, theme }) => (
  <div className="grid-stdp">
    <Card title="STDP WINDOW · Δw vs Δt" kicker="D1" className="span-2">
      <div className="plot-h tall"><StdpWindowPlot snn={snn} theme={theme} /></div>
      <div className="card-foot">
        <span><b>Δt &gt; 0</b> (pre before post) → potentiation, V_pot = +2.0 V pulse</span>
        <span><b>Δt &lt; 0</b> (post before pre) → depression, V_dep = −1.5 V pulse</span>
      </div>
    </Card>
    <Card title="I-V HYSTERESIS · live" kicker="D2">
      <div className="plot-h"><IVPlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <Card title="MEAN WEIGHT EVOLUTION" kicker="D3">
      <div className="plot-h"><MeanWPlot snn={snn} tick={tick} theme={theme} /></div>
    </Card>
    <EqCard title="PAIR-BASED STDP"
            lines={[
              'pre spike  : a_pre  ← a_pre + 1  ; V_syn += V_dep · a_post',
              'post spike : a_post ← a_post + 1 ; V_syn += V_pot · a_pre',
              'a_x decays exp.   τ_pre = τ_post = 20 ms',
              'V_pot = +2.0 V · V_dep = −1.5 V',
            ]} />
    <EqCard title="DEVICE PARAMETERS"
            lines={[
              'R_on = 100 Ω · R_off = 16 kΩ',
              'D = 10 nm · μᵥ = 5×10⁻¹³ m²/Vs',
              'p (Joglekar) = 4',
              'R_init = 8 kΩ  →  x₀ ≈ 0.503',
            ]} />
  </div>
);

const TweaksUI = ({ t, setTweak }) => (
  <TweaksPanel>
    <TweakSection label="Theme" />
    <TweakRadio label="Palette" value={t.theme}
                options={[
                  { value: 'scope', label: 'Scope' },
                  { value: 'paper', label: 'Notebook' },
                  { value: 'slate', label: 'Slate' },
                  { value: 'amber', label: 'Term' },
                ]}
                onChange={(v) => setTweak('theme', v)} />
    <TweakSection label="Spike pulse" />
    <TweakRadio label="Style" value={t.pulseStyle}
                options={[
                  { value: 'flash', label: 'Flash' },
                  { value: 'dot',   label: 'Dot' },
                ]}
                onChange={(v) => setTweak('pulseStyle', v)} />
    <TweakSection label="Background" />
    <TweakToggle label="3D dot field" value={!!t.showField}
                 onChange={(v) => setTweak('showField', v)} />
  </TweaksPanel>
);

const App = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const theme = window.getTheme(t.theme);
  const { snn, tick, running, setRunning, simSpeed, setSimSpeed } = useSimulation();
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty('--bg', theme.bg);
    r.style.setProperty('--bg-grad', theme.bgGrad);
    r.style.setProperty('--surface', theme.surface);
    r.style.setProperty('--surface-2', theme.surface2);
    r.style.setProperty('--border', theme.border);
    r.style.setProperty('--border-strong', theme.borderStrong);
    r.style.setProperty('--text', theme.text);
    r.style.setProperty('--text-dim', theme.textDim);
    r.style.setProperty('--text-mute', theme.textMute);
    r.style.setProperty('--accent', theme.accent);
    r.style.setProperty('--accent-soft', theme.accentSoft);
    r.style.setProperty('--ch-a', theme.A);
    r.style.setProperty('--ch-b', theme.B);
    r.style.setProperty('--ch-out', theme.OUT);
    r.style.setProperty('--ch-t', theme.T);
    r.style.setProperty('--grid', theme.grid);
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle('show-field', !!t.showField);
  }, [t.showField]);

  const tabs = [
    { id: 'overview',  idx: '01', label: 'OVERVIEW' },
    { id: 'network',   idx: '02', label: 'NETWORK' },
    { id: 'telemetry', idx: '03', label: 'TELEMETRY' },
    { id: 'stdp',      idx: '04', label: 'STDP & DEVICE' },
  ];

  return (
    <>
      <div className="app-shell">
        <StatusBar snn={snn} tick={tick} theme={theme}
                   simSpeed={simSpeed} running={running} />
        <TabBar tabs={tabs} active={activeTab} onPick={setActiveTab} />
        <div className="workspace">
          <Controls snn={snn} theme={theme}
                    simSpeed={simSpeed} setSimSpeed={setSimSpeed}
                    running={running} setRunning={setRunning} />
          <div className="dashboard"
               data-screen-label={`0${tabs.findIndex(x=>x.id===activeTab)+1} ${tabs.find(x=>x.id===activeTab).label}`}>
            {activeTab === 'overview'  && <OverviewTab  snn={snn} tick={tick} theme={theme} pulseStyle={t.pulseStyle} />}
            {activeTab === 'network'   && <NetworkTab   snn={snn} tick={tick} theme={theme} pulseStyle={t.pulseStyle} />}
            {activeTab === 'telemetry' && <TelemetryTab snn={snn} tick={tick} theme={theme} />}
            {activeTab === 'stdp'      && <StdpTab      snn={snn} tick={tick} theme={theme} />}
          </div>
        </div>
        <Footer />
      </div>
      <TweaksUI t={t} setTweak={setTweak} />
    </>
  );
};

const Footer = () => (
  <div className="footer">
    <span>Biolek HP memristor · Joglekar window · 64 LIF · pair-based STDP · pop. rate readout</span>
    <span className="footer-sep">·</span>
    <span>simulation runs in-browser</span>
    <span className="footer-sep">·</span>
    <span className="footer-meta">v3 · 2 → 64 · 2026</span>
  </div>
);

// Mount is gated: gate.js calls window.startApp() after the passcode is accepted.
window.startApp = () => {
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
};
