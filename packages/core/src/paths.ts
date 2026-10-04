/**
 * Normalizes a path to forward slashes.
 *
 * Why: docs, citations, and hashes must be identical whether Grasp ran on
 * Windows or Unix, otherwise a workspace built on one OS looks stale on another.
 */
export function toPosixPath(p: string): string {
  return p.replaceAll("\\", "/");
}
