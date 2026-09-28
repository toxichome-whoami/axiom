---
name: de-bloat
description: Mandatory code reduction discipline for AI agents — remove dead code, over-engineering, wrapper layers, unnecessary dependencies, and speculative abstractions. Activate on every refactor, review, or cleanup task, and as a standing check on any code written.
---

# De-Bloat

Every line of code is a liability: it compiles, breaks, needs reading, needs testing, needs
maintaining. If it doesn't earn its existence, it gets deleted. You are the last line of
defense against a codebase that grows by accretion and dies by bloat.

## 1. The Only Question
"Does removing this break a real, current requirement?" — if no, delete it.
Not "might it be useful someday." Not "someone spent effort on this." Not "it's harmless."
Dead code is never harmless: it misleads readers, slows builds, hides the real logic.

## 2. Deletion Targets (hunt these, in priority order)
- **Dead code**: unreferenced functions, unused exports, unreachable branches, orphaned
  components, stale feature flags (flag permanently on/off — collapse it), unused env vars
  and config keys
- **Commented-out code**: delete on sight — git is the archive
- **Speculative abstraction**: interfaces with one implementation, "for future flexibility"
  generics, config knobs nothing sets, plugins nobody loads, base classes holding one
  method. Collapse to the concrete thing
- **Wrapper chains**: functions that only call another function, classes that only hold
  one method that delegates, pass-through layers. Inline until there's a real seam
- **Over-engineering**: a switch statement pretending to be a strategy pattern, a state
  machine for two states, an event bus for one producer/one consumer, microservice splits
  with no independent scaling need. Replace with the boring direct version
- **Dependency bloat**: packages used for one trivial function (write the function),
  full-library imports when one export is used, duplicated dep versions, dev tools in prod
  deps, polyfills for browsers the project dropped
- **Repetition bloat**: copy-pasted blocks, near-duplicate components "because they differ
  slightly" — extract the one real variation point, delete the rest
- **Log/config noise**: debug logs in prod paths, env vars read but never used, commented
  config blocks "as documentation"
- **Test bloat**: tests asserting implementation trivia, duplicated test setup, mocked
  copies of the thing under test

## 3. Deletion Rules (so you don't break things)
- Prove dead before deleting: search all usages, exports, dynamic references (string
  names, reflection, config-driven imports). If uncertain, mark it, don't delete it
- Delete in one commit/change per category — dead code, then wrappers, then deps — never
  all mixed
- After deletion: run the build, tests, and typecheck. Deletion that breaks the build
  means you missed a usage — restore and investigate
- Deleting a public/exported API is a breaking change: flag it explicitly, propose the
  deprecation note, don't sneak it into a "cleanup"
- Every deletion gets one line in the report: what, where, proof it's safe

## 4. Refactor-to-Smaller Patterns
- Flag argument (`doThing(x, true)`) → two named functions
- 3+ conditionals on the same value → lookup table
- Abstraction earning its keep only past N uses → wait until N, write it concretely twice first
- Class with no state → plain functions
- Layer that only forwards → delete the layer, call the target
- "Manager/Handler/Service/Helper" whose name describes nothing → it probably does nothing —
  verify, then delete or rename to what it actually does

## 5. When Adding Code (bloat prevention at the source)
- No new file until the existing one you're editing is genuinely too big to navigate
- No new abstraction until the third concrete case exists — write the duplication first
- No new dependency until the stdlib + existing deps demonstrably can't do it
- No new config option until a real user needs to change it — hardcode, extract later
- Default to zero. Every addition must argue for its existence; silence means deletion

## 6. Output Format
```
DE-BLOAT REPORT:
- Deleted: <count> items — <one line each: what + proof of deadness>
- Collapsed: <over-engineered thing> → <simpler version>
- Deps removed: <list + KB/line savings if known>
- NOT deleted (uncertain): <item + what's needed to verify>
- Verification: build/tests/typecheck result after changes
- Net: <lines/files/deps before → after>
```

## 7. Anti-Patterns — Instant Self-Correction
- "Keeping it just in case" — git has it; delete
- Rebuilding a deleted abstraction with a new name
- Deleting tests to make the suite pass
- Replacing bloat with cleverness — boring and small beats clever
- Cleanup mixed with behavior changes — never in the same diff
