/**
 * HTML visualization generator for depth curve simulations.
 *
 * Generates an interactive Plotly.js dashboard with:
 * - Depth chart: price vs cumulative volume (animated by inventory slider)
 * - Risk chart: bid/ask spread (bps) vs inventory %
 */
import fs from "fs";

// ============================================================================
// Types
// ============================================================================

export interface PoolConfig {
  midprice: number;
  decimalsX: number;
  decimalsY: number;
  totalValueUsd: number;
  priceCurves: {
    bid: { points: { volume: number; priceFactor: number }[] };
    ask: { points: { volume: number; priceFactor: number }[] };
  };
  riskCurves: {
    bid: { points: { pctBase: number; priceFactor: number }[] };
    ask: { points: { pctBase: number; priceFactor: number }[] };
  };
}

export interface AnimationFrame {
  pctBase: number;
  bid: { price: number; cumVolume: number }[];
  ask: { price: number; cumVolume: number }[];
}

export interface RiskPoint {
  pctBase: number;
  bidPrice: number | null;
  askPrice: number | null;
}

// ============================================================================
// Default config (matches test 01)
// ============================================================================

export const DEFAULT_CONFIG: PoolConfig = {
  midprice: 150.0,
  decimalsX: 6,
  decimalsY: 6,
  totalValueUsd: 3_000_000,
  priceCurves: {
    bid: {
      points: [
        { volume: 0, priceFactor: 1.0 },
        { volume: 500, priceFactor: 0.995 },
        { volume: 1000, priceFactor: 0.98 },
      ],
    },
    ask: {
      points: [
        { volume: 0, priceFactor: 1.0 },
        { volume: 75000, priceFactor: 1.005 },
        { volume: 150000, priceFactor: 1.02 },
      ],
    },
  },
  riskCurves: {
    bid: {
      points: [
        { pctBase: 0.0, priceFactor: 0.9 },
        { pctBase: 0.25, priceFactor: 0.97 },
        { pctBase: 0.5, priceFactor: 1.0 },
        { pctBase: 1.0, priceFactor: 1.0 },
      ],
    },
    ask: {
      points: [
        { pctBase: 0.0, priceFactor: 1.0 },
        { pctBase: 0.5, priceFactor: 1.0 },
        { pctBase: 0.75, priceFactor: 0.97 },
        { pctBase: 1.0, priceFactor: 0.9 },
      ],
    },
  },
};

// ============================================================================
// HTML generation
// ============================================================================

export function generateDepthHtml(
  frames: AnimationFrame[],
  riskData: RiskPoint[],
  config: PoolConfig,
  outputPath: string
): void {
  const midprice = config.midprice;
  const framesJson = JSON.stringify(frames);

  const riskPctBase = riskData.map((r) => r.pctBase * 100);
  const riskBidBps = riskData.map((r) =>
    r.bidPrice != null ? (r.bidPrice / midprice - 1) * 10000 : null
  );
  const riskAskBps = riskData.map((r) =>
    r.askPrice != null ? (r.askPrice / midprice - 1) * 10000 : null
  );

  const allBps = [...riskBidBps, ...riskAskBps].filter(
    (v): v is number => v != null
  );
  const bpsRange = allBps.length
    ? Math.max(...allBps) - Math.min(...allBps)
    : 100;
  const bpsPad = Math.max(bpsRange * 0.08, 5);
  const riskYMin = allBps.length ? Math.min(...allBps) - bpsPad : -50;
  const riskYMax = allBps.length ? Math.max(...allBps) + bpsPad : 50;

  const defaultIdx = frames.reduce(
    (best, f, i) =>
      Math.abs(f.pctBase - 0.5) < Math.abs(frames[best].pctBase - 0.5)
        ? i
        : best,
    0
  );

  const priceMin = midprice * 0.97;
  const priceMax = midprice * 1.03;
  const maxCum =
    Math.max(
      ...frames.flatMap((f) => [
        ...f.bid.map((p) => p.cumVolume),
        ...f.ask.map((p) => p.cumVolume),
      ])
    ) || 100;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Hadron Depth Curves</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"><\/script>
  <style>
    body { margin: 0; background: #111827; color: #f3f4f6; font-family: "Inter", system-ui, sans-serif; padding: 16px; }
    .controls { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 12px 0; flex-wrap: wrap; }
    .controls label { display: flex; align-items: center; gap: 8px; }
    .controls input[type="range"] { width: 300px; accent-color: #60a5fa; }
    .controls span { min-width: 64px; font-variant-numeric: tabular-nums; }
    #chart { width: 100%; height: 50vh; }
    .divider { border: none; border-top: 1px solid #4b5563; margin: 16px 0; }
    #riskChart { width: 100%; height: 38vh; }
  </style>
</head>
<body>
  <div class="controls">
    <label>
      <span style="font-weight:600">Inventory % base</span>
      <input type="range" id="slider" min="0" max="${frames.length - 1}" value="${defaultIdx}" step="1" />
      <span id="pctLabel" style="font-size:1.1em;font-weight:600">0%</span>
    </label>
  </div>
  <div id="chart"></div>
  <hr class="divider" />
  <div id="riskChart"></div>
  <script>
    const frames = ${framesJson};
    const midprice = ${midprice};
    const priceRange = [${priceMin}, ${priceMax}];
    const maxCum = ${maxCum};
    const riskPctBase = ${JSON.stringify(riskPctBase)};
    const riskBidBps = ${JSON.stringify(riskBidBps)};
    const riskAskBps = ${JSON.stringify(riskAskBps)};
    const riskYMin = ${riskYMin};
    const riskYMax = ${riskYMax};

    function depthLayout(frameIdx) {
      const f = frames[frameIdx];
      return {
        paper_bgcolor: '#111827', plot_bgcolor: '#111827',
        font: { color: '#f3f4f6' },
        title: { text: 'Depth: Price vs Volume (' + (f.pctBase*100).toFixed(1) + '% base)', font: { size: 16 } },
        xaxis: { title: 'Price', tickprefix: '$', range: priceRange, gridcolor: 'rgba(148,163,184,0.15)' },
        yaxis: { title: 'Cumulative Volume (base tokens)', range: [0, maxCum*1.05], gridcolor: 'rgba(148,163,184,0.15)' },
        shapes: [{ type: 'line', x0: midprice, x1: midprice, y0: 0, y1: maxCum*1.05, line: { color: '#4b5563', dash: 'dot', width: 1 } }],
        legend: { x: 0.5, y: 1.02, xanchor: 'center', orientation: 'h' },
        margin: { l: 70, r: 40, t: 50, b: 60 }
      };
    }

    function riskLayout(invPct) {
      return {
        paper_bgcolor: '#111827', plot_bgcolor: '#111827',
        font: { color: '#f3f4f6' },
        title: { text: 'Risk: Bid / Ask Spread (bps vs mid)', font: { size: 14 } },
        xaxis: { title: 'Inventory % base', ticksuffix: '%', range: [-2, 102], gridcolor: 'rgba(148,163,184,0.15)' },
        yaxis: { title: 'bps', ticksuffix: ' bps', range: [riskYMin, riskYMax], zeroline: true, zerolinecolor: 'rgba(148,163,184,0.3)', gridcolor: 'rgba(148,163,184,0.15)' },
        legend: { x: 0.5, y: 1.02, xanchor: 'center', orientation: 'h' },
        margin: { l: 60, r: 40, t: 45, b: 50 },
        shapes: [
          { type: 'line', x0: 50, x1: 50, y0: riskYMin, y1: riskYMax, line: { color: '#4b5563', dash: 'dot', width: 1 } },
          { type: 'line', x0: invPct, x1: invPct, y0: riskYMin, y1: riskYMax, line: { color: '#60a5fa', width: 2 } }
        ],
        annotations: [
          { x: invPct, y: riskYMin+(riskYMax-riskYMin)*0.12, text: invPct.toFixed(1)+'%', showarrow: false, font: { color: '#60a5fa', size: 11 } }
        ]
      };
    }

    const riskTraces = [
      { x: riskPctBase, y: riskBidBps, mode: 'lines', name: 'Bid', line: { color: '#22c55e', width: 2 } },
      { x: riskPctBase, y: riskAskBps, mode: 'lines', name: 'Ask', line: { color: '#f97316', width: 2 } }
    ];

    function update(idx) {
      const f = frames[idx];
      const depthTraces = [
        { x: f.bid.map(p=>p.price), y: f.bid.map(p=>p.cumVolume), mode: 'lines', name: 'Bid', line: { color: '#22c55e', width: 3 }, fill: 'tozerox', fillcolor: '#22c55e22' },
        { x: f.ask.map(p=>p.price), y: f.ask.map(p=>p.cumVolume), mode: 'lines', name: 'Ask', line: { color: '#f97316', width: 3 }, fill: 'tozerox', fillcolor: '#f9731622' }
      ];
      Plotly.react('chart', depthTraces, depthLayout(idx), { responsive: true, displayModeBar: false });
      Plotly.react('riskChart', riskTraces, riskLayout(f.pctBase*100), { responsive: true, displayModeBar: false });
    }

    const slider = document.getElementById('slider');
    const pctLabel = document.getElementById('pctLabel');
    function setIdx(i) {
      i = Math.max(0, Math.min(frames.length-1, i));
      slider.value = i;
      pctLabel.textContent = (frames[i].pctBase*100).toFixed(1)+'%';
      update(i);
    }
    slider.addEventListener('input', function() { setIdx(parseInt(this.value,10)); });
    setIdx(${defaultIdx});
  <\/script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, { encoding: "utf8" });
}
