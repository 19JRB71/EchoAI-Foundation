import { describe, it, expect } from "vitest";
import {
  priorityForEvent,
  topPriority,
  mergeCounts,
  sortByPriority,
  PRIORITY_RANK,
} from "./notificationPriority.js";

describe("priorityForEvent", () => {
  it("maps known events to their color tier", () => {
    expect(priorityForEvent("hot_lead")).toBe("red");
    expect(priorityForEvent("competitor_ad_threat")).toBe("red");
    expect(priorityForEvent("goal_alert")).toBe("yellow");
    expect(priorityForEvent("sentinel_fixed")).toBe("green");
    expect(priorityForEvent("morning_briefing")).toBe("green");
  });

  it("defaults unknown events to yellow", () => {
    expect(priorityForEvent("something_new")).toBe("yellow");
    expect(priorityForEvent(undefined)).toBe("yellow");
  });

  it("honors a valid payload.priority override", () => {
    expect(priorityForEvent("morning_briefing", { priority: "red" })).toBe("red");
    expect(priorityForEvent("hot_lead", { priority: "green" })).toBe("green");
  });

  it("ignores an invalid payload.priority override", () => {
    expect(priorityForEvent("hot_lead", { priority: "purple" })).toBe("red");
  });
});

describe("topPriority", () => {
  it("returns the single highest pending tier", () => {
    expect(topPriority({ red: 1, yellow: 2, green: 3, total: 6 })).toBe("red");
    expect(topPriority({ red: 0, yellow: 2, green: 3, total: 5 })).toBe("yellow");
    expect(topPriority({ red: 0, yellow: 0, green: 3, total: 3 })).toBe("green");
  });

  it("returns null when nothing is pending", () => {
    expect(topPriority({ red: 0, yellow: 0, green: 0, total: 0 })).toBeNull();
    expect(topPriority(null)).toBeNull();
  });
});

describe("mergeCounts", () => {
  it("sums two buckets field by field", () => {
    const a = { red: 1, yellow: 2, green: 0, total: 3 };
    const b = { red: 0, yellow: 1, green: 4, total: 5 };
    expect(mergeCounts(a, b)).toEqual({ red: 1, yellow: 3, green: 4, total: 8 });
  });

  it("treats null/undefined buckets as zero", () => {
    expect(mergeCounts(null, { red: 2, yellow: 0, green: 0, total: 2 })).toEqual({
      red: 2,
      yellow: 0,
      green: 0,
      total: 2,
    });
    expect(mergeCounts(null, null)).toEqual({
      red: 0,
      yellow: 0,
      green: 0,
      total: 0,
    });
  });
});

describe("sortByPriority", () => {
  it("orders red → yellow → green, newest first within a tier", () => {
    const rows = [
      { id: 1, priority: "green", createdAt: "2026-07-10T10:00:00Z" },
      { id: 2, priority: "red", createdAt: "2026-07-10T09:00:00Z" },
      { id: 3, priority: "red", createdAt: "2026-07-10T11:00:00Z" },
      { id: 4, priority: "yellow", createdAt: "2026-07-10T08:00:00Z" },
    ];
    expect(sortByPriority(rows).map((r) => r.id)).toEqual([3, 2, 4, 1]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      { id: 1, priority: "green", createdAt: "2026-07-10T10:00:00Z" },
      { id: 2, priority: "red", createdAt: "2026-07-10T09:00:00Z" },
    ];
    const copy = [...rows];
    sortByPriority(rows);
    expect(rows).toEqual(copy);
  });

  it("treats unknown priorities as yellow rank", () => {
    expect(PRIORITY_RANK.yellow).toBe(1);
    const rows = [
      { id: 1, priority: "green", createdAt: "2026-07-10T10:00:00Z" },
      { id: 2, priority: "mystery", createdAt: "2026-07-10T09:00:00Z" },
    ];
    expect(sortByPriority(rows)[0].id).toBe(2);
  });
});
