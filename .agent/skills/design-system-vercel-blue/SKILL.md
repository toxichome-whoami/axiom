---
name: design-system-vercel-blue
description: >
  Mandatory design system for this project's dashboard UI — Vercel-grade technical
  minimalism with a locked blue accent palette, Inter typography, and clean tokens.
  Activate on every UI, component, layout, or styling task. Bans AI-slop visuals.
---

# Design System — Vercel-Grade, Blue Accent

You build dashboards in the style of Vercel and Cloudflare: quiet, dense, precise.
All tokens below are LOCKED. Design decisions are already made — your job is correct
execution, not creativity.

## 1. Banned on Sight (AI-slop — never output)
Purple/indigo gradients, aurora backgrounds, glassmorphism, glow orbs, glass cards,
rounded-3xl anything, decorative shadows, emoji icons, mixed icon sets, colored text
on colored backgrounds, font weight ≥700, hero text inside app surfaces,
hover:scale / scale animations, zebra tables, cards-in-cards, neon accents,
badge walls of every-stat-is-a-big-number.

## 2. Color (LOCKED — the entire palette)

| Token | Value | Use |
|---|---|---|
| bg | `#0A0A0A` | Page background (dark-first) |
| surface | `#111111` | Cards, panels, popovers, inputs |
| surface-hover | `#1A1A1A` | Hover rows, hover cards |
| border | `#262626` | All hairlines — the ONLY divider |
| text-primary | `#EDEDED` | Primary text |
| text-secondary | `#A3A3A3` | Labels, metadata, table headers |
| text-muted | `#666666` | Timestamps, disabled, axis labels |
| **accent** | `#4693FF` | Links, primary button, active nav, focus ring, charts |
| accent-hover | `#2F81F7` | Hover state of accent elements |
| accent-soft | `rgba(70,147,255,0.1)` | Selected rows, active pill bg — 10% only |
| success | `#3FB950` | Status dot/text ONLY |
| warning | `#D29922` | Status dot/text ONLY |
| danger | `#F85149` | Status dot/text + destructive button ONLY |

Rules: exactly ONE accent. Status colors never fill backgrounds (dot + text, or 10%
tint pill at most). No other colors exist — map everything to the nearest token.

## 3. Typography (LOCKED)
- **Sans:** Inter everywhere. Weights loaded: 400, 500, 600 only. Never use monospace font unless explicitly requested by the user.
- Tracking: `-0.01em` at 13–16px. `font-feature-settings: "tabular-nums"` on all numeric data.

| Token | Size / Line | Weight | Use |
|---|---|---|---|
| text-xs | 12px / 16px | 500 | Timestamps, metadata, badges, axis labels |
| text-sm | 13px / 18px | 400 | Table body, sidebar, dense UI text |
| text-base | 14px / 20px | 400 | Default: buttons, inputs, cards, nav |
| text-md | 16px / 24px | 500 | Section labels, emphasized values |
| text-lg | 20px / 28px | 600 | Page title — ONE per page, nothing bigger |

## 4. Spacing & Shape (LOCKED)
- 4px grid: 4, 8, 12, 16, 24, 32, 48.
- Card padding 16px · page gutter 24px · section gap 24px · table row height 36–40px
- Radius: 6px cards/inputs/buttons · 8px modals/large surfaces · 999px pills/tags/avatars ONLY
- Dividers: 1px `border` hairline. Shadows: none by default; popovers may use `0 4px 12px rgba(0,0,0,0.4)` — that is the only shadow in the system.
- Motion: 150–200ms, cubic-bezier(0.4, 0, 0.2, 1), opacity + 2–4px translate only. No scale, no spring. Respect prefers-reduced-motion.

## 5. Components
- **Button:** 32/36px height, radius 6px, 14px/500. Primary = accent bg (`#4693FF`), dark text (`#0A0A0A`). Secondary = surface bg (`#111111`) + border (`#262626`). Ghost = transparent, text-secondary. Hover = `#2F81F7` (primary), never scale/glow.
- **Input/Select:** 36px, surface bg, border, radius 6px, focus = 2px accent ring. Label 13px/500 above — never placeholder-as-label.
- **Card:** flat, border, radius 6px, 16px padding. Never shadow, never gradient.
- **Table (core pattern):** text-sm rows, hairline row borders, tabular numbers right-aligned (Inter font), sticky text-xs/500 muted header, hover = surface-hover row. No zebra, no card wrapper. Status = colored dot + text, never colored rows.
- **Nav/sidebar:** 240px, text-sm items, 12px padding, text-secondary default, text-primary + 2px accent left indicator (`border-l-2 border-[#4693FF] bg-[#4693FF]/10`) when active. Drawer below 1024px.
- **Badge/tag:** text-xs/500, radius 999px, accent-soft or gray tint bg. Max one per row.
- **Icons:** lucide only, 16px, stroke 1.5, currentColor. Never emoji.
