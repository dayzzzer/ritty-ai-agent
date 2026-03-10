export function pickRandom<T>(items: T[]): T {
  if (items.length === 0) {
    throw new Error('Cannot pick random item from an empty array.');
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

export function pickDistinctRandom<T>(items: T[], count: number): T[] {
  if (count <= 0) {
    return [];
  }

  const copy = [...items];
  const result: T[] = [];
  const target = Math.min(count, copy.length);

  while (result.length < target) {
    const index = Math.floor(Math.random() * copy.length);
    const [item] = copy.splice(index, 1);
    result.push(item);
  }

  return result;
}
