import test from "node:test";
import assert from "node:assert/strict";
import { canCreateRole, isTerminalCallStatus, isValidCallStatus } from "../src/policy.js";

test("only owners may create owner accounts", () => {
  assert.equal(canCreateRole("owner", "owner"), true);
  assert.equal(canCreateRole("admin", "owner"), false);
  assert.equal(canCreateRole("employee", "employee"), false);
});

test("unknown provider statuses are rejected", () => {
  assert.equal(isValidCallStatus("answered"), true);
  assert.equal(isValidCallStatus("admin"), false);
});

test("terminal statuses release an employee", () => {
  assert.equal(isTerminalCallStatus("completed"), true);
  assert.equal(isTerminalCallStatus("canceled"), true);
  assert.equal(isTerminalCallStatus("ringing"), false);
});
