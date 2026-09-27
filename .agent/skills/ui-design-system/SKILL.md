---
name: ui-design-system
description: Design tokens, principles, and definition of done for generating Web UI components in the Axiom dashboard (Vercel & Cloudflare inspired). Use this skill whenever building frontend components to ensure consistency with Phase 7 requirements.
---

# Axiom Web UI Design System
**Status:** Approved for v4.0 Phase 7 (Web UI)
**Inspiration:** Vercel & Cloudflare Dashboards

## Overview
**Product:** Axiom Admin Dashboard
**Audience:** Database administrators, developers, and DevOps engineers.
**Brand character:** Data-driven application interface, high-density, single-typeface typography.

### Design Principles
- **Data visibility** — the most important metric should be visible without interaction.
- **Progressive disclosure** — surface summaries, reveal detail on demand.
- **Efficiency over decoration** — every pixel should communicate state or enable action.

---

## 1. Tokens and Foundations

### Typography
**Font stack:** GeistSans / Inter Variable

| Level | Size | Usage |
|-------|------|-------|
| text-xs | 11px / 12px | Captions, metadata, small labels |
| text-sm | 14px | Input labels, secondary text |
| text-base | 16px | Body text (default) |
| text-xl | 30px | Section headings |

**Weight scale:** 400 (Regular) · 500 (Medium) · 600 (Semibold)

### Spacing
**Base unit:** 4px (Tailwind standard)

`space-1: 4px` · `space-2: 8px` · `space-3: 12px` · `space-4: 16px` · `space-5: 20px` · `space-6: 24px` · `space-8: 32px`

### Colors (Vercel / Cloudflare Blend)

| Token (Tailwind equivalent) | Hex Value | Role |
|-----------------------------|-----------|------|
| `bg-background` | `#1F1F1F` | App background (Dark mode) |
| `bg-surface` | `#454545` | Card/Surface background |
| `text-primary` | `#F5F5F5` | Main text |
| `text-secondary` | `#A1A1A1` | Helper text, metadata |
| `border-default` | `#858585` | Standard borders, dividers |
| `border-focus` | `#F59E0B` | Input focus rings (Amber) |
| `accent-primary` | `#F6821F` | Cloudflare Orange accent |
| `accent-secondary` | `#4693FF` | Blue accent |
| `accent-danger` | `#AE292F` | Destructive actions |

### Shapes & Radii
- `radius-md: 4px` (Inputs, small buttons)
- `radius-lg: 6px` (Cards, dialogs)
- `radius-full: 9999px` (Badges, toggles)

### Elevation & Shadows
- **shadow-sm:** `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px` (Buttons, inputs)
- **shadow-md:** `rgba(0, 0, 0, 0.1) 0px 4px 6px -1px` (Dropdowns, popovers)
- **shadow-lg:** `rgba(0, 0, 0, 0.16) 0px 8px 16px -4px` (Modals)

---

## 2. Authoring Workflow & Requirements

When building React/Svelte components for the Axiom dashboard using Tailwind CSS, follow these rules strictly:

### Do's
- Use Tailwind utility classes that map directly to the tokens above (e.g., `text-sm`, `rounded-md`, `border-gray-500`).
- Define all interactive states: `hover:`, `focus-visible:`, `active:`, `disabled:`.
- Write content in sentence case. Reserve ALL CAPS for acronyms only.
- Test every component at mobile and desktop breakpoints.

### Don'ts
- **No arbitrary values:** Do not use `w-[17px]` or `bg-[#123456]`. Use the tailwind theme.
- **No mixed radii:** Stick to `rounded-md` or `rounded-lg`.
- **No decorative shadows:** Shadows are for Z-index elevation only (dropdowns, modals). Data tables and flat cards should use borders, not shadows.

### Writing Tone
Efficient, data-forward, action-oriented. Labels over sentences. 
- *Good:* "Database Alias"
- *Bad:* "Please enter the name of your database here"

---

## 3. Component Definition of Done

A component is not complete until every item below is checked:
- [ ] Renders correctly in its default state (smoke test).
- [ ] All states documented and visually verified (hover, focus, disabled, loading, error, empty).
- [ ] All visual values use design tokens (Tailwind classes) — zero hardcoded hex/px values.
- [ ] Keyboard navigation works without a pointer (Tab, Enter, Escape).
- [ ] Accessible (ARIA roles where necessary, focus rings visible with `focus-visible:ring`).
- [ ] Responsive behavior is defined.
