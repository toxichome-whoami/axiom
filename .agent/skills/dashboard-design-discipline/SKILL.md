---
name: dashboard-design-discipline
description: Mandatory visual design rules for AI agents building or editing dashboards and app UIs — locked typography, color, spacing, and component tokens in the technical-minimal style of Vercel, Linear, GitHub, Cloudflare. Bans AI-slop visuals outright. Activate on any UI, dashboard, or component work.
---

# Dashboard Design Discipline

You build UIs in the technical-minimal style of Vercel, Linear, GitHub, and Cloudflare:
quiet, precise, information-dense. All tokens below are LOCKED — use them exactly, no
improvising values, no third colors, no new fonts. If a situation isn't covered, extend
the nearest existing pattern, don't invent one.

## 1. Banned on Sight (AI-slop — never output)
Purple/blue gradients, aurora/mesh backgrounds, glassmorphism, glow orbs, rounded-3xl
cards, decorative shadows, emoji icons, mixed icon styles, colored text on colored
backgrounds, Inter 800 headings, hero-sized text in app surfaces, hover:scale, animated
gradient text, stock illustrations, cards-in-cards, zebra tables, neon accents.

## 2. Locked Typography
- **Sans:** Inter (or Geist — pick ONE per project, never both). Weights loaded: 400, 500, 600. Never 700/800.
- **Mono:** JetBrains Mono (or Geist Mono) — IDs, timestamps, metrics, code, numbers in tables.
- Font-feature: `tabular-nums` on all numeric data; `-0.01em` letter-spacing at 13–16px.

| Token | Size | Weight | Line-height | Use |
|---|---|---|---|---|
| text-xs | 12px | 500 | 16px | timestamps, meta, axis labels, badges |
| text-sm | 13px | 400 | 18px | table body, sidebar, dense UI |
| text-base | 14px | 400 | 20px | default body, inputs, buttons, cards |
| text-md | 16px | 500 | 24px | section labels, emphasis |
| text-lg | 20px | 600 | 28px | page title ONLY (one per page) |
| text-xl | 24px | 600 | 32px | modal headers, empty-state numbers — max size inside app |

## 3. Locked Color (light / dark)
- Background: `#FFFFFF` / `#0A0A0A`
- Surface (cards, popovers): `#FAFAFA` / `#111111`
- Hover surface: `#F5F5F5` / `#1A1A1A`
- Border (hairline only): `#EBEBEB` / `#262626`
- Text primary: `#171717` / `#EDEDED`
- Text secondary: `#525252` / `#A3A3A3`
- Text muted: `#A3A3A3` / `#666666`
- **Accent: ONE only** — default `#2563EB` (swap once per project if brand demands, then
  lock it). Accent usage: primary button, links, active nav, focus ring. NOTHING else.
- Status: green `#16A34A`, amber `#D97706`, red `#DC2626` — as 8px dots or text ONLY.
  Never status-colored backgrounds, never badges with heavy fills. Use tinted bg only at
  8% opacity for one subtle pill.
- No other colors exist. If you reach for one, map it to the nearest token above.

## 4. Locked Spacing & Shape
- 4px grid only: 4, 8, 12, 16, 24, 32, 48. Kill odd values (14, 18, 22).
- Card padding: 16px. Page gutter: 24px (desktop) / 16px (mobile). Section gaps: 24px.
- Radius: 6px cards/inputs, 8px large surfaces/modals, 999px only pills/tags/avatars.
- Borders: 1px solid border-token. Shadows: none by default; at most one subtle
  `0 1px 2px rgba(0,0,0,0.06)` on popovers. Prefer borders everywhere.

## 5. Component Source: coss.com/ui (LOCKED)
- ALL components come from https://coss.com/ui/ — copy the source into the project
  (its model: copy-paste, own the code; Base UI primitives + Tailwind). No npm-install
  component libraries, no hand-rolled div widgets.
- Mapping: Button, Input, Select, Dialog, Sheet, Table, Tabs, Badge, Card, Toast, Tooltip,
  Skeleton, Dropdown Menu, Pagination, Empty, Kbd — all from coss ui.
- Rule: take the coss ui source VERBATIM first, then adapt it to the locked tokens in
  sections 2–4 (their default theme is close to this skill's palette — replace their
  CSS variable values with the locked hex values, don't restyle component internals).
- Never mix component sources: no shadcn + coss hybrids, no MUI/AntD alongside coss.
- Missing component not on coss ui? Build it FROM coss primitives (Button/Dialog/etc.),
  following the same patterns — never import a second library to fill the gap.

## 6. Locked Component Patterns
- Button: height 32px (sm) / 36px (default), radius 6px, 14px/500 text, accent bg (primary)
  or border-token bg-transparent (secondary). No gradients, no glow, no scale on hover —
  hover = 5% darker or border darkens.
- Input: height 36px, hairline border, 12px horizontal padding, focus = 2px accent ring.
  Labels 13px/500 above, never inside as placeholder-only.
- Card: flat, hairline border, 6px radius, 16px padding. No shadow, no gradient header.
- Table: the core pattern — 13px rows, 36px row height, hairline row borders, mono for
  metrics, numbers right-aligned, no zebra, no card wrapper, sticky header at 12px/500 muted.
- Nav/sidebar: 13px items, 12px padding, active = accent text-left + 2px accent indicator
  bar, or tinted 8% accent row — never filled pills. Collapse to drawer <1024px.
- Badge/tag: 12px/500, radius 999px, 8% tinted bg + matching text. Max one per row.
- Icons: one set only (lucide), 16px, 1.5px stroke, `currentColor`. Never emoji.
- Charts: hairline gridlines only, accent + grays series, no gradients under lines,
  no 3D, axis labels at text-xs muted.

## 7. Motion
150–200ms ease-out, opacity + translateY(2px) at most. No scale, no spring, no stagger
cascades. Respect `prefers-reduced-motion`.

## 8. Real-World Reference Study (MANDATORY before building any screen)
Before building or redesigning ANY dashboard screen, study how the benchmark products
solve that exact screen. Do not design from imagination — pattern-match from proven UI.

- **References to consult (in order):**
  1. Vercel dashboard (deployments list, project settings) — tables, status pills, logs
  2. Cloudflare dashboard (analytics, Workers) — data-dense pages, charts, side nav
  3. GitHub (repo home, issues, PR checks) — activity feeds, file tables, states
  4. Linear (issue list, inbox) — the gold standard for list density and keyboard UX
  5. Supabase (table editor, auth) — forms + data tables
  6. Stripe / Render / Fly.io dashboards — settings pages, billing, metrics

- **Method per screen:**
  1. Identify what the screen is: list view / detail view / settings / analytics / form
  2. Recall the matching screen from the benchmarks above and mirror its LAYOUT
     structure: what's in the header row, sidebar or tabs, primary action placement,
     how rows/cards/empty states are composed, information hierarchy top-to-bottom
  3. Adapt the benchmark's layout to our locked tokens (fonts/sizes/colors from
     sections 2–4) — we copy STRUCTURE, never branding
  4. If genuinely unsure how a pattern should look, open the reference site and look —
     do not invent

- **What to steal vs. what to skip:**
  - STEAL: layout structure, density, spacing rhythm, where actions live, how states
    (loading/empty/error) are presented, table patterns
  - SKIP: their brand colors, logos, illustrations, marketing sections

- **Report:** in your response, name the reference(s) used per screen, e.g.
  "Deployments page → Vercel dashboard layout; Settings → Stripe pattern."

## 9. Pre-Delivery Check (run on every UI output)
1. Any hex outside the locked palette? Any radius not 6/8/999?
2. Any font size outside the scale? Any weight not 400/500/600?
3. Any gradient, shadow-as-decoration, emoji, or glow anywhere?
4. Does every screen have exactly one text-lg title and zero text-xl+?
5. Numbers in tables mono + tabular + right-aligned?
6. Touch targets ≥44px, hover never required, focus ring visible?
7. Every component traceable to a coss.com/ui source (verbatim or built from its
   primitives), and every screen has a named real-world reference?

If any answer fails, fix before delivering.

## 10. Anti-Patterns — Instant Self-Correction
- Introducing a second accent "for contrast"
- Rounding everything "friendly"
- Making the empty state an illustration with a headline
- Styling the happy path and forgetting loading/error/skeleton states (they use the
  same tokens — skeleton = surface bg + hairline)
