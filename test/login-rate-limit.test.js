import test from "node:test";
import assert from "node:assert/strict";
import { createLoginRateLimiter } from "../src/login-rate-limit.js";

test("successful login clearing prevents normal users from being locked out", () => {
  let currentTime = 0;
  const limiter = createLoginRateLimiter({ windowMs: 60_000, maxAttempts: 3, now: () => currentTime });
  for (let index = 0; index < 10; index += 1) {
    assert.equal(limiter.state("127.0.0.1", "owner@example.com").blocked, false);
    limiter.clear("127.0.0.1", "owner@example.com");
  }
});

test("only failed attempts trigger the lockout threshold", () => {
  const limiter = createLoginRateLimiter({ windowMs: 60_000, maxAttempts: 3, now: () => 1_000 });
  limiter.recordFailure("127.0.0.1", "owner@example.com");
  limiter.recordFailure("127.0.0.1", "owner@example.com");
  assert.equal(limiter.state("127.0.0.1", "owner@example.com").blocked, false);
  limiter.recordFailure("127.0.0.1", "owner@example.com");
  assert.equal(limiter.state("127.0.0.1", "owner@example.com").blocked, true);
});

test("attempts are isolated by normalized email and expire after the window", () => {
  let currentTime = 0;
  const limiter = createLoginRateLimiter({ windowMs: 1_000, maxAttempts: 1, now: () => currentTime });
  limiter.recordFailure("127.0.0.1", " OWNER@example.com ");
  assert.equal(limiter.state("127.0.0.1", "owner@example.com").blocked, true);
  assert.equal(limiter.state("127.0.0.1", "other@example.com").blocked, false);
  currentTime = 1_001;
  assert.equal(limiter.state("127.0.0.1", "owner@example.com").blocked, false);
});
