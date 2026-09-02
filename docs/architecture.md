# jqdiff — Architecture

Single source of truth for jqdiff's design. Everything under `docs/superpowers/` is exploratory
history and is not authoritative; this document is.

jqdiff detects regressions introduced when jQuery code is rewritten to native DOM APIs. It records
real user interaction once, replays it against the old and new builds, and reports the differences
in semantic terms — "`#modal` computed `display` is `block`, was `inline-flex`" — not as pixel
deltas.

## 1. Problem

Two conventional answers do not work here.

**Pixel-based visual regression testing** reports that 0.3% of pixels changed. It cannot say which
element, which property, or why, so triage cost scales with the size of the diff — exactly when you
can least afford it. It is also blind to behavioral regressions that produce no visual change at
all: a lost `X-Requested-With` header, an event that no longer stops propagating, a `<script>` in
injected HTML that stops running.

**Pre-written E2E assertions** are circular. You are asked to write assertions covering the behavior
you are about to change, before you understand what that behavior actually is. The assertions you
write cover the cases you already thought of; the incidents come from the cases you did not. Coverage
must come from what the application actually does under real operation, not from what someone
imagined it does.

jqdiff's inversion: **do not author assertions — capture them.** The baseline is a recording of real
behavior, and the "assertions" are everything the recording observed.

## 2. Enabling assumption

In a jQuery → native migration, **HTML and CSS are unchanged; only JavaScript is swapped.**

This is what makes selector-based replay viable: the same selector addresses the same element in
both builds, so a step recorded against the old build replays faithfully against the new one, and
DOM targets are directly comparable across the two traces.

If a migration also rewrites markup, this assumption breaks and jqdiff's output degrades into noise.
Rewrite markup in a separate change.

## 3. Approach

Three stages:

```
record   real interaction        → Scenario  (a list of steps)
replay   Scenario × 2 builds     → Trace × 2 (what each build did)
diff     Trace × Trace           → Diff      (severity-ranked findings)
```

The Scenario is recorded once. **Both traces are produced by replay** — including the baseline. The
recording session's own trace is discarded, because it reflects human interaction timing and would
not be comparable against a machine-driven replay. Baseline and candidate therefore pass through
identical conditions, which is what makes the comparison fair.

## 4. Components

| Unit | Runs in | Responsibility |
|---|---|---|
| `src/probe/` | Browser | Observes the page: DOM mutations, network calls, event propagation, computed styles. Exposes `window.__jqdiff`. |
| `src/recorder/` | Browser | Turns real user interaction into `ScenarioStep[]`. |
| `src/runner/` | Node (Playwright) | Injects probe + determinism stubs, replays a Scenario, collects a Trace. |
| `src/differ/` | Node | Normalizes both traces, compares them, assigns severity. |
| `src/reporter/` | Node | Renders a Diff as a self-contained HTML file. |

`src/probe/` and `src/recorder/` must not depend on Node APIs; they are bundled as browser IIFEs.
The only thing shared across the boundary is `src/types.ts`.

## 5. Data model

Defined in [`src/types.ts`](../src/types.ts).

- **`Scenario`** — start URL, viewport, and an ordered list of `ScenarioStep` (`click` / `input` /
  `change` / `submit` / `keydown` / `scroll`, each addressed by a stable selector).
- **`Trace`** — an ordered list of `Checkpoint`. One checkpoint is taken after initial load and one
  after each step. Each holds the `MutationEntry[]`, `NetworkEntry[]`, `EventEntry[]`, and computed
  `styles` observed since the previous checkpoint.
- **`Diff`** — `StructuralIssue[]` (the traces are not shape-comparable) plus `Finding[]` (a
  concrete difference with a severity).

## 6. What the probe records

**DOM mutations.** A `MutationObserver` on `document` with subtree, childList, attributes,
characterData, and both old-value flags. It observes `document` rather than `document.documentElement`
because `addInitScript` runs before `documentElement` exists.

**Network.** `XMLHttpRequest.prototype.open` / `setRequestHeader` / `send` and `window.fetch` are
wrapped to record method, URL, headers, body, and status. Whether the *caller* treated a response as
an error is deliberately not tracked — see §10, trap 4.

**Event propagation.** `EventTarget.prototype.addEventListener` is wrapped. Around each handler call
the probe records `defaultPrevented` before, shadows `stopPropagation` /
`stopImmediatePropagation` as own properties on the event object (always delegating to the originals,
so propagation behavior is unchanged), runs the handler, and records the resulting flags.

Listener identity is kept in a `WeakMap` keyed by `${type}|${capture}` so that
`removeEventListener` still resolves the original function — otherwise jQuery's `.off()` silently
stops working under the probe.

**Computed styles.** Sampled at each checkpoint via `getComputedStyle`, restricted to elements that
mutated in that interval, their parents, and the step's target element. Walking the whole DOM is too
expensive. The default property set (overridable) covers visibility, box model, typography, flex, and
interaction properties.

## 7. Stable selectors

`src/probe/selector.ts` maps an element to a selector, in priority order:

1. `[data-testid="…"]`
2. `#id`, unless the id matches a generated-id pattern
3. `[name="…"]` for form controls
4. A structural path up to `body`, with generated class names stripped and `:nth-child(n)` always
   appended for determinism

Generated-id patterns default to `/^jQuery\d+$/`, `/^ui-id-\d+$/`, `/^select2-/`, `/^:r[a-z0-9]+:$/`
(React `useId`), and a UUID prefix. User-supplied patterns are **appended, never substituted** —
adding one pattern must not silently disable jQuery's.

## 8. Normalization

Applied to both traces before comparison. Each rule exists to suppress a specific class of noise that
a jQuery → native migration reliably produces.

| Rule | Suppresses |
|---|---|
| Collapse generated ids in selectors and attribute values to `<gen>` | jQuery/plugin counters differ run to run |
| Sort class-attribute tokens | `"a b"` vs `"b a"` is not a difference |
| Collapse mutations sharing `(target, type, attributeName)` within a checkpoint, keeping the first `oldValue` and last `newValue` | Animation intermediate frames otherwise bury the real diff |
| Sort collapsed mutations by `(target, type, attributeName)` | Mutation order within a checkpoint is not meaningful |
| Preserve order for network and events | Execution order *is* the meaning here |

## 9. Comparison

**Network.** Method, URL (query keys sorted), an allowlist of headers (`content-type`,
`x-requested-with`, `accept`, `authorization`, `x-csrf-token`), body (JSON deep-compared with sorted
keys; urlencoded compared with sorted keys; otherwise string equality), and status.

**Events — compared per dispatch, not per handler.** jQuery's `.on('click', 'li', fn)` delegation
registers *one* native listener for N handlers, while a faithful native migration registers N
listeners. Comparing handler-call sequences would emit "missing handler" diffs for a *correct*
migration. Consecutive entries sharing `(type, target)` are therefore grouped into one dispatch, and
only three things are compared:

- `path` — the de-duplicated sequence of `currentTarget`s actually reached
- `defaultPrevented` — did any handler call `preventDefault`
- `propagationStopped` — did any handler call `stopPropagation`

This compares how the event was *semantically handled*, not how many listeners were registered.
Rewriting `return false` to a bare `preventDefault()` shows up in both `path` and
`propagationStopped`.

**Styles.** Per selector × property, string equality. Selectors present on only one side are skipped:
the sampling set is mutation-driven, so a one-sided selector reflects a sampling-scope difference
that is already reported as a mutation diff. Reporting it again would double-count.

**Mutations.** Set difference over normalized entries.

## 10. Severity

| Severity | Assigned to |
|---|---|
| `critical` | Any network difference. Event `defaultPrevented`, `propagationStopped`, `propagationPath`, or a missing dispatch. Computed `display`, `visibility`, `opacity`, `pointer-events`. |
| `warning` | Computed layout properties (`width`, `height`, `position`, offsets, `margin-*`, `padding-*`, `overflow-*`, `z-index`) and appearance properties (`color`, `background-color`, `font-size`, `font-weight`, `line-height`, `text-align`, `transform`). `childList` and `characterData` mutations. Attribute mutations other than `class` / `style`. Event dispatch-order differences. |
| `info` | `class` / `style` attribute mutations **when the element's computed style is identical on both sides**. Any other computed-style property. |

`severityOverrides` in the config overrides all of the above, keyed by property name.

**The demotion rule is deliberately narrow.** Migrations routinely replace
`element.style.display = 'none'` with `classList.add('hidden')`; without demotion, that single idiom
buries the report. But demotion is restricted to the `class` and `style` attributes:

- `childList` / `characterData` differences are visible text and element changes — the most legible
  regression there is. Never demoted.
- Other attributes (`data-*`, `aria-*`, `disabled`, `href`) change behavior without changing
  appearance. Demoting them would hide precisely the regressions pixel diffing already misses.

## 11. Replay determinism

`addInitScript` stubs `Math.random`, `Date.now` / argument-less `new Date()`, and
`crypto.randomUUID` with fixed-seed implementations. `setTimeout` and `requestAnimationFrame` are
left on real time — animations must actually complete, or the resulting styles are unstable.

After each step the runner waits for `networkidle` (best-effort, with a timeout), then two
`requestAnimationFrame`s, then the configured `waitAfterStep`. Initial navigation uses
`domcontentloaded`, not `networkidle`, because a polling page never reaches network idle during
`goto`.

If a selector fails to resolve during replay, the runner **does not continue silently**. The
checkpoint is marked `unresolved`, excluded from comparison, and surfaced as a `StructuralIssue` at
the top of the report.

## 12. CLI

```
jqdiff record <url> -o <scenario.json>
jqdiff run <scenario.json> --baseline <url> --candidate <url> -o <outDir> [--headed]
jqdiff report <diff.json> -o <report.html>
```

`run` writes `baseline.trace.json`, `candidate.trace.json`, `diff.json`, and `report.html`, and
**exits 1 if there is any critical finding or any structural issue** — the CI gate.

## 13. Non-goals

- **Pixel diffing.** Deliberately excluded; §1 explains why.
- **Codemods or lint rules.** jqdiff detects regressions; it does not perform or police the migration.
- **Production traffic capture.** Scenarios come from a human operating the app, not from replayed
  production traffic.
- **Non-Chromium browsers.** Cross-browser rendering differences are a separate problem.
- **A rich report UI.** A single static HTML file with no external requests, openable straight from
  CI artifacts.

## 14. The guarantee, and how it is verified

`fixture/` contains one HTML page and one stylesheet shared by two implementations — `app.jquery.js`
and `app.native.js` — mirroring the real migration condition. The native version carries eight
regressions drawn from real incidents, individually enabled via `?traps=1,3,5`:

| # | Regression | Surfaces as |
|---|---|---|
| 1 | `.show()` rewritten to `style.display = 'block'` on a CSS `inline-flex` element | computed `display` (critical) |
| 2 | `return false` rewritten to `preventDefault()` only | event `propagationStopped` / `path` (critical) + parent handler side effect |
| 3 | `$.ajax` → `fetch`, losing `X-Requested-With` and the urlencoded body | network headers and body (critical) |
| 4 | `fetch` does not reject on 500, so the error handler never runs | missing error text (warning) |
| 5 | `.css('width', 300)` → `style.width = 300`, dropping the implicit `px` | computed `width` (warning) |
| 6 | jQuery's empty-set no-op becomes a `TypeError` on `querySelector(...)` | all subsequent DOM updates missing |
| 7 | Delegated handler registration order swaps | rendered text order (warning); *not* an event diff, by design |
| 8 | `.html()` executes `<script>`; `innerHTML` does not | `data-*` attribute mutation (warning) |

`tests/traps.spec.ts` asserts, for each trap, the expected finding kind, severity, and target — this
catches jqdiff failing to detect a regression.

It also asserts that **with all traps disabled, the diff contains zero findings and zero structural
issues.** This is the only evidence that the normalization rules are correct rather than merely
permissive, and it is the test that must never be weakened. Loosening it to make the suite green
would mean jqdiff misses production regressions for exactly the same reason.
