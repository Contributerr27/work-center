# Brief for an AI: make a Work Center theme

Give this file to your AI assistant (Claude Code, Cursor, ChatGPT…) with one line about the theme you want, for
example: *"Make a Work Center theme from docs/THEME-AI.md: a calm Japanese garden, moss green and paper white,
falling petals."* The rest of this file is written for the AI.

---

## Your task

Create a Work Center theme pack: a folder named after the theme's id that holds `theme.json`, `theme.css` and,
when it helps, a wallpaper image. The full format is in [THEMES.md](../THEMES.md); this page is the short version
plus the rules that make a theme look good. Theme packs are data only: never add JavaScript.

## Steps

1. **Pick the id and base.** `id` is 2–31 lowercase letters, digits or dashes. Choose `base`:
   - `normal` for most themes;
   - `winter` for a light, airy, frosted look with serif headings;
   - `vice` for a dark neon look with bold condensed headings.
2. **Choose a palette** of about 6 colors: background, panel, text, muted text, one accent, plus a green, amber and
   red that fit the mood. Text must stay readable: aim for a contrast of 4.5:1 or more between `--text` and
   `--panel`, and 3:1 for `--muted`.
3. **Write `theme.json`:**
   - all the tokens below, `swatches` (background, accent, second accent) and `orb.colors` (4 colors);
   - `effect` (`none`, `snow`, `sparks`, `stars` or `rain`), with `color` and `density`;
   - optional `terms` and `steps` wording.
4. **Write `theme.css`.** Start every selector with `:root[data-pack="<id>"]`. Use it for the background (gradients,
   or the wallpaper), see-through panels with a blur, and the primary button. Keep it under ~60 lines.
5. **Optional wallpaper.** Use a 2560×1440 or larger `wallpaper.jpg`. It must be your own or freely licensed: no
   copyrighted art, no game or film stills, no logos. A CSS gradient wallpaper (see `theme-packs/aurora`) is
   always safe.
6. **Check your work** against the list at the end, then tell the person to install the folder from
   **Theme → ＋ Install theme…**.

## theme.json template

```json
{
  "id": "garden",
  "name": "Garden",
  "description": "Moss, paper and falling petals",
  "author": "",
  "version": "1.0.0",
  "base": "normal",
  "swatches": ["#f4f1ea", "#4f7a4a", "#c98a9a"],
  "tokens": {
    "--bg": "#f4f1ea", "--panel": "rgba(255, 253, 248, .86)", "--line": "#e2dccf",
    "--text": "#23281f", "--muted": "#6d7466", "--soft": "#ece7dc",
    "--blue": "#4f7a4a", "--blue-bg": "#e3ecdf",
    "--green": "#3d7a4f", "--green-bg": "#e1efe4",
    "--amber": "#a8782a", "--amber-bg": "#f6ecd6",
    "--red": "#b5485a", "--red-bg": "#f7e3e6",
    "--violet": "#8a5d8f", "--violet-bg": "#efe5f0",
    "--grey-bg": "#e8e3d8",
    "--shadow": "0 1px 2px rgba(35, 40, 31, .06), 0 8px 24px rgba(35, 40, 31, .06)",
    "--glass": "rgba(255, 253, 248, .72)", "--glass-line": "rgba(255, 255, 255, .7)", "--glass-blur": "blur(16px) saturate(1.2)"
  },
  "orb": { "colors": ["#4f7a4a", "#9cc39a", "#ffffff", "#c98a9a"] },
  "effect": { "kind": "sparks", "color": "#e7a9b7", "density": 0.6 },
  "terms": { "day": "Today's garden", "score": "Growth", "board": "Garden log", "step": "Bed", "passed": "Bed tended", "wrap": "Close the gate" },
  "steps": { "github": "Prune", "health": "Check the soil", "jira": "Plan the beds", "slack": "Visitors", "work": "Plant", "meet": "Tea" },
  "css": "theme.css"
}
```

- **What `--blue` is for.** It is the accent used for links, the current step and the primary button. Set it to
  your theme's accent even when that isn't blue.
- **Wording keys.** `terms` and `steps` take only the keys shown in THEMES.md; any you leave out come from the base theme.

## theme.css template

```css
:root[data-pack="garden"] {
  --view-bg: radial-gradient(90% 60% at 10% 0%, rgba(156, 195, 154, .35), transparent 60%),
             linear-gradient(180deg, #f6f3ec, #efe9dd);
}
:root[data-pack="garden"] body { background: var(--view-bg); background-attachment: fixed; }
:root[data-pack="garden"] .panel, :root[data-pack="garden"] .tile, :root[data-pack="garden"] #side {
  backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2);
}
:root[data-pack="garden"] .btn.go { background: #4f7a4a; border-color: #4f7a4a; color: #fff; }
```

## Rules that keep a theme looking professional

- **Restrained color.** One accent, used for what matters (the current step, primary buttons). Everything else is
  neutral.
- **Readable panels.** If the wallpaper is busy, make `--panel` at least 80% opaque, or add a `--wallpaper-tint`
  gradient.
- **Calm motion.** Effects at `density` 0.4–1. No flashing.
- **Sharp edges, not side stripes.** Never add a thick colored border on one side of a card. No gradient text.
- **No outside resources.** No `@import` and no web URLs; the app removes them. Fonts and images must live in the
  theme folder.
- **No code.** A theme pack has no JavaScript.
- **Original or free assets only**, with no logos or trademarks.

## Before you hand it over

- [ ] `theme.json` is valid JSON with no comments; `id` matches the folder name and every CSS selector.
- [ ] Text on panels passes 4.5:1 contrast; muted text passes 3:1.
- [ ] Buttons, pills (green, amber, red) and links are all readable on `--panel`.
- [ ] Every file is one of `.json .css .png .jpg .jpeg .webp .woff .woff2 .md .txt`, and the folder is under 30 MB.
- [ ] Tell the person: **Theme → ＋ Install theme…**, then pick the folder.
