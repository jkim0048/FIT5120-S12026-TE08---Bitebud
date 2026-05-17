<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useSession } from '../composables/useSession'

const { isSignedIn } = useSession()

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <main class="page">
    <section class="hero">
      <div class="hero-copy">
        <h1 class="h1">
          Cooking and Dining,<br />
          <span class="h1-sub">made simple.</span>
        </h1>
        <p class="lead">
          <strong class="lead-brand">BiteBud</strong> is for anyone who wants food to feel more predictable. We turn recipes into short, visual steps, help you capture dietary and
          sensory needs, and surface dining options that match you when you eat out.
        </p>
        <div class="ctas">
          <RouterLink
            :to="isSignedIn ? '/start' : { path: '/auth', query: { redirect: '/start' } }"
            class="bb-btn bb-btn--primary cta"
          >
            Let's get started
          </RouterLink>
          <RouterLink :to="{ name: 'aboutUs' }" class="bb-btn bb-btn--secondary cta">Learn more</RouterLink>
        </div>
      </div>
    </section>

    <section class="section section-soft">
      <div class="section-head">
        <div class="intro-head">
          <h2 class="h2">Explore what you can do with BiteBud</h2>
        </div>
        <p class="subhead">
          Everything below is here to explain how BiteBud works. Open a tile for a quick peek—no pressure to remember it all before
          you sign in.
        </p>
      </div>

      <div class="intro-pillars" role="list">
        <div class="pillar" role="listitem">
          <span class="pillar-ico" aria-hidden="true">🌿</span>
          <h3 class="pillar-title">Built around you</h3>
          <p class="pillar-copy">Save ingredients that feel safe so searches and recipes respect your reality.</p>
        </div>
        <div class="pillar" role="listitem">
          <span class="pillar-ico" aria-hidden="true">🍳</span>
          <h3 class="pillar-title">Guided at home</h3>
          <p class="pillar-copy">Browse or paste a recipe, then cook with a clear flow instead of juggling timers and long paragraphs.</p>
        </div>
        <div class="pillar" role="listitem">
          <span class="pillar-ico" aria-hidden="true">🍽️</span>
          <h3 class="pillar-title">Support when dining out</h3>
          <p class="pillar-copy">Explore venues with sensory signals noise, light, crowds before you commit to going.</p>
        </div>
      </div>

      <p class="explore-hint">Explore each area in more detail:</p>

      <div class="bento">
        <details class="tile tile-green">
          <summary class="tile-summary">
            <h3 class="h3">Sensory</h3>
            <span class="tile-summary__chevron" aria-hidden="true">⌄</span>
          </summary>
          <p class="tile-copy">
            Customise your food preferences and filter by dietary and cultural requirements.
          </p>
          <div class="tile-demo tile-demo--compact" aria-hidden="true">
            <div class="demo-k">Example profile</div>
            <div class="pill-grid">
              <span class="pill-chip on">Vegan</span>
              <span class="pill-chip">Halal</span>
              <span class="pill-chip">No dairy</span>
            </div>
            <div class="warn-card">
              <div class="warn-title">We’ll flag conflicts</div>
              <div class="warn-title">So you are aware exactly what you should watch out for</div>
            </div>
          </div>
        </details>

        <details class="tile tile-wide">
          <summary class="tile-summary">
            <h3 class="h3">Visualise</h3>
            <span class="tile-summary__chevron" aria-hidden="true">⌄</span>
          </summary>
          <p class="tile-copy">
            One instruction at a time. Clear lanes and gentle pacing replace cluttered lists so your attention stays on
            the next step.
          </p>
          <div class="micro-flow" aria-hidden="true">
            <div class="micro-title">Pancakes (example)</div>
            <div class="micro-card">
              <div class="micro-emo">🥣</div>
              <div class="micro-body">
                <div class="micro-k">Prep</div>
                <div class="micro-v">Mix batter</div>
              </div>
            </div>
            <div class="micro-connector" />
            <div class="micro-card micro-card--now">
              <div class="micro-emo">🍳</div>
              <div class="micro-body">
                <div class="micro-k">Cook</div>
                <div class="micro-v">Cook pancakes</div>
              </div>
            </div>
            <div class="micro-connector" />
            <div class="micro-card micro-card--soft">
              <div class="micro-emo">🍽️</div>
              <div class="micro-body">
                <div class="micro-k">Serve</div>
                <div class="micro-v">Serve warm</div>
              </div>
            </div>
          </div>
        </details>

        <details class="tile tile-dark">
          <summary class="tile-summary">
            <h3 class="h3">Guided</h3>
            <span class="tile-summary__chevron" aria-hidden="true">⌄</span>
          </summary>
          <p class="tile-copy">
            Cook with one clear step at a time. Track progress, stay oriented, and move at your pace.
          </p>
          <div class="tile-demo tile-demo--dark tile-demo--compact" aria-hidden="true">
            <div class="step-demo">
              <div class="step-badge">Step 2 of 5</div>
              <div class="step-line">
                <span class="emo">🍳</span>
                <span class="txt">Heat pan on low</span>
              </div>
              <div class="progress">
                <div class="bar" />
              </div>
              <div class="step-hint">One calm instruction at a time.</div>
            </div>
          </div>
        </details>

        <details class="tile tile-softblue">
          <summary class="tile-summary">
            <h3 class="h3">Find sensory‑friendly restaurants</h3>
            <span class="tile-summary__chevron" aria-hidden="true">⌄</span>
          </summary>
          <p class="tile-copy">
            Search nearby places and review sensory signals like noise, lighting, crowds, music, and smells before you go.
          </p>
          <div class="tile-demo tile-demo--compact" aria-hidden="true">
            <div class="demo-k">Example shortlist</div>
            <div class="rest-demo">
              <div class="rest-card rest-card--great">
                <div class="rest-emo">📍</div>
                <div class="rest-body">
                  <div class="rest-name">Higher Ground</div>
                  <div class="rest-meta">Great match · 4.2/5</div>
                </div>
              </div>
              <div class="rest-card rest-card--good">
                <div class="rest-emo">🗺️</div>
                <div class="rest-body">
                  <div class="rest-name">Cafe nearby</div>
                  <div class="rest-meta">Good match · quiet morning</div>
                </div>
              </div>
              <div class="rest-badges">
                <span class="rest-badge">Noise</span>
                <span class="rest-badge">Light</span>
                <span class="rest-badge">Crowds</span>
                <span class="rest-badge">Smells</span>
              </div>
            </div>
          </div>
        </details>

        <details class="tile tile-profile">
          <summary class="tile-summary">
            <h3 class="h3">My progress &amp; my insights</h3>
            <span class="tile-summary__chevron" aria-hidden="true">⌄</span>
          </summary>
          <p class="tile-copy">
            See what you have cooked and reviewed over time, then spot gentle patterns—what tends to work at home and
            when dining out—so the next choice feels a little clearer.
          </p>
          <div class="tile-demo tile-demo--compact" aria-hidden="true">
            <div class="profile-bento-demo">
              <div class="profile-bento-panel profile-bento-panel--progress">
                <div class="demo-k">My progress</div>
                <div class="progress-mini-stats">
                  <div class="progress-mini-stat">
                    <span class="progress-mini-value">12</span>
                    <span class="progress-mini-label">Recipes</span>
                  </div>
                  <div class="progress-mini-stat">
                    <span class="progress-mini-value">5</span>
                    <span class="progress-mini-label">Reviews</span>
                  </div>
                  <div class="progress-mini-stat">
                    <span class="progress-mini-value">8</span>
                    <span class="progress-mini-label">Active days</span>
                  </div>
                </div>
                <div class="progress-mini-calendar" aria-hidden="true">
                  <span v-for="day in 14" :key="day" class="progress-mini-day" :class="{ on: day % 3 !== 0 }" />
                </div>
              </div>
              <div class="profile-bento-panel profile-bento-panel--insights">
                <div class="demo-k">My insights</div>
                <div class="insight-mini-card">
                  <span class="insight-mini-tag">Cooking</span>
                  <p class="insight-mini-headline">One-pan meals show up often in your wins</p>
                </div>
                <div class="insight-mini-card insight-mini-card--soft">
                  <span class="insight-mini-tag">Dining</span>
                  <p class="insight-mini-headline">Quieter lunch slots match your reviews</p>
                </div>
              </div>
            </div>
          </div>
        </details>

        <details class="tile tile-peach">
          <summary class="tile-summary">
            <h3 class="h3">Adjust your recipe to your sensory preferences</h3>
            <span class="tile-summary__chevron" aria-hidden="true">⌄</span>
          </summary>
          <p class="tile-copy">
            Nudge flavours to match what feels comfortable—dial down bitter, lift sweet, or balance sour with simple swaps.
          </p>
          <div class="tile-demo tile-demo--compact" aria-hidden="true">
            <div class="demo-k">Example flavour tuning</div>
            <div class="flavor-demo">
              <div class="flavor-row">
                <span class="flavor-label">Sweet</span>
                <div class="flavor-meter">
                  <span class="flavor-fill flavor-fill--sweet" style="width: 72%"></span>
                </div>
                <span class="flavor-tip">↑ honey</span>
              </div>
              <div class="flavor-row">
                <span class="flavor-label">Sour</span>
                <div class="flavor-meter">
                  <span class="flavor-fill flavor-fill--sour" style="width: 38%"></span>
                </div>
                <span class="flavor-tip">≈ lemon</span>
              </div>
              <div class="flavor-row">
                <span class="flavor-label">Bitter</span>
                <div class="flavor-meter">
                  <span class="flavor-fill flavor-fill--bitter" style="width: 18%"></span>
                </div>
                <span class="flavor-tip">↓ cocoa</span>
              </div>
              <div class="flavor-chips">
                <span class="flavor-chip">Add sweetness</span>
                <span class="flavor-chip">Soften acidity</span>
                <span class="flavor-chip">Reduce bitterness</span>
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>

    <div class="page-actions">
      <button type="button" class="bb-btn bb-btn--secondary scroll-top-btn" @click="scrollToTop">Back to top</button>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.1rem 1.1rem 2.75rem;
}

.hero {
  display: grid;
  grid-template-columns: 1fr;
  align-items: center;
  gap: 2.25rem;
  padding: 1.65rem 0 1.35rem;
}
.hero-copy {
  min-width: 0;
}
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  margin: 0;
  font-family: var(--bb-font-label);
  font-weight: 700;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--bb-accent);
}
.hero-mark {
  width: 56px;
  height: 56px;
  object-fit: contain;
  flex-shrink: 0;
}
.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.85rem;
  background: var(--bb-secondary-container);
  color: var(--bb-on-secondary-container);
  border-radius: 999px;
  font-family: var(--bb-font-label);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.7rem;
}
.h1 {
  margin: 1.05rem 0 0.6rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: clamp(2.35rem, 5vw, 4.1rem);
  line-height: 1.05;
  letter-spacing: -0.04em;
  color: var(--bb-primary);
}
.hero-eyebrow ~ .h1 {
  margin-top: 0.65rem;
}
.h1-sub {
  color: var(--bb-primary-container);
}
.lead {
  margin: 0;
  max-width: 40rem;
  color: var(--bb-muted);
  font-size: 1.05rem;
  line-height: 1.75;
}
.lead-brand {
  color: var(--bb-text);
  font-weight: 800;
  font-family: var(--bb-font-headline);
}
.hero-points {
  margin: 1.15rem 0 0;
  padding: 0;
  list-style: none;
  max-width: 40rem;
  display: grid;
  gap: 0.45rem;
}
.hero-points li {
  position: relative;
  padding-left: 1.35rem;
  font-size: 0.98rem;
  line-height: 1.5;
  color: color-mix(in srgb, var(--bb-text) 88%, var(--bb-muted));
}
.hero-points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--bb-primary);
  opacity: 0.85;
}
.ctas {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 1.25rem;
}
.cta {
  padding: 1.15rem 2rem;
  min-height: 3.25rem;
  font-family: var(--bb-font-headline);
  font-size: 1.15rem;
  font-weight: 800;
  border-radius: 999px;
}

.section {
  margin-top: 2.25rem;
}
.section-soft {
  background: var(--bb-surface-low);
  border-radius: 20px;
  padding: 2rem 1rem;
}
.section-head {
  max-width: 44rem;
  margin: 0 0 1.25rem;
  padding: 0;
}
.intro-head {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.intro-mark {
  width: 34px;
  height: 34px;
  object-fit: contain;
  flex-shrink: 0;
}
.h2 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--bb-primary);
  font-size: 1.65rem;
}
.subhead {
  margin: 0.55rem 0 0;
  color: var(--bb-muted);
  line-height: 1.7;
}

.intro-pillars {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
  margin: 1.35rem 0 0;
  padding: 0;
  list-style: none;
}
.pillar {
  background: var(--bb-surface-lowest);
  border-radius: 14px;
  padding: 1rem 1rem 1.05rem;
  border: 1px solid color-mix(in srgb, var(--bb-border) 70%, transparent);
  box-shadow: 0 8px 24px rgba(26, 28, 25, 0.04);
}
.pillar-ico {
  display: block;
  font-size: 1.35rem;
  line-height: 1;
  margin-bottom: 0.45rem;
}
.pillar-title {
  margin: 0 0 0.35rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: -0.02em;
  color: var(--bb-primary);
}
.pillar-copy {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.55;
  color: var(--bb-muted);
}
.explore-hint {
  margin: 1.25rem 0 0.35rem;
  font-family: var(--bb-font-label);
  font-weight: 700;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: color-mix(in srgb, var(--bb-muted) 92%, transparent);
}

.bento {
  max-width: 68rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
  padding: 0;
  align-items: start;
}
.tile {
  background: var(--bb-surface-lowest);
  border-radius: 16px;
  padding: 0.85rem 0.85rem;
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.04);
  min-height: 84px;
  display: flex;
  flex-direction: column;
  align-self: start;
}
.tile:not([open]) .tile-copy,
.tile:not([open]) .tile-demo,
.tile:not([open]) .micro-flow {
  display: none;
}
.tile[open] .tile-summary__chevron {
  transform: rotate(180deg);
}
.tile-wide {
  /* keep semantic class, but same size as other tiles */
}
.tile-green {
  background: var(--bb-secondary-container);
}
.tile-softblue {
  background: color-mix(in srgb, var(--bb-primary-container) 28%, var(--bb-surface-lowest));
}
.tile-peach {
  background: color-mix(in srgb, var(--bb-accent) 18%, var(--bb-surface-lowest));
}
.tile-profile {
  background: color-mix(in srgb, #b89ac8 42%, var(--bb-surface-lowest));
  color: color-mix(in srgb, #3d2a4a 88%, var(--bb-primary));
}
.tile-profile .tile-copy {
  color: color-mix(in srgb, #3d2a4a 72%, var(--bb-muted));
}
.tile-profile .demo-k {
  color: color-mix(in srgb, #5c4370 75%, var(--bb-muted));
}
.tile:not(.tile-wide):not(.tile-green):not(.tile-dark) {
  /* default tile */
}
.tile-dark {
  background: var(--bb-primary);
  color: #fff;
}
.h3 {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  color: inherit;
}
.tile-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  cursor: pointer;
  list-style: none;
}
.tile-summary::-webkit-details-marker {
  display: none;
}
.tile-summary__chevron {
  flex-shrink: 0;
  font-size: 1.1rem;
  transition: transform 0.2s ease;
}
.tile-copy {
  margin: 0.85rem 0 0;
  color: color-mix(in srgb, currentColor 76%, transparent);
  line-height: 1.65;
}
.tile-link {
  display: inline-block;
  margin-top: 0.8rem;
  font-weight: 700;
  text-decoration: none;
  color: inherit;
  opacity: 0.95;
}

.tile-demo {
  margin-top: auto;
  padding-top: 1rem;
  display: grid;
  gap: 0.75rem;
}
.tile-demo--compact {
  margin-top: 0.85rem;
  padding-top: 0.65rem;
}
.demo-k {
  font-family: var(--bb-font-label);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 900;
  font-size: 0.62rem;
  color: color-mix(in srgb, var(--bb-muted) 80%, transparent);
}

/* Restaurant search demo */
.rest-demo {
  display: grid;
  gap: 0.55rem;
}
.rest-card {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 0.55rem;
  align-items: center;
  padding: 0.65rem 0.7rem;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
}
.tile-dark .rest-card {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
}
.rest-card--great {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, #1f9d55 35%, transparent);
}
.rest-card--good {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, #e59f2f 35%, transparent);
}
.rest-emo {
  width: 38px;
  height: 38px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.7);
}
.tile-dark .rest-emo {
  background: rgba(255, 255, 255, 0.14);
}
.rest-name {
  font-weight: 900;
  font-family: var(--bb-font-headline);
  color: var(--bb-primary);
  font-size: 0.92rem;
}
.tile-dark .rest-name {
  color: #fff;
}
.rest-meta {
  margin-top: 0.1rem;
  color: color-mix(in srgb, var(--bb-muted) 85%, transparent);
  font-size: 0.78rem;
  font-weight: 650;
}
.tile-dark .rest-meta {
  color: rgba(255, 255, 255, 0.75);
}
.rest-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.rest-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.26rem 0.5rem;
  border-radius: 999px;
  font-family: var(--bb-font-label);
  font-weight: 850;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid color-mix(in srgb, var(--bb-primary) 14%, transparent);
  background: rgba(255, 255, 255, 0.4);
  color: color-mix(in srgb, var(--bb-primary) 80%, var(--bb-muted));
}

/* Flavour tuning demo */
.flavor-demo {
  display: grid;
  gap: 0.5rem;
}
.flavor-row {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  align-items: center;
  gap: 0.5rem;
}
.flavor-label {
  font-family: var(--bb-font-label);
  font-weight: 900;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--bb-muted) 80%, transparent);
}
.flavor-meter {
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
  overflow: hidden;
}
.flavor-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
}
.flavor-fill--sweet {
  background: color-mix(in srgb, #fb7185 55%, #fbbf24);
}
.flavor-fill--sour {
  background: color-mix(in srgb, #fde047 60%, #22c55e);
}
.flavor-fill--bitter {
  background: color-mix(in srgb, #334155 55%, #a3a3a3);
}
.flavor-tip {
  font-size: 0.78rem;
  font-weight: 750;
  color: color-mix(in srgb, var(--bb-primary) 75%, var(--bb-muted));
  white-space: nowrap;
}
.flavor-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding-top: 0.2rem;
}
.flavor-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.26rem 0.5rem;
  border-radius: 999px;
  font-family: var(--bb-font-label);
  font-weight: 850;
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid color-mix(in srgb, var(--bb-primary) 14%, transparent);
  background: rgba(255, 255, 255, 0.4);
  color: color-mix(in srgb, var(--bb-primary) 80%, var(--bb-muted));
}

/* Sensory profiling demo */
.pill-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.pill-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  font-family: var(--bb-font-label);
  font-weight: 800;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: rgba(255, 255, 255, 0.32);
  color: inherit;
  opacity: 0.92;
}
.pill-chip.on {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.65);
}
.warn-card {
  border-radius: 14px;
  padding: 0.6rem 0.65rem;
  background: rgba(255, 255, 255, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.55);
}
.warn-title {
  font-weight: 900;
  font-size: 0.8rem;
}
.warn-body {
  margin-top: 0.25rem;
  font-size: 0.72rem;
  line-height: 1.35;
  opacity: 0.9;
}

/* My progress & insights demo */
.profile-bento-demo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}
.profile-bento-panel {
  display: grid;
  gap: 0.5rem;
  padding: 0.65rem 0.7rem;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.65);
  min-width: 0;
}
.progress-mini-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}
.progress-mini-stat {
  text-align: center;
  padding: 0.35rem 0.2rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.5);
}
.progress-mini-value {
  display: block;
  font-family: var(--bb-font-headline);
  font-weight: 900;
  font-size: 1rem;
  line-height: 1.1;
  color: var(--bb-primary);
}
.progress-mini-label {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.58rem;
  font-weight: 750;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--bb-muted) 90%, transparent);
}
.progress-mini-calendar {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.2rem;
}
.progress-mini-day {
  aspect-ratio: 1;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.35);
}
.progress-mini-day.on {
  background: color-mix(in srgb, #9f7bb3 55%, #b89ac8);
}
.insight-mini-card {
  padding: 0.5rem 0.55rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
}
.insight-mini-card--soft {
  opacity: 0.92;
}
.insight-mini-tag {
  display: inline-flex;
  padding: 0.18rem 0.4rem;
  border-radius: 999px;
  font-family: var(--bb-font-label);
  font-weight: 850;
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: color-mix(in srgb, #9f7bb3 25%, white);
  color: color-mix(in srgb, #5c4370 90%, var(--bb-primary));
}
.insight-mini-headline {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1.35;
  color: color-mix(in srgb, #3d2a4a 85%, var(--bb-text));
}

@media (max-width: 980px) {
  .profile-bento-demo {
    grid-template-columns: 1fr;
  }
}

/* Guided cooking demo */
.tile-demo--dark {
  gap: 0.6rem;
}
.step-demo {
  border-radius: 16px;
  padding: 0.75rem 0.8rem;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.step-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.22rem 0.5rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  font-family: var(--bb-font-label);
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 0.6rem;
  color: rgba(255, 255, 255, 0.92);
}
.step-line {
  margin-top: 0.6rem;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 900;
  font-size: 0.95rem;
}
.step-line .emo {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.14);
  display: grid;
  place-items: center;
}
.step-line .txt {
  overflow-wrap: anywhere;
}
.progress {
  margin-top: 0.7rem;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.progress .bar {
  height: 100%;
  width: 40%;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.85);
}
.step-hint {
  margin-top: 0.55rem;
  font-size: 0.78rem;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.85);
}

.micro-flow {
  margin-top: 1rem;
  background: var(--bb-surface-high);
  border-radius: 16px;
  padding: 0.95rem;
  max-width: 360px;
  max-height: 240px;
  overflow: hidden;
}
.micro-title {
  font-family: var(--bb-font-label);
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 0.62rem;
  color: var(--bb-muted);
  margin-bottom: 0.75rem;
}
.micro-card {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 0.7rem;
  align-items: center;
  padding: 0.75rem 0.8rem;
  border-radius: 14px;
  background: var(--bb-surface-lowest);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bb-primary) 10%, transparent);
}
.micro-card--now {
  outline: 2px solid color-mix(in srgb, var(--bb-primary) 65%, transparent);
}
.micro-card--soft {
  opacity: 0.85;
}
.micro-emo {
  width: 38px;
  height: 38px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bb-primary) 8%, transparent);
  display: grid;
  place-items: center;
}
.micro-k {
  font-family: var(--bb-font-label);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--bb-muted);
  font-weight: 800;
}
.micro-v {
  font-size: 0.85rem;
  font-weight: 800;
  margin-top: 0.1rem;
}
.micro-connector {
  height: 14px;
  margin-left: 18px;
  border-left: 2px dotted color-mix(in srgb, var(--bb-primary) 40%, transparent);
}

.page-actions {
  display: flex;
  justify-content: center;
  margin-top: 2rem;
}
.scroll-top-btn {
  min-width: 11rem;
}

@media (max-width: 980px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 1.75rem;
  }
  .intro-pillars {
    grid-template-columns: 1fr;
  }
  .ctas {
    width: 100%;
    flex-direction: column;
    align-items: center;
  }
  .ctas .bb-btn {
    width: min(92%, 28rem);
    justify-content: center;
    text-align: center;
    padding: 1.15rem 1.75rem;
    min-height: 3.25rem;
    font-size: 1.15rem;
  }
  .bento {
    grid-template-columns: 1fr;
  }
  .tile {
    min-height: 0;
  }
}

@media (min-width: 981px) {
  .tile {
    padding: 1.05rem 1.05rem;
    min-height: 110px;
  }
  .hero-copy {
    text-align: center;
    max-width: 56rem;
    margin: 0 auto;
  }
  .hero-eyebrow {
    justify-content: center;
  }
  .hero-points {
    margin-left: auto;
    margin-right: auto;
    text-align: left;
    width: fit-content;
    max-width: 100%;
  }
  .badge {
    margin-left: auto;
    margin-right: auto;
  }
  .lead {
    margin-left: auto;
    margin-right: auto;
  }
  .ctas {
    justify-content: center;
  }
}

</style>
