# Design System Specification: The Supportive Sanctuary
 
## 1. Overview & Creative North Star
*Creative North Star: "The Velvet Editorial"*
This design system rejects the clinical, high-frequency "tech" aesthetic in favor of a low-arousal, high-intellect environment. It is a digital sanctuary designed for cognitive ease, specifically tailored for neurodiverse users who require reduced visual noise without sacrificing sophisticated style. 
 
We break the "template" look through *Intentional Asymmetry* and *Tonal Depth*. Instead of rigid grids and harsh dividers, we use expansive white space (breathing room) and staggered layouts that guide the eye gently. The experience should feel like reading a premium, slow-journalism magazine under soft lamplight—quiet, authoritative, and deeply supportive.
 
---
 
## 2. Colors & Surface Philosophy
The palette is rooted in the earth: Deep Slate and Charcoal provide a grounding foundation, while Muted Sage acts as a soft beacon for interaction.
 
### The "No-Line" Rule
To reduce cognitive load and visual clutter, *1px solid borders are prohibited for sectioning.* Boundaries are defined strictly through background color shifts. For example, a ⁠ surface-container-low ⁠ section should sit against a ⁠ surface ⁠ background to create a "well" of content without a hard edge.
 
### Surface Hierarchy & Nesting
Treat the UI as physical layers of fine, heavy-weight paper.
•⁠  ⁠*Base Level:* ⁠ surface ⁠ (#0e0e0e) or ⁠ surface-dim ⁠.
•⁠  ⁠*Primary Content Areas:* ⁠ surface-container ⁠ (#191a1a).
•⁠  ⁠*Elevated Components:* ⁠ surface-container-high ⁠ (#1f2020) for cards or navigation.
•⁠  ⁠*Deepest Recess:* ⁠ surface-container-lowest ⁠ (#000000) used sparingly for high-contrast input wells or immersive media backdrops.
 
### The "Glass & Gradient" Rule
For floating elements (modals, dropdowns), use *Glassmorphism*. Apply a semi-transparent ⁠ surface-container-highest ⁠ with a ⁠ backdrop-blur ⁠ of 20px. This allows the Deep Slate and Sage tones to bleed through, softening the interface.
*   *Signature CTA Texture:* Use a subtle linear gradient from ⁠ primary ⁠ (#accec5) to ⁠ primary-container ⁠ (#2d4c46) at a 135-degree angle. This provides a "soulful" glow that a flat hex code cannot achieve.
 
---
 
## 3. Typography
The typographic soul of this system lies in the tension between the intellectual ⁠ Noto Serif ⁠ and the functional ⁠ Manrope ⁠.
 
*   *Display & Headlines (Noto Serif):* Use these to set the tone. Large, airy serif headers communicate a sense of "slow tech." High-contrast Off-White (⁠ on-background ⁠ #e7e5e5) ensures readability.
*   *Body & Labels (Manrope):* A clean, geometric sans-serif for high-speed processing. The generous x-height of Manrope ensures that even at ⁠ body-sm ⁠, the text remains inclusive for users with visual impairments or dyslexia.
 
*Editorial Hierarchy:*
•⁠  ⁠*Display-LG (3.5rem):* Reserved for "Welcome Home" moments.
•⁠  ⁠*Headline-MD (1.75rem):* Used for section starts; always pair with a ⁠ label-md ⁠ uppercase sub-header for a boutique editorial look.
 
---
 
## 4. Elevation & Depth
In a low-arousal sanctuary, shadows must be felt, not seen.
 
*   *Tonal Layering:* Always prioritize color shifts over shadows. To lift a card, move from ⁠ surface-container ⁠ to ⁠ surface-container-high ⁠.
*   *Ambient Shadows:* When a float is required (e.g., a floating action button), use a shadow with a ⁠ 40px ⁠ blur and ⁠ 4% ⁠ opacity. The shadow color should be tinted with ⁠ primary ⁠ (#accec5) rather than black to maintain a harmonious, "glowing" depth.
*   *The Ghost Border Fallback:* If accessibility testing requires a boundary, use the ⁠ outline-variant ⁠ (#484848) at *20% opacity*. It should be a suggestion of a line, not a wall.
 
---
 
## 5. Components
 
### Buttons
*   *Primary:* A gradient-filled container (⁠ primary ⁠ to ⁠ primary-container ⁠) with ⁠ on-primary ⁠ text. No border. 8px radius.
*   *Secondary:* A ⁠ surface-container-highest ⁠ background with ⁠ primary ⁠ text. Subtle, low-contrast.
*   *Tertiary:* No background. ⁠ primary ⁠ text with a 2px underline that appears only on hover to reduce visual noise.
 
### Cards & Lists
*   *Rule:* Forbid divider lines.
*   *Execution:* Use ⁠ 40px ⁠ of vertical white space to separate list items. For cards, use a subtle background shift (e.g., a ⁠ surface-container-low ⁠ card on a ⁠ surface ⁠ background). 
*   *Shape:* 8px rounded corners (⁠ DEFAULT ⁠) for cards; ⁠ lg ⁠ (16px) for larger layout containers.
 
### Input Fields
*   *Style:* Instead of a boxed outline, use a "well" style. A ⁠ surface-container-lowest ⁠ background with a ⁠ primary ⁠ 2px bottom-border that activates only on focus. This mimics the feeling of writing on a lined journal.
 
### Sanctuary Chips
*   *Selection:* Use ⁠ primary-container ⁠ with ⁠ on-primary-container ⁠ text. These should feel like soft organic pills (use ⁠ full ⁠ roundedness).
 
---
 
## 6. Do's and Don'ts
 
### Do
*   *Do* use asymmetrical margins. Offsetting a headline to the right while keeping body text left-aligned creates a bespoke, premium editorial feel.
*   *Do* use ⁠ primary-dim ⁠ (#9ec0b7) for secondary icons to maintain a low-arousal state.
*   *Do* ensure all text hits a minimum 4.5:1 contrast ratio against its specific surface-container tier.
 
### Don't
*   *Don't* use pure black (#000000) for large backgrounds; it creates "smearing" on OLED screens and increases eye strain. Use ⁠ surface ⁠ (#0e0e0e).
*   *Don't* use "Alert Red" for errors unless critical. Use the ⁠ error ⁠ (#ee7d77) and ⁠ error_container ⁠ (#7f2927) tokens, which are softened to prevent an "alarmist" response in neurodiverse users.
*   *Don't* use motion that "pops" or "slides" quickly. Use 400ms "Ease-in-out" transitions to mimic natural, fluid movement.