// Кривая опыта пилота 1–50 (content-scope, пересмотр 2026-06-04 — круче на верхах):
//   xp_to_next(L) = 40·L² + 13·max(0, L−25)³
// До lvl 25 — чистый квадрат (мид не тронут), выше 25 кубический доводчик гнёт хвост.
// Кумулятив до lvl 50 = 2 787 000 XP. Только PvE начисляет опыт.
export const MAX_LEVEL = 50;

export function xpToNext(L) {
  if (L >= MAX_LEVEL) return Infinity;
  const knee = Math.max(0, L - 25);
  return 40 * L * L + 13 * knee * knee * knee;
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
