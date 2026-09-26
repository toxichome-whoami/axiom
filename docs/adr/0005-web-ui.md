# ADR 0005: Web UI Technology Stack

Status: Accepted
Date: 2026-09-27

## Problem
Axiom needs an administrative Web UI for managing keys, roles, databases, cache, logs, and metrics. The UI must be embeddable in the binary with no external runtime dependencies.

## Options Considered
- A: SvelteKit — small bundles, good DX, framework runtime in bundle.
- B: Vite + TypeScript + Tailwind CSS — no framework runtime, maximum control.
- C: HTMX — minimal JS but requires server-side HTML rendering in the Rust binary.

## Decision
Option B: Vite + TypeScript + Tailwind CSS.

## Why
- No framework runtime overhead in the bundle.
- Tailwind + PurgeCSS produces minimal CSS.
- Pure client-side app calling the Admin API — zero server-side HTML generation in Rust.
- Bundle embedded in binary via rust-embed, served at /ui/.
- Consistent with the principle: every dependency must justify its cost.

## Design Constraints
- Target bundle: < 200KB gzipped.
- No gradients, animations, or decorative elements.
- Dense information display. Monospace type for technical values.
- Design reference: Vercel/Linear/Cloudflare infrastructure dashboards.

## Consequences
- Phase 7 implements the Web UI.
- `ui/` directory contains the Vite project.
- `cargo build --release` triggers the Vite build and embeds the bundle via rust-embed.
