---
name: testing-verification
description: Mandatory verification discipline for AI agents — no code is "done" until its behavior is proven by execution, tests, or explicit logical trace. Activate on every coding, debugging, or refactoring task. Forbids "looks correct" delivery.
---

# Testing & Verification Discipline

"No code is done until it's proven." Writing code and verifying code are two separate,
both-mandatory phases of every task.

## 1. The Proof Ladder — always climb as high as the environment allows
1. **Run it.** If you can execute (REPL, test runner, compiler, linter) — execute. Real output beats reasoning.
2. **Test it.** If there's a test suite, add or update the test that covers your change, and run the suite. If no suite exists and your change is non-trivial, write the minimal test.
3. **Trace it.** If execution is impossible, do an explicit dry-run: walk the code with concrete inputs (normal, boundary, empty, error) and state the expected output at each step. Present the trace, not just "should work."
4. **Nothing below rung 3 is acceptable.** "It looks correct" is not a rung.

## 2. Minimum Verification Per Change Type
- **New function/logic** → at least: happy path + one boundary + one error/empty input traced or tested
- **Bug fix** → the failing case must be reproducible in a test FIRST, then pass after the fix. No fix without a regression test
- **Refactor (no behavior change)** → prove equivalence: same inputs, same outputs; run existing tests; diff the observable behavior, not the code style
- **Config/build/dependency change** → verify the build/config resolves and the app still boots
- **Deletion** → grep for all usages; prove each is dead or migrated

## 3. Test Standards (when writing tests)
- Test behavior and edge cases, not implementation details
- Name tests by the scenario: `returns_401_when_token_expired`, not `test_auth`
- One assertion cluster per behavior; a test that checks 8 things tells you one failed, not which
- Cover the cases where THIS code would realistically break: nulls, empty, concurrency, boundary values, timeouts — not 100% line coverage theatre
- No mocked-everything tests that prove nothing (mock the boundary, not the logic under test)

## 4. Failure Protocol
When verification FAILS:
- Report the exact failure: input, expected, actual, stack/error
- Fix the CODE first, not the test — unless the test itself was wrong (say so explicitly)
- Never weaken an assertion, skip a test, or widen a type to make verification pass
- Re-run from the top of the ladder after every fix

## 5. Verification Report — appended to every coding response
```
VERIFICATION:
- Executed: <what was run / "not possible: <reason>">
- Traced cases: <list of inputs walked through>
- Tests added/updated: <files>
- Suite result: <pass/fail + count> / "no suite exists"
- Not verified: <what remains unproven and why — honest>
```
If "Not verified" contains anything load-bearing, say so in the summary line.

## 6. Anti-Patterns — Instant Self-Correction
- Shipping without running the code that could have been run
- A bug fix with no failing test before the fix
- Editing a test to match broken output instead of fixing the code
- Claiming "tests pass" when you didn't run them
- Marking done with a known failing edge case "because it's unlikely"
