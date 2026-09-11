/**
 * Calendar & Timezone Utilities Test (ORB-019)
 * 
 * Tests for timezone-aware date calculations.
 */

import { describe, test, expect } from "vitest";
import {
  isOverdue,
  isDueToday,
  isDueWithinWeek,
  getTodayString,
} from "@/lib/calendar";

describe("Calendar Timezone Utilities", () => {
  // Fixed reference timestamp: 2026-09-09T12:00:00 UTC
  const FIXED_NOW = new Date(Date.UTC(2026, 8, 9, 12, 0, 0));

  describe("isOverdue", () => {
    test("returns false for null due date", () => {
      expect(isOverdue(null, "America/New_York", FIXED_NOW)).toBe(false);
    });

    test("returns false for future due dates", () => {
      expect(isOverdue("2026-09-15", "America/New_York", FIXED_NOW)).toBe(false);
    });

    test("returns true for past due dates (not DONE)", () => {
      expect(isOverdue("2026-09-01", "America/New_York", FIXED_NOW)).toBe(true);
    });

    test("handles different timezones correctly", () => {
      // A task due Sep 8 in UTC might be Sep 9 in New York (both overdue if now is Sep 9)
      expect(isOverdue("2026-09-08", "UTC", FIXED_NOW)).toBe(true);
      expect(isOverdue("2026-09-08", "America/New_York", FIXED_NOW)).toBe(true);
    });

    test("defaults to Asia/Shanghai for invalid timezone", () => {
      // If today is 2026-09-09 in Asia/Shanghai (valid tz), then Sep 1 is overdue
      expect(isOverdue("2026-09-01", "Invalid/Timezone", FIXED_NOW)).toBe(true);
    });
  });

  describe("isDueToday", () => {
    test("returns false for null due date", () => {
      expect(isDueToday(null, "America/New_York", FIXED_NOW)).toBe(false);
    });

    test("returns true for today's date", () => {
      expect(isDueToday("2026-09-09", "America/New_York", FIXED_NOW)).toBe(true);
    });

    test("returns false for yesterday", () => {
      expect(isDueToday("2026-09-08", "America/New_York", FIXED_NOW)).toBe(false);
    });

    test("returns false for tomorrow", () => {
      expect(isDueToday("2026-09-10", "America/New_York", FIXED_NOW)).toBe(false);
    });
  });

  describe("isDueWithinWeek", () => {
    test("returns false for null due date", () => {
      expect(isDueWithinWeek(null, "America/New_York", FIXED_NOW)).toBe(false);
    });

    test("returns true for today", () => {
      expect(isDueWithinWeek("2026-09-09", "America/New_York", FIXED_NOW)).toBe(true);
    });

    test("returns true for within 7 days", () => {
      expect(isDueWithinWeek("2026-09-12", "America/New_York", FIXED_NOW)).toBe(true);
      expect(isDueWithinWeek("2026-09-15", "America/New_York", FIXED_NOW)).toBe(true);
    });

    test("returns false after 7 days", () => {
      expect(isDueWithinWeek("2026-09-17", "America/New_York", FIXED_NOW)).toBe(false);
    });
  });

  describe("getTodayString", () => {
    test("returns today's date in YYYY-MM-DD format", () => {
      // With fixed NOW = 2026-09-09T12:00:00 UTC
      expect(getTodayString("America/New_York", FIXED_NOW)).toBe("2026-09-09");
    });

    test("handles invalid timezones gracefully", () => {
      // Invalid tz defaults to Asia/Shanghai; still returns valid YYYY-MM-DD
      expect(getTodayString("Invalid/Timezone", FIXED_NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
