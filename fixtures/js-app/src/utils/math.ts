export function add(a: number, b: number): number;
export function add(a: string, b: string): string;
export function add(a: any, b: any) {
  return a + b;
}

export const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Limits a value to the inclusive range [min, max]. */
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export default clamp;

export async function sumAll(...values: number[]): Promise<number> {
  return values.reduce((acc, v) => add(acc, v), 0);
}
