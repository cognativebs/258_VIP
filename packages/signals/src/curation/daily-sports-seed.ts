/**
 * daily-sports@0.1.0 (operator, 2026-10-01): 80% football (NFL + college),
 * 10% soccer, 5% basketball (NBA), 5% baseball (MLB). Basketball and baseball
 * are exit sports (selling out), so their up signals read as sell windows.
 * Migration 20261001_02 embeds this object; a test fails if the two drift.
 */
import type { DailySportsProfile } from "./daily-sports.js";

export const DAILY_SPORTS_PROFILE_SEED: DailySportsProfile = {
  schema: "vip_signals_curation_v1",
  name: "daily-sports",
  version: "0.1.0",
  domain: "sports_cards",
  slots: 20,
  windowHours: 24,
  groups: [
    { key: "football", label: "Football (NFL + college)", share: 0.8, lanes: ["nfl", "ncf"], stance: "collect" },
    { key: "soccer", label: "Soccer", share: 0.1, lanes: ["soccer"], stance: "collect" },
    { key: "basketball", label: "Basketball (NBA)", share: 0.05, lanes: ["nba"], stance: "exit" },
    { key: "baseball", label: "Baseball (MLB)", share: 0.05, lanes: ["mlb"], stance: "exit" },
  ],
  backfillOrder: ["football", "soccer"],
  notes:
    "Operator weights 2026-10-01. Shares choose how many of the day's slots each sport gets; they never change a signal's scores. Slots a sport cannot fill go to football, then soccer; exit sports are not backfilled. Hockey and college basketball are outside the profile. Slot count and window are starting choices · unverified.",
};
