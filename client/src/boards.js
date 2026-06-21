// Expansion board system — cut-edge PCB puzzle.
// Power flows from src nodes through uncut edges to reach buf/deb/con nodes.
// Players click edges to cut them, preventing debuffs while keeping buffs powered.
//
// Board format:
//   nodes:  [{ id: number, col, row, type: 'src'|'con'|'buf'|'deb', stat?, value? }]
//   edges:  [[idA, idB], ...]
//   cuts:   [[idA, idB], ...]   (initially empty; player-set)

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

// ── Board templates ───────────────────────────────────────────────────────────
// stat: null on buf/deb = assigned randomly at rollBoard().
// value: null = assigned randomly at rollBoard() within tier ranges.
const BOARD_TEMPLATES = [
  // ── T1 ──────────────────────────────────────────────────────────────────────
  // SRC(1)—CON(2)—BUF(3)          Cut [2,4] to avoid deb, lose nothing.
  //              \                  Cut [2,3] to avoid buf (bad). Trivial intro layout.
  //              DEB(4)
  { tier: 1, nodes: [
    { id:1, col:0, row:1, type:'src' },
    { id:2, col:1, row:1, type:'con', stat:null, value:null },
    { id:3, col:2, row:0, type:'buf', stat:null, value:null },
    { id:4, col:2, row:2, type:'deb', stat:null, value:null },
  ], edges: [[1,2],[2,3],[2,4]] },

  // SRC(1)—BUF(2)—CON(3)—BUF(4)   Cut [3,5] avoids deb but loses BUF(4) (tradeoff).
  //                    \
  //                    DEB(5)
  { tier: 1, nodes: [
    { id:1, col:0, row:1, type:'src' },
    { id:2, col:1, row:1, type:'buf', stat:null, value:null },
    { id:3, col:2, row:1, type:'con', stat:null, value:null },
    { id:4, col:3, row:0, type:'buf', stat:null, value:null },
    { id:5, col:3, row:2, type:'deb', stat:null, value:null },
  ], edges: [[1,2],[2,3],[3,4],[3,5]] },

  // ── T2 ──────────────────────────────────────────────────────────────────────
  //           BUF(2)
  //            |
  // SRC(1)—CON(3)—BUF(4)—BUF(5)   Cut [3,6] avoids deb, keeps all bufs. Good player wins.
  //            |                    Cut [4,5] avoids nothing, loses BUF(5). Bad.
  //           DEB(6)—CON(7)—BUF(8)  Cut [6,7] avoids BUF(8) but deb still active!
  { tier: 2, nodes: [
    { id:1, col:0, row:1, type:'src' },
    { id:2, col:1, row:0, type:'buf', stat:null, value:null },
    { id:3, col:1, row:1, type:'con', stat:null, value:null },
    { id:4, col:2, row:1, type:'buf', stat:null, value:null },
    { id:5, col:3, row:1, type:'buf', stat:null, value:null },
    { id:6, col:1, row:2, type:'deb', stat:null, value:null },
    { id:7, col:2, row:2, type:'con', stat:null, value:null },
    { id:8, col:3, row:2, type:'buf', stat:null, value:null },
  ], edges: [[1,3],[3,2],[3,4],[4,5],[3,6],[6,7],[7,8]] },

  // SRC(1)—CON(2)—BUF(3)    DEB(4)—CON(5)—BUF(6)
  //         |                 |
  //         +-----------------+        Two sources share a con node.
  // SRC(7)—CON(8)—DEB(9)              Cut [2,4] to keep both srcs' bufs, avoid DEB(4).
  //         |                          Cut [8,9] to avoid DEB(9). Two separate decisions.
  //        BUF(10)
  { tier: 2, nodes: [
    { id:1,  col:0, row:0, type:'src' },
    { id:2,  col:1, row:0, type:'con', stat:null, value:null },
    { id:3,  col:2, row:0, type:'buf', stat:null, value:null },
    { id:4,  col:1, row:1, type:'deb', stat:null, value:null },
    { id:5,  col:2, row:1, type:'con', stat:null, value:null },
    { id:6,  col:3, row:1, type:'buf', stat:null, value:null },
    { id:7,  col:0, row:2, type:'src' },
    { id:8,  col:1, row:2, type:'con', stat:null, value:null },
    { id:9,  col:2, row:2, type:'deb', stat:null, value:null },
    { id:10, col:1, row:3, type:'buf', stat:null, value:null },
  ], edges: [[1,2],[2,3],[2,4],[4,5],[5,6],[7,8],[8,9],[8,10]] },

  // ── T3 ──────────────────────────────────────────────────────────────────────
  // Two-source diamond with multiple cut decisions.
  // SRC(1)—CON(2)—BUF(3)—CON(4)—BUF(5)
  //         |              |
  //        DEB(6)         DEB(7)—CON(8)—BUF(9)
  //                        |
  // SRC(10)—CON(11)—BUF(12)+
  //                  |
  //                 BUF(13)
  { tier: 3, nodes: [
    { id:1,  col:0, row:0, type:'src' },
    { id:2,  col:1, row:0, type:'con', stat:null, value:null },
    { id:3,  col:2, row:0, type:'buf', stat:null, value:null },
    { id:4,  col:3, row:0, type:'con', stat:null, value:null },
    { id:5,  col:4, row:0, type:'buf', stat:null, value:null },
    { id:6,  col:1, row:1, type:'deb', stat:null, value:null },
    { id:7,  col:3, row:1, type:'deb', stat:null, value:null },
    { id:8,  col:4, row:1, type:'con', stat:null, value:null },
    { id:9,  col:5, row:1, type:'buf', stat:null, value:null },
    { id:10, col:0, row:2, type:'src' },
    { id:11, col:1, row:2, type:'con', stat:null, value:null },
    { id:12, col:2, row:2, type:'buf', stat:null, value:null },
    { id:13, col:2, row:3, type:'buf', stat:null, value:null },
  ], edges: [[1,2],[2,3],[3,4],[4,5],[2,6],[4,7],[7,8],[8,9],[10,11],[11,12],[12,13],[11,7]] },

  // Three-source web. Many paths, many tradeoffs.
  // SRC(1)—CON(2)—BUF(3)   SRC(4)—CON(5)—BUF(6)
  //         |    \                   |
  //        DEB(7) CON(8)—BUF(9)   DEB(10)
  //                |
  // SRC(11)—BUF(12)+—DEB(13)—CON(14)—BUF(15)
  //                |
  //               BUF(16)
  { tier: 3, nodes: [
    { id:1,  col:0, row:0, type:'src' },
    { id:2,  col:1, row:0, type:'con', stat:null, value:null },
    { id:3,  col:2, row:0, type:'buf', stat:null, value:null },
    { id:4,  col:4, row:0, type:'src' },
    { id:5,  col:5, row:0, type:'con', stat:null, value:null },
    { id:6,  col:6, row:0, type:'buf', stat:null, value:null },
    { id:7,  col:1, row:1, type:'deb', stat:null, value:null },
    { id:8,  col:3, row:1, type:'con', stat:null, value:null },
    { id:9,  col:4, row:1, type:'buf', stat:null, value:null },
    { id:10, col:5, row:1, type:'deb', stat:null, value:null },
    { id:11, col:0, row:2, type:'src' },
    { id:12, col:2, row:2, type:'buf', stat:null, value:null },
    { id:13, col:3, row:2, type:'deb', stat:null, value:null },
    { id:14, col:4, row:2, type:'con', stat:null, value:null },
    { id:15, col:5, row:2, type:'buf', stat:null, value:null },
    { id:16, col:2, row:3, type:'buf', stat:null, value:null },
  ], edges: [[1,2],[2,3],[2,7],[2,8],[4,5],[5,6],[5,10],[8,9],[8,12],[11,12],[12,13],[12,16],[13,14],[14,15]] },
];

// ── BFS: powered nodes ────────────────────────────────────────────────────────
export function getPoweredNodes(board) {
  if (!board?.nodes) return new Set();
  const adj = {};
  for (const n of board.nodes) adj[n.id] = [];
  const cutSet = new Set(
    (board.cuts || []).map(([a, b]) => `${Math.min(a,b)}-${Math.max(a,b)}`)
  );
  for (const [a, b] of (board.edges || [])) {
    if (!cutSet.has(`${Math.min(a,b)}-${Math.max(a,b)}`)) {
      adj[a].push(b);
      adj[b].push(a);
    }
  }
  const powered = new Set();
  const queue = board.nodes.filter(n => n.type === 'src').map(n => n.id);
  queue.forEach(id => powered.add(id));
  for (let i = 0; i < queue.length; i++) {
    for (const nb of adj[queue[i]] || []) {
      if (!powered.has(nb)) { powered.add(nb); queue.push(nb); }
    }
  }
  return powered;
}

// ── Stat effects (used by Player.recomputeStats) ──────────────────────────────
export function getBoardEffects(board) {
  if (!board?.nodes) return {};
  const powered = getPoweredNodes(board);
  const effects = {};
  for (const n of board.nodes) {
    if (!n.stat || !n.value || !powered.has(n.id)) continue;
    if (n.type === 'buf') effects[n.stat] = (effects[n.stat] || 0) + n.value;
    if (n.type === 'deb') effects[n.stat] = (effects[n.stat] || 0) - n.value;
  }
  return effects;
}

// ── Roll helpers ──────────────────────────────────────────────────────────────
export function rollBoard(tier) {
  const tpls = BOARD_TEMPLATES.filter(t => t.tier === tier);
  const tpl  = tpls[Math.floor(Math.random() * tpls.length)];

  const [bufLo, bufHi, debLo, debHi, conLo, conHi] =
    tier === 1 ? [8,  12,  5,  8,  3, 5] :
    tier === 2 ? [12, 18,  8, 13,  5, 8] :
                 [18, 26, 12, 18,  7, 11];

  const rng    = (lo, hi) => Math.round(lo + Math.random() * (hi - lo));
  const stats  = [...ALL_STATS].sort(() => Math.random() - 0.5);
  let si = 0;

  const nodes = tpl.nodes.map(n => {
    const node = { ...n };
    if (n.type === 'buf') { node.stat = stats[si++ % stats.length]; node.value = rng(bufLo, bufHi); }
    if (n.type === 'deb') { node.stat = stats[si++ % stats.length]; node.value = rng(debLo, debHi); }
    if (n.type === 'con') { node.value = rng(conLo, conHi); }
    return node;
  });

  return {
    id:    `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    tier,
    nodes,
    edges: tpl.edges.map(e => [e[0], e[1]]),
    cuts:  [],
  };
}

// ── UI helpers ────────────────────────────────────────────────────────────────
export function boardTierLabel(tier) {
  return `ПЛАТА  ТИР ${tier}`;
}

export function boardPreviewStats(board) {
  if (!board?.nodes) return '—';
  const parts = [];
  for (const n of board.nodes) {
    if (!n.stat || !n.value) continue;
    const meta = STAT_META[n.stat];
    if (!meta) continue;
    parts.push(`${meta.label} ${n.type === 'buf' ? '+' : '−'}${n.value}%`);
  }
  return parts.join(' · ') || '—';
}
