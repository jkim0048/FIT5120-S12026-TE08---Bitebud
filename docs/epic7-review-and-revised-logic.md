# Epic 7 review — Motivation, Streaks & Insights

**Lens:** neurodivergent-affirming product design + practical product-owner pragmatism.
**Audience:** PO, design, engineering.
**Status:** advisory — revisions proposed below should be re-scored against Epic 7's original AC before sprint planning.

---

## 1. What's actually in the code today

Before re-designing, the team should know the starting point — because the original AC was written as if the feature already existed in the build that was reviewed.

| Epic 7 element | Status in `main` |
|---|---|
| Flame streak chip on Home | **Not present.** `HomeView.vue` has no streak UI. `App.vue` header has no streak in the nav. The PO's "it's under Let's dine out" comment refers to a prototype, not committed code. |
| Streak calculation / weekly freeze | **Not present.** No streak model, no recovery logic. |
| Post-action encouragement toast | **Not present.** |
| Recipe rating on completion | **Half-built.** `RecipeCompleteView.vue` renders 5 stars but `rating` is a `ref` that is never persisted. No `RecipeRating` model exists. |
| Recipe completion event | **Not first-class.** Only `RecipeProgress.completedNodeIds` exists — completion has to be *derived* by checking "all node IDs checked off." There is no timestamped completion event log. |
| My Progress / My Insights view | **Not present.** |

**What we already have that's reusable for richer insights:**

- `Recipe.totalTimeMinutes`, `Recipe.complexity`, `Recipe.heatLevel`, `Recipe.tags`, `Recipe.servings`, `Recipe.graph` (ingredients + steps).
- `services/flavorProfile.ts` already infers sweet/salty/sour/bitter/spicy ingredient signatures — useful for "sweet & savoury" patterns.
- `RestaurantReview` captures noise/music/light/crowds/smells + best meal blocks + best times of day + best days of week + cuisine. This is *excellent* raw material for the dining side of insights.

**Implication:** before US7.2's "what works / what doesn't" insights can be honest, we need to capture (a) recipe completion timestamps, (b) recipe ratings (and a "would-cook-again" flag), and (c) optional structured "what worked / what didn't" tags at the point of rating. Without that, insights are guesses dressed up as personalisation — which lands badly with neurodivergent users who notice when an app overclaims.

---

## 2. Where Epic 7 is strong (don't lose this)

The original epic gets several neurodivergent-affirming choices right, and the revisions below should preserve them:

- **No competition / no leaderboards.** Streak compares the user only to themselves. Keep.
- **Weekly freeze with no penalty language.** Gentle recovery is the single most important streak mechanic for ND users — all-or-nothing thinking ("I broke my streak so I'll never start again") is well-documented in ADHD and autistic adults. Keep, and strengthen.
- **Non-blocking, 2-second auto-dismiss toast.** Avoids interrupting flow, avoids forcing interaction. Keep.
- **Supportive guidance fallback** when there isn't enough data, instead of empty charts. This is the right call — empty states that look "error-like" are a common source of anxiety for ND users. Keep.
- **PO's framing of "what works for you / what doesn't."** This is genuinely excellent. Reframing analytics as *self-knowledge mirror* rather than *performance dashboard* is one of the best ND-affirming patterns in this category, because many autistic and ADHD adults have lower interoceptive awareness and value external pattern-mirroring. **Make this the spine of US7.2**, not an extra.

---

## 3. Risks in the original epic (what to change)

| # | Risk | Why it matters for ND users | Why it matters for the business |
|---|---|---|---|
| R1 | "Flame" iconography + "streak" label inherit gamification anxiety from Duolingo/Snapchat. | Many ND adults have either trauma-adjacent or hyperfixation-adjacent histories with streaks (lost streaks → shutdown; or pathological compulsion to maintain them). | A wellness-positioned app for ND users that uses the same fire/streak grammar as habit-trap apps undermines the brand promise. |
| R2 | Placement under a CTA ("Let's dine out") creates misreading ("dined out 1 day in a row"). | ND users often parse UI literally; ambiguous chip placement causes confusion and friction. | PO already flagged this — it's costing comprehension on the home screen. |
| R3 | One generic "encouragement" toast for every action. | ND users notice when copy is non-specific and lose trust in praise. Generic praise reads as patronising. | Reduces perceived quality of the product. |
| R4 | "Best-day pattern + one cooking insight + one dining insight" is thin. | PO is right: the value is in *categories of self-knowledge* (ingredient count, prep time, cooking method, flavour combos, day/time, sensory match). | Thin insights don't differentiate BiteBud from a generic habit app. |
| R5 | No opt-out for motivation surface. | Some ND users explicitly do not want gamification. Forcing it on can be a deal-breaker. | A 10-second toggle in Settings turns a complaint into a "thoughtful design" moment. |
| R6 | No data model to back insights honestly. | Fabricated or wobbly insights destroy trust faster than no insights. | We'll ship a feature that gets switched off in week 2. |

---

## 4. Revised US7.1 — Quiet progress, not a streak

**As a neurodivergent young adult or adult, I want a quiet, optional view of my recent food activity, so I can feel a sense of continuity around cooking and dining without the pressure of maintaining a streak or being compared to anyone — including past-me.**

**Naming change:** drop "streak." Replace with **"Recent activity"** (or **"Rhythm"** if the team wants a softer word). This addresses the PO's "maybe label it streak if you keep it there" — the better answer is to stop calling it a streak at all, because that word carries the loss-aversion baggage we're trying to avoid. The chip can still show a small number ("3 days this week") without invoking the streak grammar.

**Placement change:** move it out of the CTA area entirely. Put it **inline with the user avatar in the top navigation**, exactly where the PO suggested. That location:

- Solves R2 (no longer misreads as "dined out 1 day in a row").
- Reads as a personal indicator (it lives with "you"), not a feature button.
- Is dismissable / hideable without disturbing the page layout.

### Revised acceptance criteria — US7.1

| # | Given | When | Then |
|---|---|---|---|
| AC1 | The user has at least one eligible activity in the last 14 days **and** has not turned off motivation surfaces in Settings | The user opens any page | A small **"Recent activity"** chip sits adjacent to the avatar in the top navigation. It shows a neutral count (e.g. *"3 days this week"* or *"5 activities this month"*) with a small leaf or seedling glyph — **not** a flame. The chip never animates on appearance. |
| AC2 | The user completes an eligible action (finishing a recipe with all nodes checked, or submitting a restaurant review) or misses several days | The system recalculates activity | Each active day contributes at most once. **No streak is broken.** Counts roll forward on a sliding 7-day and 30-day window. There is no concept of "losing" progress — only the window moving. The chip uses no language about breaks, freezes, recoveries, or resets. |
| AC3 | The user completes an eligible action **and** has motivation surfaces enabled | The action is confirmed | A short, **specific** toast appears at the bottom for ~2 seconds. Copy references *what was done*, not generic praise: *"Recipe saved. That's your third this week."* or *"Review added — your notes will be there next time."* No sound, no haptic, no confetti, no level-up animation, no failure-style messaging anywhere in the system. |
| AC4 | The user opens Settings | They locate the **"Motivation & encouragement"** section | A single toggle: **"Show recent activity and gentle encouragement."** Off-by-default for first-time users who declined optional features, on-by-default otherwise. State persists per user. |
| AC5 | The user has opted out, or has zero activity in the last 30 days | They open the Home or any page | The chip is absent (not blank, not "0 days") and no toasts fire. Page layout does not visibly shift. |

**ND-design rationale notes for engineering:**

- **No flame.** The flame icon is doing real psychological work in competitor apps and we should not borrow it. A leaf, seedling, or simple dot indicator carries the same affordance ("something is being tracked") without the loss-aversion frame.
- **Specific praise > generic praise.** "That's your third this week" tells the user something true; "Great job!" tells them nothing and tends to feel performative or condescending to adults, particularly autistic adults who often dislike effusive praise.
- **The toggle is non-negotiable.** This single setting is the difference between "BiteBud respects me" and "BiteBud is another habit app."

---

## 5. Revised US7.2 — Self-knowledge mirror, organised by "what works / what doesn't"

**As a neurodivergent young adult or adult, I want a personal Insights view that mirrors back the patterns I can't always see in myself — what kinds of food, prep, timing, and sensory environments tend to work well for me and which don't — so I can make food and dining decisions with less mental load and more self-trust.**

This is the bigger structural change. The PO's framing is the right one and we should commit to it fully: organise insights as **"What works well for you"** and **"What doesn't seem to work"**, each broken into the categories below. This converts an analytics dashboard into a **self-knowledge mirror**, which is the actual value proposition for ND adults around food.

### Insight categories (the spine of the feature)

#### Cooking — derived from recipe completions + ratings + flavour profile

| Category | "What works" example | "Doesn't work" example | Data source |
|---|---|---|---|
| **Ingredient count** | *"You complete and rate highly recipes with 6 or fewer ingredients."* | *"Recipes with 12+ ingredients tend to go uncompleted or get lower ratings."* | `Recipe.graph` (count of ingredient nodes), `RecipeProgress`, new `RecipeRating` |
| **Prep time** | *"Your favourites take 30 minutes or less."* | *"Recipes over 60 minutes rarely get finished."* | `Recipe.totalTimeMinutes` × completion |
| **Cooking method** | *"Pan and stovetop recipes work well for you."* | *"You haven't enjoyed oven-baked recipes you've tried."* | extracted from `Recipe.graph` step verbs or new `Recipe.cookingMethods` tag |
| **Flavour signature** | *"Sweet-and-savoury recipes are your highest-rated."* | *"Bitter-leaning recipes get lower ratings."* | `services/flavorProfile.ts` already infers these |
| **Texture / sensory** | *"You finish recipes that match your sensory profile's preferred textures."* | *"Recipes with thick sauces or pureed textures show up less."* | `SensoryProfile.texturePrefs` × ingredient texture inference |
| **Time of day / day of week** | *"You cook most on Sunday evenings."* | *"You rarely cook on weekday mornings."* | completion timestamps |
| **Ingredient affinities** | *"Lemon, garlic, and yoghurt appear in your highest-rated recipes."* | *"Tomato-forward recipes get lower ratings."* | ingredient frequency × rating |

#### Dining — derived from `RestaurantReview` (already rich)

| Category | "What works" example | "Doesn't work" example | Data source |
|---|---|---|---|
| **Sensory match** | *"You rate places with low-noise and dim-light highest."* | *"Loud, bright rooms consistently rate lower."* | review noise/music/light ratings vs overallRating |
| **Cuisine** | *"You return to Vietnamese and Japanese places most."* | *"You haven't gone back to any of the cafes you rated 3 or below."* | `RestaurantPlace.cuisine` × `RestaurantFavorite` × `overallRating` |
| **Best windows** | *"Mornings and early afternoons work better for you than evenings."* | (PO can choose whether to surface negatives here) | `RestaurantReview.bestTimesOfDay` |
| **Crowd tolerance** | *"You do well with light crowds, less well at peak."* | | `crowdsRating` × `overallRating` |

### Required data model additions

To make any of the above honest rather than guessed:

```prisma
model RecipeCompletion {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  recipeId     String   @map("recipe_id") @db.Uuid
  userId       String   @map("user_id")
  completedAt  DateTime @default(now()) @map("completed_at")
  rating       Int?     // 1–5, optional
  wouldRepeat  Boolean? @map("would_repeat")
  worked       Json     @default("[]")   // ["low-prep","one-pan","sweet-savoury"]
  didntWork    Json     @default("[]")   // ["too-many-steps","thick-sauce"]
  notes        String?
  recipe       Recipe   @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@index([userId, completedAt])
  @@map("recipe_completions")
}
```

Plus, in `RecipeCompleteView.vue`, actually **persist** the star rating and offer two small, optional chip-selectors at the moment of completion: *"What worked? (tap any)"* and *"What didn't? (tap any)"*. The chip options should be a fixed taxonomy that maps cleanly to the insight categories above (prep length, ingredient count, texture, flavour, method) so insights can be generated from structured data, not free text.

This is the single highest-leverage change in this whole review: **moving from one un-persisted star to a small structured "what worked / didn't" capture** is what turns US7.2 from generic into the version the PO is asking for.

### Revised acceptance criteria — US7.2

| # | Given | When | Then |
|---|---|---|---|
| AC1 | The user has at least **5** recipe completions or restaurant reviews combined | They open **My Insights** | The screen shows a **My Progress** band (monthly calendar of personal activity, weekly activity bars, breakdown by activity type — recipes vs. dining) using only their own data, with no rankings, comparisons, scores, or league-table affordances. |
| AC2 | The user has at least 5 rated recipe completions | They open **My Insights → Cooking** | The screen shows up to **3** "What works for you" cards and up to **3** "What doesn't seem to work" cards drawn from the categories table above. Each card has plain-language copy, the number of records it was drawn from, and a small **"Why this card?"** disclosure that explains the rule in one sentence. |
| AC3 | The user has at least 3 restaurant reviews | They open **My Insights → Dining** | Same structure: up to 3 "works" cards, up to 3 "doesn't" cards, each citing record count and rule. |
| AC4 | The user has fewer records than AC2/AC3 require | They open the relevant section | They see **supportive guidance** explaining what additional data would unlock that section — concrete, e.g. *"After 2 more rated recipes, we can show you what your favourites have in common."* No empty charts, no error states, no progress bars implying urgency. |
| AC5 | An insight card is shown | The user taps "Why this card?" | A short, factual explanation appears: *"3 of your 5 highest-rated recipes used 6 or fewer ingredients."* The user can dismiss the insight card permanently with a "Not useful" affordance; dismissed cards do not return. |
| AC6 | The user wishes to opt out | They visit Settings | A toggle **"Show personal insights"** turns the entire Insights surface off. The user's data is not deleted; insights simply stop rendering. |

**Why "Not useful" matters:** ND users often have very specific self-knowledge that an algorithm gets wrong (e.g. someone who *does* love long recipes but only on weekends). Giving them a way to remove a wrong insight — without arguing back — turns a paternalistic feature into a respectful one.

---

## 6. Implementation map for engineering

These are the concrete code changes, in dependency order:

1. **Schema** (`backend/prisma/schema.prisma`)
   - Add `RecipeCompletion` model as specified above.
   - Add migration `2026MMDD_recipe_completions`.
   - (Optional, for stronger cooking-method insights) add `cookingMethods Json @default("[]")` to `Recipe`, populated by a backfill job that parses the existing `Recipe.graph` step verbs.

2. **Backend route** (`backend/src/routes/recipes.ts`)
   - New `POST /recipes/:id/completions` accepting `{ rating?, wouldRepeat?, worked[], didntWork[], notes? }`.
   - New `GET /me/activity?window=7|30` returning the activity-window count used by the nav chip.
   - New `GET /me/insights` returning the structured `{ progress, cooking, dining }` payload.

3. **Frontend — capture** (`frontend/src/views/RecipeCompleteView.vue`)
   - Persist the star rating via the new endpoint.
   - Add the two chip-selectors ("What worked?" / "What didn't?") with a fixed taxonomy.
   - Same pattern can be added optionally to the restaurant rating flow if the PO wants symmetric data — but `RestaurantReview` already captures most of what's needed via its sensory ratings.

4. **Frontend — chip** (`frontend/src/App.vue`)
   - Move the activity chip into the top nav, **adjacent to the avatar**.
   - Replace flame with a leaf/seedling glyph.
   - Use the word **"Recent activity"** in the chip's `aria-label`, e.g. `aria-label="Recent activity: 3 days this week"`.
   - Respect the `motivationEnabled` setting (`useSettings`).

5. **Frontend — toast** (new composable `useGentleToast.ts`)
   - 2s auto-dismiss, bottom-of-viewport, no animation beyond a 200ms fade.
   - Specific-content templates per action type — never generic.
   - Respect `prefers-reduced-motion` and the global motivation toggle.

6. **Frontend — Insights view** (new `MyInsightsView.vue`)
   - Three sections: **My Progress** (calendar + bars + type breakdown), **Cooking** (works/doesn't cards), **Dining** (works/doesn't cards).
   - Each card: title, 1-sentence finding, record count, "Why this card?" expand, "Not useful" dismiss.
   - Supportive empty/threshold states for each section.

7. **Settings** (`frontend/src/views/SettingsView.vue`)
   - New section **"Motivation & encouragement"** with two toggles: *Show recent activity and gentle encouragement* and *Show personal insights*.

8. **Copy QA pass** before ship
   - No language anywhere in the system that says: *streak, broken, lost, missed, failed, behind, catch up, don't break, keep it going, you're on fire, level up, achievement unlocked*. Replace with neutral descriptive language ("3 days this week", "Recipe saved").

---

## 7. What the PO gets out of this versus the original epic

- **The chip placement is fixed** — out of the CTA zone, into the avatar area. Solves the misreading complaint directly.
- **The label is fixed** — "Recent activity" or "Rhythm" instead of "streak," because the right answer to "should we label it streak?" is to remove the streak frame rather than name it more clearly.
- **The insights are exactly the shape the PO sketched** — categories of "what works for you / what doesn't" rather than a single best-day pattern. The 7 cooking and 4 dining categories above cover and extend every example the PO listed (ingredient count, prep time, oven vs. stovetop, sweet & savoury, Sunday evenings, tomato avoidance, thick soups).
- **It's honest** — by capturing rating and structured worked/didn't-work tags at completion time, the insights are grounded in real data instead of inferred guesswork, which is the difference between a feature that gets praised and one that gets switched off.
- **It's defensible as ND-affirming** — every change above ties back to a documented neurodivergent design principle (no loss-aversion, no comparison, plain language, opt-out, strengths-based framing, dismissible wrong-positives).

---

## 8. Open questions for the PO

1. Do we want "What doesn't work" cards in dining, or only in cooking? (Dining negatives can read as harsh; cooking negatives are usually neutral.)
2. Minimum thresholds: are **5** completions / **3** reviews the right unlock numbers, or do we want to be more generous (3 / 2) to get users to the value faster?
3. Should the activity chip be **off by default** for new users (privacy/calm-first), or on by default (engagement)? My recommendation: **on by default for users who finish onboarding, with the toggle one tap away.**
4. Do we want insights to be **shareable/exportable** (e.g. to bring to a dietitian or OT)? This is a high-value asset for ND adults working with allied health professionals and a strong differentiator for BiteBud.

---
