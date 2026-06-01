/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/templates/**/*.html", "./app/static/js/**/*.js"],
  // darkMode left default; theme flip is CSS-variable driven via [data-theme], not `dark:`.
  theme: {
    extend: {
      maxWidth: { "screen-xl": "1200px" },
      colors: {
        paper: "var(--body-bg)",
        surface: "var(--surface-card)",
        soft: "var(--surface-soft)",
        ink: "var(--text-primary)",
        body: "var(--text-body)",
        muted: "var(--text-muted)",
        line: "var(--border-default)",
        mtgblue: "var(--mtg-blue)",
        mtggreen: "var(--mtg-green)",
        mtgred: "var(--mtg-red)",
        mtggold: "var(--mtg-gold)",
        mtgblack: "var(--mtg-black)",
        mtgwhite: "var(--mtg-white)",
      },
      fontFamily: {
        body: ['"Inter"', "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "sans-serif"],
      },
    },
  },
  safelist: ["active", "is-selected", "podium-1", "podium-2", "podium-3"],
  plugins: [],
};
