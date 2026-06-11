export interface XPProgress {
  level: number;
  totalXP: number;
  currentLevelStartXP: number;
  nextLevelStartXP: number;
  xpIntoLevel: number;
  xpRequiredForNextLevel: number;
  xpRemainingForNextLevel: number;
  progressPercent: number;
}

export function getXPRequiredForNextLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return Math.round(100 * 1.2 ** (safeLevel - 1));
}

export function getLevelFromXP(totalXP: number): number {
  let safeXP = Math.max(0, Math.floor(totalXP));
  let level = 1;

  while (safeXP >= getXPRequiredForNextLevel(level)) {
    safeXP -= getXPRequiredForNextLevel(level);
    level += 1;
  }

  return level;
}

export function getProgressToNextLevel(totalXP: number): XPProgress {
  const safeXP = Math.max(0, Math.floor(totalXP));
  const level = getLevelFromXP(safeXP);
  const currentLevelStartXP = getCumulativeXPForLevel(level);
  const xpRequiredForNextLevel = getXPRequiredForNextLevel(level);
  const nextLevelStartXP = currentLevelStartXP + xpRequiredForNextLevel;
  const xpIntoLevel = safeXP - currentLevelStartXP;
  const xpRemainingForNextLevel = Math.max(0, nextLevelStartXP - safeXP);

  return {
    level,
    totalXP: safeXP,
    currentLevelStartXP,
    nextLevelStartXP,
    xpIntoLevel,
    xpRequiredForNextLevel,
    xpRemainingForNextLevel,
    progressPercent: Math.min(100, Math.round((xpIntoLevel / xpRequiredForNextLevel) * 100))
  };
}

function getCumulativeXPForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  let total = 0;

  for (let currentLevel = 1; currentLevel < safeLevel; currentLevel += 1) {
    total += getXPRequiredForNextLevel(currentLevel);
  }

  return total;
}
