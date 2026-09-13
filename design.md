# 🎨 CricketHub — Design System & 21st.dev UI Architecture

---

## 1. Design Philosophy & 21st.dev Aesthetics
- **Dark Mode First**: Deep charcoal backgrounds (`#080c14`, `#0d1117`) paired with translucent glassmorphic surfaces (`rgba(255, 255, 255, 0.04)`).
- **Vibrant Accent Glows**: Neon cyan (`#00e5ff`), energetic electric purple (`#7c4dff`), warning amber (`#ffd740`), and pitch grass green (`#00e676`).
- **Tactile Micro-Press Physics**: Interactive elements respond with subtle press downscaling (`:active { transform: scale(0.975); }`).
- **Mobile Thumb Ergonomics**: All actionable buttons are positioned within thumb reach with min 44px hit targets.

---

## 2. Color Palette & Design Tokens

| Token | Hex / CSS Value | Semantic Usage |
| :--- | :--- | :--- |
| `--bg-main` | `#080c14` | Global root page background |
| `--surface-glass` | `rgba(22, 25, 34, 0.75)` | Translucent card containers with `backdrop-filter: blur(16px)` |
| `--border-glass` | `rgba(255, 255, 255, 0.08)` | Subdued card border lines |
| `--primary` | `#00E5FF` | Primary action buttons, active states, and cyan glows |
| `--accent` | `#7C4DFF` | Secondary gradients and group highlights |
| `--success` | `#00E676` | Live presence dots, Coming status, and winning highlights |
| `--warning` | `#FFD740` | Maybe status, Quiet mode alerts, and pending notices |
| `--danger` | `#FF5252` | Out dismissals, player removal, and reject buttons |
| `--text-1` | `#F8FAFC` | Primary high-contrast text |
| `--text-2` | `#94A3B8` | Secondary labels and metadata |
| `--text-3` | `#64748B` | Disabled / subtle hint text |

---

## 3. Typography Hierarchy

- **Headings & Numbers**: `Rajdhani` (Semi-bold / Bold, Google Font) for match scores, overs, run rates, and section headers.
- **Body & Controls**: `Inter` and `Outfit` (400 / 500 / 600 / 700) with subpixel anti-aliasing for legibility on retina mobile displays.

---

## 4. Component Standards

### 4.1. Privacy Consent Banner & Preferences Card
- Floating glassmorphic card anchored at bottom viewport (`bottom: 16px`, `max-width: 520px`).
- Subtle radial glow border (`box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 229, 255, 0.1)`).
- Custom toggle switches for granular category selection with smooth slider transitions.

### 4.2. Squad Availability Grid Cards (`.rsvp-card`)
- Dedicated top row for Player Avatar + Name + Live Badge (`🟢 Live Now` / `⚪ Offline`).
- Action toolbar (`.rsvp-card-actions`) cleanly separated under card header to prevent clipping on 360px mobile viewports.
