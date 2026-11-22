// Your last kill cam photo, kept on this phone for the scoreboard. The database copy is
// deleted when the game ends, so the photo never outlives the round there; this one lasts
// until the page closes or the next round starts. `round` tells rounds apart (game code and
// start time).

let last: { round: string; jpg: string } | null = null;

export function keepLastKill(round: string, jpg: string) {
  last = { round, jpg };
}

export function lastKill(round: string): string | null {
  return last?.round === round ? last.jpg : null;
}

export function roundKey(code: string, startAt: number | undefined): string {
  return `${code}:${startAt ?? 0}`;
}
