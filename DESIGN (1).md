# Design System Specification: The Academic Curator

## 1. Overview & Creative North Star
This design system is built upon the **"Academic Curator"** creative north star. In the context of a college queue management system, we move away from the chaotic, high-stress atmosphere of traditional waiting rooms and toward a sophisticated, editorial-inspired dashboard. 

The system rejects the "template" aesthetic—characterized by rigid grids and harsh borders—in favor of **Layered Authority**. By utilizing intentional asymmetry, overlapping surface tiers, and a high-contrast typographic scale (Manrope for headers, Inter for data), we create an environment that feels both authoritative (Deep Navy, represented by the primary color) and approachable (subtle roundedness). The goal is to provide staff with a sense of calm control during peak surge periods through visual breathing room and tonal depth.

---

### 2. Colors & Surface Logic

We leverage a sophisticated palette where color is used for "meaning," and tonal shifts are used for "structure."

#### The "No-Line" Rule
To achieve a premium, high-end feel, **1px solid borders are strictly prohibited** for sectioning. Boundaries must be defined solely through:
*   **Background Color Shifts:** Placing a `surface-container-low` component against a `surface` background.
*   **Tonal Transitions:** Using depth to signify the end of one zone and the start of another.

#### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers, similar to stacked sheets of heavy-weight vellum.
*   **Surface (Base):** The foundation of the dashboard (`#f7f9fb`).
*   **Surface-Container-Low:** Used for secondary sidebar zones or background groupings.
*   **Surface-Container-Lowest:** Used for primary interactive cards (`#ffffff`) to create a natural "pop" against the background.
*   **Surface-Container-Highest:** Used for "active" or "hovered" states within a list.

#### The "Glass & Gradient" Rule
To break the flatness of SaaS UI:
*   **CTAs:** Use a subtle linear gradient from `primary` (`#1a7db9`) to `primary_container` (a lighter tint of primary) to give buttons a "gem-like" depth.
*   **Floating Elements:** Modals and dropdowns must use Glassmorphism—applying a 70% opacity to the surface color with a `20px` backdrop-blur.

---

### 3. Typography: The Editorial Balance

The system utilizes a dual-font strategy to balance character with utility.

*   **Display & Headlines (Manrope):** Chosen for its modern, geometric construction. Use `headline-lg` for dashboard summaries and `display-sm` for large queue numbers to establish immediate hierarchy.
*   **Body & Labels (Inter):** The workhorse for readability. Use `body-md` for student details and `label-sm` for timestamps.

**Hierarchy Tip:** Always pair a `headline-sm` title with a `body-sm` description in `on_surface_variant` (#454652) to create a clear "Title-to-Detail" relationship without needing icons or lines.

---

### 4. Elevation & Depth: Tonal Layering

Traditional drop shadows are too "heavy" for a modern academic environment. We use **Tonal Layering**.

*   **The Layering Principle:** Instead of shadows, stack `surface-container-lowest` cards on top of `surface-container-low` sections. This creates a soft, natural lift.
*   **Ambient Shadows:** For high-priority floating elements (like an "Student Check-in" modal), use a shadow with a `40px` blur, `0%` spread, and `6%` opacity. The shadow color must be a tinted version of `primary` rather than pure black.
*   **The "Ghost Border" Fallback:** If accessibility requires a border, use the `outline_variant` token at **15% opacity**. Never use a 100% opaque border.

---

### 5. Components

#### Buttons
*   **Primary:** Gradient (`primary` to `primary_container`), `subtle` (1px) roundedness, white text.
*   **Secondary:** `surface_container_high` background with `primary` text. No border.
*   **States:** On hover, increase the gradient intensity. On press, scale the button to 98% to simulate physical depth.

#### Queue Cards & Lists
*   **Strict Rule:** **No divider lines.** Separate queue items using vertical white space (16px) or by alternating background tones between `surface_container_lowest` and `surface_container_low`.
*   **Status Indicators:** Use a `full` (pill) roundedness for status chips. 
    *   *Attended:* `secondary_container` background with `on_secondary_container` text.
    *   *Urgent:* `tertiary_container` background with `on_tertiary_container` text.

#### Input Fields
*   Background: `surface_container_highest`. 
*   Indicator: Instead of a full-box border on focus, use a 2px bottom-accent in `primary`.

#### Additional Contextual Components
*   **Surge Alert Banner:** A glassmorphic top-bar using `error_container` at 80% opacity.
*   **The "Wait-Time" Gauge:** A custom radial progress component using a `primary` to `secondary` gradient to visualize student flow.

---

### 6. Do’s and Don’ts

#### Do
*   **Do** use asymmetrical margins. A wider left margin on a text block can create an editorial, high-end feel.
*   **Do** use `primary_fixed` (#e0e0ff) for background highlights on active sidebar items.
*   **Do** leverage the `subtle` (1px) roundedness for large layout containers to soften the "industrial" feel.

#### Don’t
*   **Don’t** use pure black (#000000) for text. Always use `on_surface` (#191c1e) to maintain a premium, ink-on-paper contrast level.
*   **Don’t** use standard 8px padding. Lean toward 16px, 24px, or 32px to embrace "The Curator's" love for whitespace.
*   **Don’t** use icons as the primary way to convey status. Use the semantic color tokens (`secondary`, `tertiary`, `error`) in combination with text for accessibility and clarity.