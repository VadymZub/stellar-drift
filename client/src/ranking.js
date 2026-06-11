import { RANKS, RANK_FORMULA } from './constants.js';
import { levelInfo, MAX_LEVEL } from './leveling.js';

// Нормализация для расчета рейтинга (40% XP + 60% Honor).
// MAX_XP_NORM — примерный опыт на 50 уровне (≈2.8 млн).
// MAX_HONOR_NORM — базовое значение для 100% веса чести (≈1 млн).
const MAX_XP_NORM = 2800000;
const MAX_HONOR_NORM = 1000000;

/**
 * Вычисляет нормализованный рейтинг игрока.
 * @param {number} xp 
 * @param {number} honor 
 * @returns {number} 0.0 - 1.0+
 */
export function calculateRating(xp, honor) {
  const normXp = Math.min(1.0, xp / MAX_XP_NORM);
  const normHonor = Math.min(1.0, honor / MAX_HONOR_NORM);
  return (normXp * RANK_FORMULA.xpWeight) + (normHonor * RANK_FORMULA.honorWeight);
}

/**
 * Определяет ранг игрока на основе его рейтинга и общего списка рейтингов (корпорации).
 * @param {number} playerRating 
 * @param {number[]} allRatings — отсортированный по убыванию массив рейтингов всех игроков корп.
 * @returns {object} Объект ранга из RANKS
 */
export function getRank(playerRating, allRatings = []) {
  if (allRatings.length === 0) return RANKS[RANKS.length - 1]; // Кадет по умолчанию

  const position = allRatings.indexOf(playerRating) + 1; // 1-based index
  const total = allRatings.length;

  for (const rank of RANKS) {
    if (rank.type === 'fixed') {
      if (position <= rank.limit) return rank;
    } else if (rank.type === 'percent') {
      const threshold = Math.ceil((total * rank.percent) / 100);
      if (position <= threshold) return rank;
    }
  }

  return RANKS[RANKS.length - 1]; // На случай, если не попал никуда (хотя percent 100 покроет)
}
