// Кривая опыта пилота 1–50:
//   base(L) = 40·L² + 13·max(0, L−25)³
//   L < 40  → base(L)
//   L 40–45 → base(L) × 4.5  (эндгейм-плато)
//   L 46–49 → base(L) × 6    (финальный рывок)
// Кумулятив до lvl 50 = 10 601 113 XP (1→40 не менялся, 964 925 XP; весь прирост —
// в 40–50, ×1.5 от прежних 6 424 125). При текущих наградах (без учёта будущих
// миссий/бонус-предметов с 40 ур.) это ≈ 1 год фарма до макс. уровня вместо ~8.7 мес.
// Только PvE начисляет опыт.
export const MAX_LEVEL = 50;

export function xpToNext(L) {
  if (L >= MAX_LEVEL) return Infinity;
  const knee = Math.max(0, L - 25);
  const base = 40 * L * L + 13 * knee * knee * knee;
  if (L >= 46) return base * 6;
  if (L >= 40) return base * 4.5;
  return base;
}

// Возвращает {level, into, need, frac} для суммарного XP.
// into — сколько XP набрано внутри текущего уровня, need — сколько нужно до следующего.
export function levelInfo(totalXp) {
  let L = 1, acc = 0;
  while (L < MAX_LEVEL) {
    const need = xpToNext(L);
    if (totalXp < acc + need) break;
    acc += need; L++;
  }
  const need = L >= MAX_LEVEL ? 0 : xpToNext(L);
  const into = totalXp - acc;
  return { level: L, into, need, frac: need > 0 ? into / need : 1 };
}
