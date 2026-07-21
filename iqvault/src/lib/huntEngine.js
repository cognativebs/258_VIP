// Collection Hunt metrics — completion %, cost estimates, buy targets

export function sectionCompletion(section) {
  if (!section?.items?.length) return { owned: 0, wanted: 0, missing: 0, total: 0, pct: 0 };
  const owned = section.items.filter((i) => i.status === "owned").length;
  const wanted = section.items.filter((i) => i.status === "wanted").length;
  const missing = section.items.filter((i) => i.status === "missing").length;
  const total = section.items.length;
  return { owned, wanted, missing, total, pct: total ? Math.round((owned / total) * 100) : 0 };
}

export function huntCompletion(hunt) {
  if (hunt.comingSoon) return null;

  const sections = {};
  let totalOwned = 0;
  let totalItems = 0;

  for (const section of hunt.sections ?? []) {
    const comp = sectionCompletion(section);
    sections[section.metricKey ?? section.id] = comp;
    totalOwned += comp.owned;
    totalItems += comp.total;
  }

  const overall = totalItems ? Math.round((totalOwned / totalItems) * 100) : 0;

  const ownedValue = sumField(hunt, "market", "owned");
  const paidTotal = sumField(hunt, "paid", "owned");
  const remainingCost = estimateRemainingCost(hunt);

  return {
    sections,
    overall,
    totalOwned,
    totalItems,
    totalMissing: totalItems - totalOwned,
    ownedValue,
    paidTotal,
    remainingCost,
  };
}

function sumField(hunt, field, statusFilter) {
  let sum = 0;
  for (const section of hunt.sections ?? []) {
    for (const item of section.items ?? []) {
      if (statusFilter && item.status !== statusFilter) continue;
      if (typeof item[field] === "number") sum += item[field];
    }
  }
  return sum;
}

function estimateRemainingCost(hunt) {
  let sum = 0;
  for (const section of hunt.sections ?? []) {
    for (const item of section.items ?? []) {
      if (item.status === "owned") continue;
      const target = item.buyUnder ?? item.market ?? item.msrp;
      if (typeof target === "number") sum += target;
    }
  }
  return sum;
}

export function getBuyTargets(hunt, limit = 5) {
  if (hunt.comingSoon) return [];

  const targets = [];
  for (const section of hunt.sections ?? []) {
    for (const item of section.items ?? []) {
      if (item.status === "owned") continue;
      const price = item.buyUnder ?? item.market ?? item.msrp;
      if (price == null) continue;
      targets.push({
        section: section.name,
        name: item.name,
        buyUnder: item.buyUnder ?? item.msrp,
        emergencyCap: item.emergencyCap,
        market: item.market,
        priority: item.priority ?? "medium",
        priorityLabel: item.priorityLabel,
        targetQty: item.targetQty,
        status: item.status,
      });
    }
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return targets
    .sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return (b.targetQty ?? 0) - (a.targetQty ?? 0);
    })
    .slice(0, limit);
}

export function statusIcon(status) {
  switch (status) {
    case "owned":
      return { emoji: "🟩", label: "Owned", className: "hunt-owned" };
    case "wanted":
      return { emoji: "🟨", label: "Wanted", className: "hunt-wanted" };
    default:
      return { emoji: "🟥", label: "Missing", className: "hunt-missing" };
  }
}
