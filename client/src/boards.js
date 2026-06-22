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
  // Combat
  cannonDmg:       { label: 'Урон пушки',        color: '#ff9944' },
  laserDmg:        { label: 'Урон лазера',        color: '#44aaff' },
  piercing:        { label: 'Пробивание',          color: '#ffcc44' },
  piercingRes:     { label: 'Сопр. пробиванию',   color: '#88ff88' },
  shieldMax:       { label: 'Макс. щит',          color: '#66aaff' },
  hullMax:         { label: 'Макс. корпус',        color: '#66ffcc' },
  speed:           { label: 'Скорость',            color: '#ffff66' },
  cooldown:        { label: 'Откат навыков',       color: '#cc66ff' },
  critChance:      { label: 'Шанс крита',          color: '#ffdd00' },
  critMult:        { label: 'Урон крита',          color: '#ff8800' },
  evasion:         { label: 'Уклонение',           color: '#aaffcc' },
  shieldRegen:     { label: 'Реген щита',          color: '#4488ff' },
  aggroRadius:     { label: 'Радиус агро',         color: '#ff66aa' },
  // Economy
  lootBonus:       { label: 'Шанс лута',           color: '#cc88ff' },
  creditBonus:     { label: 'Кредиты с мобов',     color: '#ffd700' },
  xpBonus:         { label: 'Опыт пилота',         color: '#66ffff' },
  repairCost:      { label: 'Цена ремонта',        color: '#99ffbb' },
  shopDiscount:    { label: 'Цены в магазине',     color: '#ffaaff' },
  // QoL — buf only; deb version would be pointless
  autoAmmo:        { label: 'Авто-патроны',        color: '#ff8844', bufOnly: true },
  autoConsumables: { label: 'Авто-расходники',     color: '#88ffaa', bufOnly: true },
  scanRadius:      { label: 'Радиус сканера',      color: '#44ffff' },
  cargoBonus:      { label: 'Вместимость трюма',   color: '#ffcc66' },
};
// Pool for deb nodes (no QoL-only stats that make no sense as debuffs)
const ALL_STATS = Object.keys(STAT_META).filter(s => !STAT_META[s].bufOnly);
// Buf nodes may get any stat including QoL-only
const BUF_STATS = Object.keys(STAT_META);

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
  const placed = board.placements?.[nodeId];
  if (!placed) return 0;
  // placed can be a string id (preview uses allConns lookup) or a connector object (game stores inline)
  const conn = typeof placed === 'string' ? (allConns?.[placed] ?? null) : placed;
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
      const placed = board.placements?.[nid];
      if (placed) {
        const conn = typeof placed === 'string' ? (allConns?.[placed] ?? null) : placed;
        if (conn) sum += conn.value || 0;
      }
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
  // "Омега": j1 splits right (j2→buf) and up (buf), risky down (deb→buf).
  // Half the nodes are routing juncs. Safe: TEE(L+T+R) at j1, STRAIGHT at j2.
  // Risky: open B at j1 → d0→b2 (+deb, +buf).
  {
    tier: 1, name: 'Омега', maxConn: 4,
    nodes: [
      { id:'src', col:0, row:1, type:'src'  },
      { id:'j1',  col:1, row:1, type:'junc' },
      { id:'j2',  col:2, row:1, type:'junc' },
      { id:'b0',  col:1, row:0, type:'buf',  stat: null },
      { id:'b1',  col:3, row:1, type:'buf',  stat: null },
      { id:'d0',  col:1, row:2, type:'deb',  stat: null },
      { id:'b2',  col:2, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j1'  },
      { a:'j1',  b:'b0'  },
      { a:'j1',  b:'j2'  },
      { a:'j2',  b:'b1'  },
      { a:'j1',  b:'d0'  },
      { a:'d0',  b:'b2'  },
    ],
  },

  // "Сигма": j1 branches via j3 (up buf), j2 (right buf), deb (down risky).
  // Three routing juncs, three bufs — half-half split.
  {
    tier: 1, name: 'Сигма', maxConn: 4,
    nodes: [
      { id:'src', col:0, row:1, type:'src'  },
      { id:'j1',  col:1, row:1, type:'junc' },
      { id:'j3',  col:1, row:0, type:'junc' },
      { id:'j2',  col:2, row:1, type:'junc' },
      { id:'b0',  col:2, row:0, type:'buf',  stat: null },
      { id:'b1',  col:3, row:1, type:'buf',  stat: null },
      { id:'d0',  col:1, row:2, type:'deb',  stat: null },
      { id:'b2',  col:2, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j1' },
      { a:'j1',  b:'j3' },
      { a:'j3',  b:'b0' },
      { a:'j1',  b:'j2' },
      { a:'j2',  b:'b1' },
      { a:'j1',  b:'d0' },
      { a:'d0',  b:'b2' },
    ],
  },

  // ── T2 ──────────────────────────────────────────────────────────────────────
  // "Пульсар": single source, long routing chain j1-j2-j3, two side branches,
  // two risky deb arms off j3. Five juncs, five bufs — half-half.
  // Safe: fill j1+j2+j3+j4+j5 → reach b0,b1,b2 with no deb.
  // Risky: activate d0 or d1 at j3 for extra bufs.
  {
    tier: 2, name: 'Пульсар', maxConn: 5,
    nodes: [
      { id:'src', col:0, row:1, type:'src'  },
      { id:'j1',  col:1, row:1, type:'junc' },
      { id:'j2',  col:2, row:1, type:'junc' },
      { id:'j3',  col:3, row:1, type:'junc' },
      { id:'j4',  col:1, row:0, type:'junc' },
      { id:'j5',  col:1, row:2, type:'junc' },
      { id:'b0',  col:4, row:1, type:'buf',  stat: null },
      { id:'b1',  col:2, row:0, type:'buf',  stat: null },
      { id:'b2',  col:2, row:2, type:'buf',  stat: null },
      { id:'d0',  col:3, row:0, type:'deb',  stat: null },
      { id:'d1',  col:3, row:2, type:'deb',  stat: null },
      { id:'b3',  col:4, row:0, type:'buf',  stat: null },
      { id:'b4',  col:4, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j1'  },
      { a:'j1',  b:'j2'  }, { a:'j2', b:'j3'  }, { a:'j3', b:'b0' },
      { a:'j1',  b:'j4'  }, { a:'j4', b:'b1'  },
      { a:'j1',  b:'j5'  }, { a:'j5', b:'b2'  },
      { a:'j3',  b:'d0'  }, { a:'d0', b:'b3'  },
      { a:'j3',  b:'d1'  }, { a:'d1', b:'b4'  },
    ],
  },

  // "Нова": hub j1, debs on the path to upper/lower routing juncs and their bufs.
  // Safe: STRAIGHT(L+R) at j1 → j4→b2 only.
  // Risky: open T → d0→j2→b1 (+deb). Open B → d1→j3→b3 (+deb).
  // Four routing juncs, three bufs — routing-heavy.
  {
    tier: 2, name: 'Нова', maxConn: 5,
    nodes: [
      { id:'src', col:0, row:1, type:'src'  },
      { id:'j1',  col:1, row:1, type:'junc' },
      { id:'d0',  col:1, row:0, type:'deb',  stat: null },
      { id:'d1',  col:1, row:2, type:'deb',  stat: null },
      { id:'j4',  col:2, row:1, type:'junc' },
      { id:'j2',  col:2, row:0, type:'junc' },
      { id:'j3',  col:2, row:2, type:'junc' },
      { id:'b1',  col:3, row:0, type:'buf',  stat: null },
      { id:'b2',  col:3, row:1, type:'buf',  stat: null },
      { id:'b3',  col:3, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j1' },
      { a:'j1',  b:'d0' }, { a:'d0', b:'j2' }, { a:'j2', b:'b1' },
      { a:'j1',  b:'d1' }, { a:'d1', b:'j3' }, { a:'j3', b:'b3' },
      { a:'j1',  b:'j4' }, { a:'j4', b:'b2' },
    ],
  },

  // ── T3 ──────────────────────────────────────────────────────────────────────
  // "Нексус": two sources, 2×4 routing grid, bufs only at the ends.
  // Eight routing juncs, four bufs, two debs — heavily routing-focused.
  // Cross-links j2↔j5 and j5↔j8 let both sources reach deb paths.
  // d0 gates b2 (risky); d1 gates b3 (risky). b0/b1 always safely reachable.
  {
    tier: 3, name: 'Нексус', maxConn: 8,
    nodes: [
      { id:'src1', col:0, row:0, type:'src'  },
      { id:'src2', col:0, row:3, type:'src'  },
      { id:'j1',   col:1, row:0, type:'junc' },
      { id:'j2',   col:2, row:0, type:'junc' },
      { id:'j4',   col:1, row:1, type:'junc' },
      { id:'j5',   col:2, row:1, type:'junc' },
      { id:'j7',   col:1, row:2, type:'junc' },
      { id:'j8',   col:2, row:2, type:'junc' },
      { id:'j9',   col:1, row:3, type:'junc' },
      { id:'j10',  col:2, row:3, type:'junc' },
      { id:'b0',   col:3, row:0, type:'buf',  stat: null },
      { id:'b1',   col:3, row:1, type:'buf',  stat: null },
      { id:'d0',   col:3, row:2, type:'deb',  stat: null },
      { id:'d1',   col:3, row:3, type:'deb',  stat: null },
      { id:'b2',   col:4, row:2, type:'buf',  stat: null },
      { id:'b3',   col:4, row:3, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src1', b:'j1'  }, { a:'src2', b:'j9'  },
      { a:'j1',   b:'j2'  }, { a:'j2',  b:'b0'   },
      { a:'j1',   b:'j4'  }, { a:'j4',  b:'j5'   }, { a:'j5', b:'b1' },
      { a:'j4',   b:'j7'  }, { a:'j7',  b:'j8'   }, { a:'j8', b:'d0' }, { a:'d0', b:'b2' },
      { a:'j9',   b:'j10' }, { a:'j10', b:'d1'   }, { a:'d1', b:'b3' },
      { a:'j9',   b:'j7'  },
      { a:'j2',   b:'j5'  },
      { a:'j5',   b:'j8'  },
    ],
  },

  // "Матриця": single source, 2×3 junc grid, debs gate the bufs.
  // Six routing juncs, six bufs, three debs — half-half on juncs/bufs.
  // Safe middle: j5→b1. Upper risky: j4→d0→b0→b3. Lower risky: j6→d1→b2→b4.
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
      { id:'d0',   col:3, row:0, type:'deb',  stat: null },
      { id:'b1',   col:3, row:1, type:'buf',  stat: null },
      { id:'d1',   col:3, row:2, type:'deb',  stat: null },
      { id:'b0',   col:4, row:0, type:'buf',  stat: null },
      { id:'d2',   col:4, row:1, type:'deb',  stat: null },
      { id:'b2',   col:4, row:2, type:'buf',  stat: null },
      { id:'b3',   col:5, row:0, type:'buf',  stat: null },
      { id:'b5',   col:5, row:1, type:'buf',  stat: null },
      { id:'b4',   col:5, row:2, type:'buf',  stat: null },
    ],
    edges: [
      { a:'src', b:'j2'  },
      { a:'j2',  b:'j1'  }, { a:'j2', b:'j3'  },
      { a:'j1',  b:'j4'  }, { a:'j2', b:'j5'  }, { a:'j3', b:'j6' },
      { a:'j4',  b:'j5'  }, { a:'j5', b:'j6'  },
      { a:'j4',  b:'d0'  }, { a:'d0', b:'b0'  }, { a:'b0', b:'b3' },
      { a:'j5',  b:'b1'  }, { a:'b1', b:'d2'  }, { a:'d2', b:'b5' },
      { a:'j6',  b:'d1'  }, { a:'d1', b:'b2'  }, { a:'b2', b:'b4' },
    ],
  },
];

// ── Roll helpers ──────────────────────────────────────────────────────────────
export function rollBoard(tier) {
  const tpls = BOARD_TEMPLATES.filter(t => t.tier === tier);
  const tpl  = tpls[Math.floor(Math.random() * tpls.length)];

  const shuffledBuf = [...BUF_STATS].sort(() => Math.random() - 0.5);
  const shuffledDeb = [...ALL_STATS].sort(() => Math.random() - 0.5);
  let bi = 0, di = 0;
  const nodes = (tpl.nodes || []).map(n => {
    if (n.stat === null) {
      if (n.type === 'buf') return { ...n, stat: shuffledBuf[bi++ % shuffledBuf.length] };
      if (n.type === 'deb') return { ...n, stat: shuffledDeb[di++ % shuffledDeb.length] };
    }
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
