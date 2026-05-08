// Network visualization — 64-output port.
// Top: 2 input neurons. Middle: 2x64 memristor crossbar (rows = inputs, cols = outputs).
// Bottom: column of 64 LIF somas, flashing on spike. STDP halo on synapses.

const SPIKE_FLASH_MS = 220;
const STDP_FLASH_MS  = 380;

function flashFactor(ageMs, win) {
  if (ageMs >= win) return 0;
  return 1 - ageMs / win;
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}
window.hexToRgb = hexToRgb;
function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function formatOhms(r) {
  if (r >= 1e6) return (r / 1e6).toFixed(2) + ' MΩ';
  if (r >= 1e3) return (r / 1e3).toFixed(2) + ' kΩ';
  return r.toFixed(0) + ' Ω';
}

// ─── 64-output network: input row + 2x64 syn crossbar + output column ─────
const NetworkViz = ({ snn, tick, theme, pulseStyle = 'dot' }) => {
  if (!snn) return null;
  const N = snn.N_OUT || 64;
  const W = 880, H = 460;

  const now = snn.time;
  const ageA = (now - snn.lastSpikeA) * 1000;
  const ageB = (now - snn.lastSpikeB) * 1000;
  const flashA = flashFactor(ageA, SPIKE_FLASH_MS);
  const flashB = flashFactor(ageB, SPIKE_FLASH_MS);

  // Layout: inputs on left, crossbar center, outputs on right.
  const padL = 50, padR = 40, padT = 50, padB = 50;
  const inputX = padL + 10;
  const colsX0 = padL + 90;
  const colsX1 = W - padR - 110;
  const colW = (colsX1 - colsX0) / N;
  const rowAY = padT + 60;
  const rowBY = padT + 110;
  const outX = W - padR - 50;
  const outsY0 = padT + 30;
  const outsY1 = H - padB - 10;
  const outRowH = (outsY1 - outsY0) / N;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      <text x={padL} y={20} fill={theme.textMute} fontSize="10"
            fontFamily="JetBrains Mono, monospace" letterSpacing="0.18em">
        INPUTS · 2 PRE
      </text>
      <text x={(colsX0 + colsX1) / 2 - 90} y={20} fill={theme.textMute} fontSize="10"
            fontFamily="JetBrains Mono, monospace" letterSpacing="0.18em">
        2 × {N} BIOLEK MEMRISTOR CROSSBAR
      </text>
      <text x={W - padR - 110} y={20} fill={theme.textMute} fontSize="10"
            fontFamily="JetBrains Mono, monospace" letterSpacing="0.18em">
        64 LIF · POP READOUT
      </text>

      {/* Input row labels & somas */}
      <g>
        <Soma cx={inputX} cy={rowAY} r={14}
              label="A" color={theme.A} theme={theme} lastSpikeAgoMs={ageA} />
        <Soma cx={inputX} cy={rowBY} r={14}
              label="B" color={theme.B} theme={theme} lastSpikeAgoMs={ageB} />
        <text x={inputX + 22} y={rowAY - 18} fill={theme.textDim} fontSize="9"
              fontFamily="JetBrains Mono, monospace">
          {snn.rate_A.toFixed(0)} Hz
        </text>
        <text x={inputX + 22} y={rowBY - 18} fill={theme.textDim} fontSize="9"
              fontFamily="JetBrains Mono, monospace">
          {snn.rate_B.toFixed(0)} Hz
        </text>
      </g>

      {/* Input rails along the crossbar */}
      <line x1={inputX + 14} y1={rowAY} x2={colsX1 + 4} y2={rowAY}
            stroke={theme.A} strokeWidth={1 + flashA * 0.8}
            opacity={0.25 + flashA * 0.55} />
      <line x1={inputX + 14} y1={rowBY} x2={colsX1 + 4} y2={rowBY}
            stroke={theme.B} strokeWidth={1 + flashB * 0.8}
            opacity={0.25 + flashB * 0.55} />

      {/* Per-output column: vertical wire down to output soma */}
      {Array.from({ length: N }).map((_, j) => {
        const cx = colsX0 + colW * (j + 0.5);
        const ageOut = (now - snn.lastSpikeOut[j]) * 1000;
        const flashO = flashFactor(ageOut, SPIKE_FLASH_MS);
        const xA = snn.syn.x[j];
        const xB = snn.syn.x[N + j];
        // STDP halos
        const updA = (now - snn.syn.lastUpdateT[j]) * 1000;
        const updB = (now - snn.syn.lastUpdateT[N + j]) * 1000;
        const haloA = flashFactor(updA, STDP_FLASH_MS);
        const haloB = flashFactor(updB, STDP_FLASH_MS);
        const signA = snn.syn.lastUpdateSign[j];
        const signB = snn.syn.lastUpdateSign[N + j];
        const haloColA = signA > 0 ? theme.OUT : signA < 0 ? theme.T : theme.textMute;
        const haloColB = signB > 0 ? theme.OUT : signB < 0 ? theme.T : theme.textMute;

        const oy = outsY0 + outRowH * (j + 0.5);
        return (
          <g key={'col' + j}>
            {/* Vertical column wire */}
            <line x1={cx} y1={rowAY} x2={cx} y2={rowBY + 28}
                  stroke={theme.textMute}
                  strokeWidth={0.5 + Math.max(flashA, flashB) * 0.8}
                  opacity={0.22 + Math.max(flashA, flashB) * 0.4} />
            {/* Mem A cell */}
            <CrossCell cx={cx} cy={rowAY} w={colW * 0.7} h={14}
                       weight={xA} color={theme.A} theme={theme}
                       halo={haloA} haloColor={haloColA} />
            {/* Mem B cell */}
            <CrossCell cx={cx} cy={rowBY} w={colW * 0.7} h={14}
                       weight={xB} color={theme.B} theme={theme}
                       halo={haloB} haloColor={haloColB} />
            {/* Wire down to output soma */}
            <line x1={cx} y1={rowBY + 14} x2={cx} y2={oy}
                  stroke={theme.OUT}
                  strokeWidth={0.5 + flashO * 1.0}
                  opacity={0.10 + flashO * 0.6} />
            <line x1={cx} y1={oy} x2={outX - 10} y2={oy}
                  stroke={theme.OUT}
                  strokeWidth={0.5 + flashO * 1.0}
                  opacity={0.10 + flashO * 0.6} />
            {/* Out soma — small */}
            <circle cx={outX} cy={oy} r={3}
                    fill={theme.OUT}
                    opacity={0.25 + flashO * 0.7} />
            {flashO > 0.4 && (
              <circle cx={outX} cy={oy} r={5}
                      fill="none" stroke={theme.OUT}
                      strokeWidth={0.8} opacity={flashO * 0.6} />
            )}
            {pulseStyle === 'dot' && flashO > 0.3 && (
              <circle cx={(cx + outX) / 2} cy={oy} r={1.8}
                      fill={theme.OUT} opacity={flashO} />
            )}
          </g>
        );
      })}

      {/* Population output bracket label */}
      <line x1={outX + 10} y1={outsY0} x2={outX + 10} y2={outsY1}
            stroke={theme.textMute} strokeWidth={0.5} opacity={0.4} />
      <text x={outX + 16} y={(outsY0 + outsY1) / 2} fill={theme.textDim}
            fontSize="10" fontFamily="JetBrains Mono, monospace"
            transform={`rotate(90 ${outX + 16},${(outsY0 + outsY1) / 2})`}
            textAnchor="middle">
        POP MEAN → A + B
      </text>
    </svg>
  );
};

// Crossbar cell — small memristor symbol w/ weight fill + STDP halo.
const CrossCell = ({ cx, cy, w, h, weight, color, theme, halo, haloColor }) => {
  const x = cx - w / 2, y = cy - h / 2;
  const fillW = w * Math.max(0, Math.min(1, weight));
  return (
    <g>
      {halo > 0 && (
        <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4}
              fill="none" stroke={haloColor}
              strokeWidth={1} opacity={0.6 * halo} />
      )}
      <rect x={x} y={y} width={w} height={h}
            fill={theme.bg} stroke={color}
            strokeWidth={0.7} opacity={0.85} />
      <rect x={x + 0.8} y={y + 0.8} width={Math.max(0, fillW - 1.6)} height={h - 1.6}
            fill={color} opacity={0.30} />
      <line x1={x + w * 0.18} y1={y + h * 0.78}
            x2={x + w * 0.82} y2={y + h * 0.22}
            stroke={color} strokeWidth={0.7} opacity={0.9} />
    </g>
  );
};

// Soma — opacity pulse
const Soma = ({ cx, cy, r, label, color, theme, lastSpikeAgoMs }) => {
  const f = flashFactor(lastSpikeAgoMs, SPIKE_FLASH_MS);
  const fillOp = 0.18 + f * 0.7;
  const strokeOp = 0.5 + f * 0.5;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} opacity={fillOp} />
      <circle cx={cx} cy={cy} r={r} fill="none"
              stroke={color} strokeWidth={1.3} opacity={strokeOp} />
      {label && (
        <text x={cx} y={cy + 4}
              fill={theme.bg} fontSize="11" textAnchor="middle"
              fontFamily="JetBrains Mono, monospace" fontWeight="700">
          {label}
        </text>
      )}
    </g>
  );
};

// ─── Decorative crossbar — wider, no live binding to syn[0/1]. ────────────
const CrossbarFlourish = ({ snn, tick, theme }) => {
  const cols = 16, rows = 8;
  const cellW = 22, cellH = 18;
  const padX = 30, padY = 24;
  const W = padX * 2 + cols * cellW;
  const H = padY * 2 + rows * cellH + 10;

  // Pull a few real weights to spread across the decorative grid
  const N = snn ? snn.N_OUT : 64;
  const sample = (r, c) => {
    if (!snn) return 0.5;
    const idx = ((r * cols + c) * 7) % (2 * N);
    return snn.syn.x[idx];
  };

  const liveCol = 7;
  const liveRowA = 2, liveRowB = 5;
  const now = snn ? snn.time : 0;
  const ageA = snn ? (now - snn.lastSpikeA) * 1000 : 1e6;
  const ageB = snn ? (now - snn.lastSpikeB) * 1000 : 1e6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: 'block' }}>
      {Array.from({ length: rows }).map((_, r) => {
        const y = padY + r * cellH + cellH / 2;
        const isLive = r === liveRowA || r === liveRowB;
        return (
          <line key={'rr' + r} x1={padX - 16} y1={y} x2={W - padX + 16} y2={y}
                stroke={isLive ? (r === liveRowA ? theme.A : theme.B) : theme.textMute}
                strokeWidth={isLive ? 1 : 0.5}
                opacity={isLive ? 0.6 : 0.2} />
        );
      })}
      {Array.from({ length: cols }).map((_, c) => {
        const x = padX + c * cellW + cellW / 2;
        const isLive = c === liveCol;
        return (
          <line key={'cr' + c} x1={x} y1={padY - 12} x2={x} y2={H - padY + 12}
                stroke={isLive ? theme.OUT : theme.textMute}
                strokeWidth={isLive ? 1 : 0.5}
                opacity={isLive ? 0.6 : 0.2} />
        );
      })}

      {Array.from({ length: rows }).flatMap((_, r) =>
        Array.from({ length: cols }).map((__, c) => {
          const x = padX + c * cellW + 4;
          const y = padY + r * cellH + 4;
          const cw = cellW - 8, ch = cellH - 8;
          const w = Math.max(0, Math.min(1, sample(r, c)));
          const isLive = c === liveCol && (r === liveRowA || r === liveRowB);
          const liveColor = r === liveRowA ? theme.A : theme.B;
          const liveAge = r === liveRowA ? ageA : ageB;
          const flash = isLive ? flashFactor(liveAge, SPIKE_FLASH_MS) : 0;
          const baseColor = isLive ? liveColor : theme.textMute;
          return (
            <g key={`m${r}-${c}`} opacity={isLive ? 1 : 0.4}>
              <rect x={x} y={y} width={cw} height={ch}
                    fill={theme.bg} stroke={baseColor}
                    strokeWidth={isLive ? 1 : 0.5}
                    opacity={isLive ? 0.6 + flash * 0.4 : 1} />
              <rect x={x + 1} y={y + ch - (ch - 2) * w}
                    width={cw - 2} height={(ch - 2) * w}
                    fill={baseColor} opacity={isLive ? 0.4 : 0.18} />
              <line x1={x + cw * 0.2} y1={y + ch * 0.8}
                    x2={x + cw * 0.8} y2={y + ch * 0.2}
                    stroke={baseColor} strokeWidth={0.7} opacity={0.8} />
            </g>
          );
        })
      )}

      <text x={padX - 18} y={padY - 6} fill={theme.textMute} fontSize="8"
            fontFamily="JetBrains Mono, monospace" letterSpacing="0.18em">
        Sᵢ
      </text>
      <text x={W - padX + 4} y={H - padY + 22} fill={theme.textMute} fontSize="8"
            fontFamily="JetBrains Mono, monospace" letterSpacing="0.18em" textAnchor="end">
        Iⱼ →
      </text>
    </svg>
  );
};

window.NetworkViz = NetworkViz;
window.CrossbarFlourish = CrossbarFlourish;
window.formatOhms = formatOhms;
