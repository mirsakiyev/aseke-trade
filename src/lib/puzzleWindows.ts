export interface PuzzleWindow {
  id: string;
  start: Date;
  nextRefresh: Date;
}

const puzzleWindowHours = 4;
const millisecondsPerHour = 60 * 60 * 1000;

export function getCurrentPuzzleWindow(date = new Date()): PuzzleWindow {
  const startHour = Math.floor(date.getUTCHours() / puzzleWindowHours) * puzzleWindowHours;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), startHour, 0, 0, 0));
  const nextRefresh = new Date(start.getTime() + puzzleWindowHours * millisecondsPerHour);

  return {
    id: getPuzzleWindowId(start),
    start,
    nextRefresh
  };
}

export function getPuzzleWindowId(date = new Date()): string {
  const startHour = Math.floor(date.getUTCHours() / puzzleWindowHours) * puzzleWindowHours;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(startHour).padStart(2, "0");

  return `${year}-${month}-${day}-${hour}`;
}

export function getNextPuzzleRefreshTime(date = new Date()): Date {
  return getCurrentPuzzleWindow(date).nextRefresh;
}

export function millisecondsUntilNextPuzzleRefresh(date = new Date()): number {
  return Math.max(0, getNextPuzzleRefreshTime(date).getTime() - date.getTime());
}
