# Vendored frontend assets (no npm/CDN at runtime)

| File | Version | Source | Used by |
| --- | --- | --- | --- |
| `plot-0.6.17.min.js` | 0.6.17 | `https://esm.sh/@observablehq/plot@0.6.17/es2020/plot.bundle.mjs` | every chart module (`import * as Plot`); d3 inlined |
| `alpine-3.14.8.min.js` | 3.14.8 | `https://unpkg.com/alpinejs@3.14.8/dist/cdn.min.js` | `base.html` (`<script defer>`) |
| `fonts/inter/inter-variable.woff2` | 5.0.18 | `@fontsource-variable/inter` latin wght-normal | `@font-face Inter` in input.css |
| `fonts/mana-font/*` | 1.18.0 | `mana-font` | `.ms .ms-w/u/b/r/g` mana pips |

Version is in the path/filename → no `?v=` cache-buster on these. NO d3 vendored (no geo maps).
