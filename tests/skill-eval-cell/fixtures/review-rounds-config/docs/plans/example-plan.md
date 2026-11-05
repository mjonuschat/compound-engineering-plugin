---
title: "feat: add a retry limit to webhook delivery"
type: feat
---

# Add a retry limit to webhook delivery

## Goal

Stop retrying a webhook after five failed attempts and mark the delivery failed.

## Implementation Units

### U1. Count attempts

**Files:** `src/deliver.js`, `test/deliver.test.js`

Add an attempt counter to each delivery and stop at five.

**Verification:** a delivery that fails five times is marked failed and is not retried again.
