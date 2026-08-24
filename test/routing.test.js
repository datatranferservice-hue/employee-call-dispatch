import test from "node:test";
import assert from "node:assert/strict";
import { chooseEmployee, isWithinBusinessHours, normalizeStrategy } from "../src/routing.js";

const employee = (id, overrides = {}) => ({
  id, active: true, on_duty: true, busy: false, phone_verified: true,
  phone_approved: true, forwarding_phone: "+1520555010" + id,
  routed_calls: 0, last_routed_at: null, ...overrides
});

test("round robin distributes by cursor", () => {
  const pool = [employee(1), employee(2), employee(3)];
  assert.equal(chooseEmployee(pool, "round_robin", 0).id, 1);
  assert.equal(chooseEmployee(pool, "round_robin", 4).id, 2);
});

test("ineligible employees never receive calls", () => {
  const pool = [employee(1, { on_duty: false }), employee(2, { phone_approved: false }), employee(3)];
  assert.equal(chooseEmployee(pool, "round_robin", 0).id, 3);
});

test("fewest calls and longest idle strategies select correctly", () => {
  assert.equal(chooseEmployee([employee(1, { routed_calls: 8 }), employee(2, { routed_calls: 2 })], "least_calls").id, 2);
  assert.equal(chooseEmployee([
    employee(1, { last_routed_at: "2026-08-24T12:00:00Z" }),
    employee(2, { last_routed_at: "2026-08-20T12:00:00Z" })
  ], "longest_idle").id, 2);
});

test("business hours honor Arizona timezone and closure override", () => {
  const hours = { mon: ["08:00", "17:00"] };
  const mondayNoonArizona = new Date("2026-08-24T19:00:00Z");
  assert.equal(isWithinBusinessHours(mondayNoonArizona, "America/Phoenix", hours, false), true);
  assert.equal(isWithinBusinessHours(mondayNoonArizona, "America/Phoenix", hours, true), false);
});

test("unknown routing strategy safely falls back", () => {
  assert.equal(normalizeStrategy("not-valid"), "round_robin");
});
