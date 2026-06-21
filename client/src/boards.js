// Expansion board system — graph-based pipe routing.
// Boards have pre-drawn tracks (edges) between nodes.
// Junction nodes (type:'junc') get connector items from inventory.
// The connector's shape/rotation determines which directions power flows through it.
// Effect magnitude = sum of connector % values on BFS path from source to that effect.

// ── Side bitmasks ─────────────────────────────────────────────────────────────
export const DIR = { T: 1, R: 2, B: 4, L: 8 };

// ── Connector shapes ──────────────────────────────────────────────────────────
export const CONNECTOR_SHAPES = {
  end:      { mask: DIR.T,                          maxRot: 4, label: 'Заглушка' },
  straight: { mask: DIR.T | DIR.B,                 maxRot: 2, label: 'Прямой'   },
  corner:   { mask: DIR.T | DIR.R,                 maxRot: 4, label: 'Угол'     },
  tee:      { mask: DIR.T | DIR.R | DIR.B,         maxRot: 4, label: 'Тройник'  },
  cross:    { mask: DIR.T | DIR.R | DIR.B | DIR.L, maxRot: 1, label: 'Крест'    },
};

// ── Stats ─────────────────────────────────────────────────────────────────────
export const STAT_META = {
  cannonDmg:   { label: 'Урон пушки',        color: '#ff9944' },
  laserDmg:    { label: 'Урон лазера',        color: '#44aaff' },
  piercing:    { label: 'Пробивание',          color: '#ffcc44' },
  piercingRes: { label: 'Сопр. пробиванию',   color: '#88ff88' },
  shieldMax:   { label: 'Макс. щит',          color: '#66aaff' },
  hullMax:     { label: 'Макс. корпус',        color: '#66ffcc' },
  speed:       { label: 'Скорость',            color: '#ffff66' },
  cooldown:    { label: 'Откат навыков',       color: '#cc66ff' },
};
const ALL_STATS = Object.keys(STAT_META);

// ── Mask helpers ──────────────────────────────────────────────────────────────
export function rotateMask(mask, n = 1) {
  let m = mask; n = ((n % 4) + 4) % 4;
  for (let i = 0; i < n; i++) m = ((m << 1) | (m >> 3)) & 0xF;
  return m;
}

export function effectiveMask(conn) {
  if (!conn) return 0;
  return rotateMask(CONNECTOR_SHAPES[conn.shape]?.mask ?? 0, conn.rotation ?? 0);
}

// For an edge {a, b} return which DIR side each endpoint uses.
export function edgeSides(na, nb) {
  const dc = nb.col - na.col, dr = nb.row - na.row;
  if (dr === 0 && dc !== 0) return { sideA: dc > 0 ? DIR.R : DIR.L, sideB: dc > 0 ? DIR.L : DIR.R };
  if (dc === 0 && dr !== 0) return { sideA: dr > 0 ? DIR.B : DIR.T, sideB: dr > 0 ? DIR.T : DIR.B };
  return { sideA: 0, sideB: 0 };
}

// Open-sides bitmask for a board node.
// src = always 0xF.
// deb = always 0xF (auto-activates when powered; player cannot block it by leaving it empty).
// buf = needs element placed to both activate AND relay power to further nodes.
// junc = needs element placed to relay power.
export function nodeMask(board, allConns, nodeId) {
  const node = (board.nodes || []).find(n => n.id === nodeId);
  if (!node) return 0;
  if (node.type === 'src' || node.type === 'deb') return 0xF;
  const cid = board.placements?.[nodeId];
  if (!cid) return 0;
  const conn = allConns[cid];
  return conn ? effectiveMask(conn) : 0;
}

// ── BFS ───────────────────────────────────────────────────────────────────────
// Returns { powered: Set<nodeId>, parent: Map<nodeId, nodeId|null> }
export function bfsPowered(board, allConns) {
  const powered = new Set(), parent = new Map(), q = [];
  const nm = Object.fromEntries((board.nodes || []).map(n => [n.id, n]));

  for (const n of (board.nodes || [])) {
    if (n.type !== 'src') continue;
    powered.add(n.id); parent.set(n.id, null); q.push(n.id);
  }

  while (q.length) {
    const nid = q.shift();
    const m   = nodeMask(board, allConns, nid);
    const nd  = nm[nid];

    for (const e of (board.edges || [])) {
      let oid, sme, sot;
      if (e.a === nid) {
        oid = e.b;
        const { sideA, sideB } = edgeSides(nd, nm[e.b]);
        sme = sideA; sot = sideB;
      } else if (e.b === nid) {
        oid = e.a;
        const { sideA, sideB } = edgeSides(nm[e.a], nd);
        sme = sideB; sot = sideA;
      } else continue;

      if (powered.has(oid)) continue;
      if (!(m & sme)) continue;
      if (!(nodeMask(board, allConns, oid) & sot)) continue;
      powered.add(oid); parent.set(oid, nid); q.push(oid);
    }
  }
  return { powered, parent };
}

// ── Effects ───────────────────────────────────────────────────────────────────
// Returns { stat: pctDelta } — positive for buf, negative for deb.
export function getBoardEffects(board, allConns = {}) {
  if (!board) return {};
  const { powered, parent } = bfsPowered(board, allConns);
  const effects = {};

  for (const n of (board.nodes || [])) {
    if (n.type !== 'buf' && n.type !== 'deb') continue;
    if (!powered.has(n.id)) continue;
    // Sum connector values along the BFS path from source to this node.
    let sum = 0, nid = n.id;
    while (nid != null) {
      const cid = board.placements?.[nid];
      if (cid && allConns[cid]) sum += allConns[cid].value || 0;
      nid = parent.get(nid);
    }
    if (!sum) continue;
    const delta = n.type === 'buf' ? sum : -sum;
    effects[n.stat] = (effects[n.stat] || 0) + delta;
  }
  return effects;
}

// ── Board templates ───────────────────────────────────────────────────────────
// nodes: { id, col, row, type: 'src'|'buf'|'deb'|'junc', stat? }
//   stat: null = assigned randomly at rollBoard()
// edges: { a: nodeId, b: nodeId }  — pre-drawn tracks
// maxConn: how many connector items can be placed on this board.
//
// Design rule: at least one junction node has BOTH a buf branch and a deb branch
// reachable from it. The correct connector shape/rotation avoids powering the deb.
// Debuffs live at dead ends (leaves) so they're never required to route through.

const BOARD_TEMPLATES = [
  // ── T1 ──────────────────────────────────────────────────────────────────────
  // "Омега": j1 forks 3 ways. Down branch passes through deb to an extra buf.
  // Safe:  TEE(L+T+R) at j1 → b0,b1,b2 with no deb.
  // Risky: CROSS at j1 → also j1→d0→b3 (+1 buf, deb activates).
  {
    tier: 1, name: 'Омега', maxConn: 4,
    nodes: [
      { id:'src', col:0, row:1, type:'src'  },
      { id:'j1',  col:1, row:1, type:'junc' },
      { id:'b0',  col:1, row:0, type:'buf',  stat: null },
      { id:'b1',  col:2, row:1, type:'buf',  stat: null },
      { id:'b2',  col:3, row:1, type:'buf',  stat: null },
      { id:'d0',  col:1, row:2, type:'deb',  stat: null },
      { id:'b3',  col:2, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j1' },
      { a:'j1',  b:'b0' },
      { a:'j1',  b:'b1' },
      { a:'b1',  b:'b2' },
      { a:'j1',  b:'d0' },   // deb passthrough: wrong rotation → deb activates but b3 gained
      { a:'d0',  b:'b3' },
    ],
  },

  // "Сигма": j1 forks 3 ways. Down branch: deb passthrough to extra buf.
  // Safe:  TEE(L+T+R) at j1, any R-open connector at j2 → b0,b1,b2, no deb.
  // Risky: CROSS at j1 → also d0→b3 (+1 buf, deb activates).
  {
    tier: 1, name: 'Сигма', maxConn: 4,
    nodes: [
      { id:'src', col:0, row:1, type:'src'  },
      { id:'j1',  col:1, row:1, type:'junc' },
      { id:'j2',  col:2, row:1, type:'junc' },
      { id:'b0',  col:1, row:0, type:'buf',  stat: null },
      { id:'b1',  col:3, row:1, type:'buf',  stat: null },
      { id:'b2',  col:3, row:0, type:'buf',  stat: null },
      { id:'d0',  col:1, row:2, type:'deb',  stat: null },
      { id:'b3',  col:2, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j1' },
      { a:'j1',  b:'b0' },
      { a:'j1',  b:'j2' },
      { a:'j2',  b:'b1' },
      { a:'b1',  b:'b2' },
      { a:'j1',  b:'d0' },   // deb passthrough
      { a:'d0',  b:'b3' },
    ],
  },

  // ── T2 ──────────────────────────────────────────────────────────────────────
  // "Пульсар": two sources, vertical spine j1-j2-j3, lateral bufs.
  // j4 hub: safe path to b3 (STRAIGHT L+R). Risky: T side → d0→b4 OR B side → d1→b5.
  // Debs are on parallel paths to extra bufs — player chooses which to activate.
  {
    tier: 2, name: 'Пульсар', maxConn: 6,
    nodes: [
      { id:'src1', col:0, row:0, type:'src'  },
      { id:'src2', col:0, row:2, type:'src'  },
      { id:'j1',   col:1, row:0, type:'junc' },
      { id:'j2',   col:1, row:1, type:'junc' },
      { id:'j3',   col:1, row:2, type:'junc' },
      { id:'b0',   col:2, row:0, type:'buf',  stat: null },
      { id:'b1',   col:2, row:1, type:'buf',  stat: null },
      { id:'b2',   col:2, row:2, type:'buf',  stat: null },
      { id:'j4',   col:3, row:1, type:'junc' },
      { id:'b3',   col:4, row:1, type:'buf',  stat: null },
      { id:'d0',   col:3, row:0, type:'deb',  stat: null },
      { id:'d1',   col:3, row:2, type:'deb',  stat: null },
      { id:'b4',   col:4, row:0, type:'buf',  stat: null },
      { id:'b5',   col:4, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src1', b:'j1' }, { a:'src2', b:'j3' },
      { a:'j1', b:'j2'  }, { a:'j2', b:'j3'  },
      { a:'j1', b:'b0'  }, { a:'j2', b:'b1'  }, { a:'j3', b:'b2' },
      { a:'b1', b:'j4'  }, { a:'j4', b:'b3'  },
      { a:'j4', b:'d0'  }, { a:'d0', b:'b4'  },   // risky up: deb→extra buf
      { a:'j4', b:'d1'  }, { a:'d1', b:'b5'  },   // risky down: deb→extra buf
    ],
  },

  // "Нова": hub j1. Debs are ON the path to upper/lower junctions and their bufs.
  // Safe:  STRAIGHT(L+R) at j1 → b0→b2 only.
  // Risky: open T → d0→j2→b1 (+1 buf, d0 deb). Open B → d1→j3→b3 (+1 buf, d1 deb).
  {
    tier: 2, name: 'Нова', maxConn: 5,
    nodes: [
      { id:'src', col:0, row:1, type:'src'  },
      { id:'j1',  col:1, row:1, type:'junc' },
      { id:'d0',  col:1, row:0, type:'deb',  stat: null },
      { id:'d1',  col:1, row:2, type:'deb',  stat: null },
      { id:'b0',  col:2, row:1, type:'buf',  stat: null },
      { id:'j2',  col:2, row:0, type:'junc' },
      { id:'j3',  col:2, row:2, type:'junc' },
      { id:'b1',  col:3, row:0, type:'buf',  stat: null },
      { id:'b2',  col:3, row:1, type:'buf',  stat: null },
      { id:'b3',  col:3, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j1' },
      { a:'j1',  b:'d0' }, { a:'d0', b:'j2' },   // deb is on path to j2→b1
      { a:'j1',  b:'d1' }, { a:'d1', b:'j3' },   // deb is on path to j3→b3
      { a:'j1',  b:'b0' }, { a:'b0', b:'b2' },
      { a:'j2',  b:'b1' }, { a:'j3', b:'b3' },
    ],
  },

  // ── T3 ──────────────────────────────────────────────────────────────────────
  // "Нексус": two sources, vertical spine, secondary stage.
  // Debs are passthroughs: j5→d0→b5 and j6→d1→b6, j6→d2→b7.
  // Right connector at j5/j6 routes to safe bufs. Wrong → deb activates, extra buf gained.
  {
    tier: 3, name: 'Нексус', maxConn: 9,
    nodes: [
      { id:'src1', col:0, row:0, type:'src'  },
      { id:'src2', col:0, row:3, type:'src'  },
      { id:'j1',   col:1, row:0, type:'junc' },
      { id:'j2',   col:1, row:1, type:'junc' },
      { id:'j3',   col:1, row:2, type:'junc' },
      { id:'j4',   col:1, row:3, type:'junc' },
      { id:'b0',   col:2, row:0, type:'buf',  stat: null },
      { id:'b1',   col:2, row:1, type:'buf',  stat: null },
      { id:'b2',   col:2, row:2, type:'buf',  stat: null },
      { id:'b3',   col:2, row:3, type:'buf',  stat: null },
      { id:'j5',   col:3, row:1, type:'junc' },
      { id:'j6',   col:3, row:2, type:'junc' },
      { id:'b4',   col:4, row:1, type:'buf',  stat: null },
      { id:'d0',   col:3, row:0, type:'deb',  stat: null },
      { id:'d1',   col:4, row:2, type:'deb',  stat: null },
      { id:'d2',   col:3, row:3, type:'deb',  stat: null },
      { id:'b5',   col:4, row:0, type:'buf',  stat: null },
      { id:'b6',   col:5, row:2, type:'buf',  stat: null },
      { id:'b7',   col:4, row:3, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src1', b:'j1' }, { a:'src2', b:'j4' },
      { a:'j1', b:'j2'  }, { a:'j2', b:'j3'   }, { a:'j3', b:'j4' },
      { a:'j1', b:'b0'  }, { a:'j2', b:'b1'   }, { a:'j3', b:'b2' }, { a:'j4', b:'b3' },
      { a:'b1', b:'j5'  }, { a:'b2', b:'j6'   },
      { a:'j5', b:'b4'  }, { a:'j5', b:'d0'   }, { a:'d0', b:'b5' },
      { a:'j6', b:'d1'  }, { a:'d1', b:'b6'   },
      { a:'j6', b:'d2'  }, { a:'d2', b:'b7'   },
    ],
  },

  // "Матриця": single source, 3×2 junc grid. Debs sit between junctions and their bufs.
  // Safe middle: j5→b1. Risky upper: j4→d0→b0→b3. Risky lower: j6→d1→b2→b4.
  // Further risky: b1→d2→b5.
  {
    tier: 3, name: 'Матриця', maxConn: 9,
    nodes: [
      { id:'src',  col:0, row:1, type:'src'  },
      { id:'j1',   col:1, row:0, type:'junc' },
      { id:'j2',   col:1, row:1, type:'junc' },
      { id:'j3',   col:1, row:2, type:'junc' },
      { id:'j4',   col:2, row:0, type:'junc' },
      { id:'j5',   col:2, row:1, type:'junc' },
      { id:'j6',   col:2, row:2, type:'junc' },
      { id:'b1',   col:3, row:1, type:'buf',  stat: null },
      { id:'d0',   col:3, row:0, type:'deb',  stat: null },
      { id:'d1',   col:3, row:2, type:'deb',  stat: null },
      { id:'b0',   col:4, row:0, type:'buf',  stat: null },
      { id:'b2',   col:4, row:2, type:'buf',  stat: null },
      { id:'d2',   col:4, row:1, type:'deb',  stat: null },
      { id:'b3',   col:5, row:0, type:'buf',  stat: null },
      { id:'b4',   col:5, row:2, type:'buf',  stat: null },
      { id:'b5',   col:5, row:1, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j2' },
      { a:'j2',  b:'j1' }, { a:'j2', b:'j3'  },
      { a:'j1',  b:'j4' }, { a:'j2', b:'j5'  }, { a:'j3', b:'j6' },
      { a:'j4',  b:'j5' }, { a:'j5', b:'j6'  },
      { a:'j4',  b:'d0' }, { a:'d0', b:'b0'  }, { a:'b0', b:'b3' },
      { a:'j5',  b:'b1' }, { a:'b1', b:'d2'  }, { a:'d2', b:'b5' },
      { a:'j6',  b:'d1' }, { a:'d1', b:'b2'  }, { a:'b2', b:'b4' },
    ],
  },
];

// ── Roll helpers ──────────────────────────────────────────────────────────────
export function rollBoard(tier) {
  const tpls = BOARD_TEMPLATES.filter(t => t.tier === tier);
  const tpl  = tpls[Math.floor(Math.random() * tpls.length)];

  const shuffled = [...ALL_STATS].sort(() => Math.random() - 0.5);
  let si = 0;
  const nodes = (tpl.nodes || []).map(n => {
    if ((n.type === 'buf' || n.type === 'deb') && n.stat === null)
      return { ...n, stat: shuffled[si++ % shuffled.length] };
    return { ...n };
  });

  return {
    id:        `b${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,
    tier,
    name:      tpl.name,
    maxConn:   tpl.maxConn,
    nodes,
    edges:     tpl.edges.map(e => ({ ...e })),
    placements: {},   // nodeId → connectorId
  };
}

export function rollConnector(tier) {
  const byTier = [
    ['end', 'straight', 'corner'],
    ['end', 'straight', 'corner', 'tee'],
    ['straight', 'corner', 'tee', 'cross'],
  ];
  const avail = byTier[Math.min(tier, 3) - 1];
  const shape = avail[Math.floor(Math.random() * avail.length)];
  const [lo, hi] = tier === 1 ? [1, 3] : tier === 2 ? [2, 5] : [4, 7];
  const value = Math.floor(Math.random() * (hi - lo + 1)) + lo;
  return {
    id:       `c${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,
    type:     'connector',
    tier,
    shape,
    rotation: 0,
    value,
  };
}

export function placedCount(board) {
  return Object.keys(board.placements || {}).length;
}

// Powered node ids (BFS with no connectors placed — all junc nodes block until equipped).
export function getPoweredNodes(board, allConns = {}) {
  return bfsPowered(board, allConns).powered;
}

export function boardTierLabel(tier) {
  return `ПЛАТА  ТИР ${tier}`;
}

export function boardPreviewStats(board) {
  if (!board?.nodes) return '—';
  const parts = [];
  for (const n of board.nodes) {
    if (!n.stat) continue;
    const meta = STAT_META[n.stat];
    if (!meta) continue;
    parts.push(`${meta.label} ${n.type === 'buf' ? '+' : '−'}`);
  }
  return parts.join(' · ') || '—';
}

export function connectorLabel(conn) {
  if (!conn) return '';
  const s = CONNECTOR_SHAPES[conn.shape];
  return `${s?.label ?? conn.shape} +${conn.value}%`;
}
