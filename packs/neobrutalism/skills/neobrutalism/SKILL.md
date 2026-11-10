---
name: neobrutalism
description: Neobrutalism design system — bold borders, hard offset shadows, vivid accents on warm surfaces. Use when restyling or reviewing an interface in neobrutalism, or when asked for brutalist, neo-brutalist or high-contrast blocky UI.
---

# Neobrutalism

A modern take on brutalism: bold borders, vivid accent colours, and raw,
high-contrast layouts on warm surfaces. Modern, clean, high-contrast.

Origin: typeui.sh, MIT. These values are the system — use them, do not
approximate them.

## Tokens

| Token | Value |
|---|---|
| primary | `#FDC800` |
| secondary | `#432DD7` |
| success | `#16A34A` |
| warning | `#D97706` |
| danger | `#DC2626` |
| surface | `#FBFBF9` |
| text | `#1C293C` |

**Type scale:** 13 / 15 / 17 / 21 / 27 / 35
**Fonts:** Inter (primary and display), JetBrains Mono (mono). Weights 100–900.
**Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32

## Standards

WCAG 2.2 AA. Keyboard-first interactions. Visible focus states.

## Rules

**Do:** use semantic tokens over raw values; preserve hierarchy; make states
explicit.

**Don't:** low-contrast text; inconsistent spacing rhythm; ambiguous labels.

## Component requirements

Every component defines **default, hover, focus-visible, active, disabled,
loading and error**, each with explicit spacing, typography and colour. State
keyboard, pointer and touch behaviour, and how it responds at small widths.

## Quality bar

- A rule references a token or a threshold. "Bold" and "generous" are not
  rules; `3px` and `4.5:1` are.
- Every accessibility claim is testable. "Accessible" is not a claim; "4.5:1
  against `#FBFBF9`" is.
- System consistency beats local optimisation. A component that looks better
  on its own and breaks the rhythm is worse.

## Anti-patterns

- Varying border weight between components. Pick one and hold it.
- Blurred shadows. The offset block is the idiom; a blur makes it generic.
- The accent as text colour. `#FDC800` is roughly 1.7:1 on white — it is a
  fill, a border or a highlight, never a letterform.
- Rounded pills. Square, or barely rounded.
- Restyling dense data with the full treatment. Borders and offsets cost
  space; tables and long forms pay for it in legibility.
