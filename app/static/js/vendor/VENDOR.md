# Vendored frontend assets (no npm/CDN at runtime)

| File | Version | Source | Used by |
| --- | --- | --- | --- |
| `plot-0.6.17.min.js` | 0.6.17 | `https://esm.sh/@observablehq/plot@0.6.17/es2020/plot.bundle.mjs` | every chart module (`import * as Plot`); d3 inlined |
| `alpine-3.14.8.min.js` | 3.14.8 | `https://unpkg.com/alpinejs@3.14.8/dist/cdn.min.js` | `base.html` (`<script defer>`) |
| `mathjax-3.2.2/es5/tex-chtml.js` (+ `es5/output/chtml/fonts/woff-v2/*.woff`) | 3.2.2 | npm `mathjax@3` tarball (`registry.npmjs.org/mathjax/-/mathjax-3.2.2.tgz`) | `methods.html` (`<script>`) — renders LaTeX |
| `fonts/inter/inter-variable.woff2` | 5.0.18 | `@fontsource-variable/inter` latin wght-normal | `@font-face Inter` in input.css |
| `fonts/mana-font/*` | 1.18.0 | `mana-font` | `.ms .ms-w/u/b/r/g` mana pips |

Version is in the path/filename → no `?v=` cache-buster on these. NO d3 vendored (no geo maps).

MathJax: only the `tex-chtml` combined component is vendored (TeX input → CommonHTML output) — the page authors all maths in LaTeX, so the MathML-input bundle (`tex-mml-chtml`) and the SVG-output fonts are not needed. The 23 `.woff` files under `es5/output/chtml/fonts/woff-v2/` are the CHTML font set; MathJax loads them on demand from a path it derives relative to `tex-chtml.js`, so the `es5/` layout must be preserved. To upgrade: re-extract those two paths from the npm tarball into a new `mathjax-<version>/` dir and bump the `<script src>` in `methods.html`.
