# Making a Work Center theme

A theme is a folder (or a .zip of one) that anyone can build and install. No code is needed and none is allowed: a theme is a description file, optional CSS and optional pictures.

**Install:** open **Theme** in the sidebar, choose **＋ Install theme…**, then pick the folder or the .zip. Installed themes go to `~/.daily-hq/themes/<id>/`, and **Themes folder** in the same menu opens that folder. To remove an installed theme, click the **×** next to it in the menu.

The app comes with an example theme, `theme-packs/aurora`. Copy it to start your own.

## The folder

```
my-theme/
  theme.json      required: name, colors, wording, effect
  theme.css       optional: your own styling
  wallpaper.jpg   optional: background picture (.jpg, .png or .webp)
  logo.png        optional: sidebar logo, 128×128
  icon.png        optional: app and Dock icon, 1024×1024 on the macOS icon grid
```

Allowed file types: `.json .css .png .jpg .jpeg .webp .woff .woff2 .md .txt`. A theme can be at most 30 MB.

## theme.json

```json
{
  "id": "aurora",                    // 2–31 characters: lowercase letters, digits, dashes
  "name": "Aurora",
  "description": "Northern lights over a night sky",
  "author": "You",
  "version": "1.0.0",
  "base": "normal",                  // start from: normal, vice or winter
  "swatches": ["#0b1526", "#3ee6b0", "#8a7dff"],   // three colors shown in the theme menu
  "tokens": { "--bg": "#0b1526", "--panel": "rgba(16,28,48,.78)", "--text": "#e8f3ff" },
  "orb": { "colors": ["#3ee6b0", "#6cc8ff", "#e8fff6", "#8a7dff"] },
  "effect": { "kind": "stars", "color": "#dff3ff", "density": 0.8 },
  "terms": { "day": "Tonight", "score": "Glow" },
  "steps": { "github": "First Glow", "work": "The Display" },
  "icons": { "orb": "<path d=\"M3 15c3-6 6-8 9-8s6 2 9 8\"/>" },
  "css": "theme.css",
  "wallpaper": "wallpaper.jpg"
}
```

The real file must be plain JSON: drop the `//` comments, which are only here to explain the fields.

### base

Your theme starts as a copy of one of the built-in themes, and everything you set changes it from there.
- `winter` brings the frosted glass, the snowy orb and the Winter wording.
- `vice` brings the neon glass, the sunset orb and the missions wording.
- `normal` is plain and works in both light and dark mode.

### tokens

These are the colors and surfaces the whole app uses:

| Token | Used for |
|---|---|
| `--bg` | page background |
| `--panel` | cards |
| `--line` | borders |
| `--text` | main text |
| `--muted` | secondary text |
| `--soft` | subtle fills |
| `--blue`, `--blue-bg` | accent and links |
| `--green`, `--green-bg` | done and good |
| `--amber`, `--amber-bg` | warnings |
| `--red`, `--red-bg` | blocked and failed |
| `--violet`, `--violet-bg` | AI |
| `--grey-bg` | neutral chips |
| `--shadow` | card shadow |
| `--glass` | see-through panel fill (with a wallpaper) |
| `--glass-line` | see-through panel border |
| `--glass-blur` | blur behind see-through panels, e.g. `blur(16px)` |
| `--view-bg` | background of the full views (Home, Projects, HR, AI Center) |
| `--wallpaper-tint` | a gradient laid over your wallpaper, e.g. `linear-gradient(rgba(0,0,0,.3), rgba(0,0,0,.6))` |

Values can be colors, gradients, lengths or shadows. They cannot use `url()`; set the wallpaper with the `wallpaper` field instead.

### orb

Up to four colors for the AI bubble's ring and core.

### effect

A moving effect drawn behind the page:
- `kind`: one of `none`, `snow`, `sparks` (rising embers), `stars` (twinkling) or `rain`.
- `color`: the effect's color.
- `density`: from `0.2` to `2`.

It switches off automatically when the person has asked their Mac to reduce motion.

### terms and steps

Your own wording.
- `terms` keys: `day`, `score`, `board`, `step`, `stepsDone`, `passed`, `wrap`, `wrapTitle`, `messages`, `focus`, `perDay`, `bugs`, `stories`, `debrief`, `weekly`.
- `steps` renames the day's steps: `github`, `health`, `jira`, `slack`, `work`, `meet`.
- Anything you leave out comes from the base theme.

### icons

Replace any sidebar or orb icon with your own SVG drawing on a 24×24 grid. The drawing is drawn with a stroke and no fill, like the built-in icons.
- Names: `home`, `day`, `projects`, `growth`, `ai`, `focus`, `autopilot`, `wrap`, `score`, `messages`, `theme`, `settings`, `orb`, `refresh`, `scan`, `close`.
- Allowed shapes: `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon` and `g`. Allowed attributes cover their geometry plus fill and stroke; anything else is removed.

## theme.css

Write whatever CSS you like, but put `:root[data-pack="<your id>"]` in front of every rule so it only applies while your theme is on:

```css
:root[data-pack="aurora"] .btn.go { background: linear-gradient(135deg, #2bd4a0, #5bb8ff); }
```

Rules:
- `url()` may only point at files inside your theme folder, such as `url(images/glow.png)` or `url(fonts/my.woff2)`.
- Links to the web, `@import` and other app files are removed.

Useful selectors:
- `body`
- `#side` (the sidebar)
- `.panel` and `.tile` (cards)
- `.btn`, with `.btn.go` for primary buttons
- `#aib-fab` (the AI bubble), and inside it `.orb-ring`, `.orb-core`, `.orb-spark` and `.orb-ic`
- `#home-ov`, `#prj-ov`, `#hr-ov` and `#aic-ov` (the full views)

## Sharing

Zip the folder and send it. Whoever receives it installs it with **＋ Install theme…**. If a theme has a problem (bad JSON, a missing name, a file type that isn't allowed), the menu shows a ⚠ line with the reason, and the install itself stops with the same message.
