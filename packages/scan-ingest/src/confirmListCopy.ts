/**
 * Verify copy before Approve writes a second holding of an already-held card.
 */

export function formatDuplicateCopyVerifyMessage(names: string[]): string {
  const unique = names.map((n) => n.trim()).filter(Boolean);
  if (unique.length === 0) {
    return "A card on this list already exists in inventory. Add another copy?";
  }
  if (unique.length === 1) {
    return `This card already exists in inventory:\n\n${unique[0]}\n\nAdd another copy?`;
  }
  return (
    `These cards already exist in inventory:\n\n` +
    `${unique.map((n) => `• ${n}`).join("\n")}\n\n` +
    `Add another copy of each?`
  );
}

export function unitNeedsInventoryCopyAck(unit: {
  duplicateAcknowledged?: boolean;
  physicalReimport?: boolean;
}): boolean {
  return Boolean(unit.duplicateAcknowledged || unit.physicalReimport);
}
