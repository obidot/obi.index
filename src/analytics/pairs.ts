export function normalizePairAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function buildPairId(tokenA: string, tokenB: string): string {
  const [left, right] = [tokenA, tokenB]
    .map(normalizePairAddress)
    .sort((a, b) => a.localeCompare(b));

  return `${left}:${right}`;
}
