# Perspective — the house design system

From https://github.com/bergside/awesome-design-skills (skills/perspective), by typeui.sh, MIT.

> "This style moves beyond flat design by employing techniques like isometric
> views, vanishing points, and layered elements to guide the user's attention
> and create a sense of realism or 'spatial' depth."

## Foundations, as specified

| | |
|---|---|
| Type scale | 12 / 14 / 16 / 20 / 24 / 32 |
| Fonts | primary Poppins · display Oswald · mono JetBrains Mono · weights 100–900 |
| Palette | primary `#00BD7D` · success `#16A34A` · warning `#D97706` · danger `#DC2626` · surface `#FFFFFF` · text `#111827` |
| Spacing | 4 / 8 / 12 / 16 / 24 / 32 |
| Accessibility | WCAG 2.2 AA, keyboard-first, visible focus |
| Tone | concise, confident, helpful |

**Do:** semantic tokens over raw values · preserve visual hierarchy · keep
interaction states explicit.

**Don't:** low-contrast text · inconsistent spacing rhythm · ambiguous labels.

## How we apply it

**Mobile first.** Base styles are the phone. Everything above 390px is a
`min-width` query adding room, never a `max-width` query taking it away. The
judge checks the phone first for that reason.

**Depth is structural, not decorative.** Three planes and no more: the page
sits at the back, cards lift off it, and chrome floats above both. A shadow
says which plane a thing is on; it is not a texture.

**`#00BD7D` is a fill, never body text.** It is 2.4:1 on white, which fails AA
outright. Text is `#111827` on light and near-white on dark; the primary is for
surfaces, marks and focus rings, where contrast is judged differently.

**Apple's interaction rules still hold.** Perspective says how it looks;
`docs/` and the judge say how it behaves — springs from damping and response,
feedback on pointer-down, reduced motion honoured. The two do not conflict:
one is the surface, the other is the hand.
