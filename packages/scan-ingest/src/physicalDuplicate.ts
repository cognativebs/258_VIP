/**
 * Same physical scan accidentally imported twice (byte identity).
 * Distinct from same card *type* already held — that is findDuplicates().
 */
export function isPhysicalReimport(
  frontHash: string,
  knownFrontHashes: Iterable<string>,
): boolean {
  const set = new Set(knownFrontHashes);
  return set.has(frontHash);
}
