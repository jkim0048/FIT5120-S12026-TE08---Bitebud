<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useSession } from '../composables/useSession'

const { isSignedIn } = useSession()
</script>

<template>
  <main class="page">
    <section class="hero">
      <div class="hero-copy">
        <div class="badge">Sensory-Friendly Cooking</div>
        <h1 class="h1">
          Your Kitchen,<br />
          <span class="h1-sub">Quietly Reimagined.</span>
        </h1>
        <p class="lead">
          BiteBud reduces culinary friction for neurodiverse minds. No loud prompts, no complex grids—just a serene path
          to a safe meal.
        </p>
        <div class="ctas">
          <RouterLink to="/search" class="bb-btn bb-btn--primary cta">Visualise Recipe</RouterLink>
          <RouterLink
            v-if="!isSignedIn"
            to="/auth"
            class="bb-btn bb-btn--secondary cta"
          >
            Sign in / Sign-up
          </RouterLink>
          <span v-else class="bb-btn bb-btn--secondary cta cta--disabled" aria-disabled="true">Sign in / Sign-up</span>
        </div>
      </div>

      <div class="hero-media">
        <div class="media-card" aria-hidden="true">
          <img
            class="media-img"
            alt="BiteBud logo"
            src="/bitesbud-logo.png"
          />
          <div class="media-overlay" />
        </div>
      </div>
    </section>

    <section class="section section-soft">
      <div class="section-head">
        <h2 class="h2">Introducing BiteBud</h2>
        <p class="subhead">
          BiteBud turns recipes into calm, step-by-step flows and helps you set up a sensory profile—so cooking feels more
          predictable and comfortable.
        </p>
      </div>

      <div class="bento">
        <article class="tile tile-wide">
          <div class="tile-icon" aria-hidden="true">▦</div>
          <h3 class="h3">Visual Recipe Flow</h3>
          <p class="tile-copy">
            One instruction at a time. Clear lanes and gentle pacing replace cluttered lists—so your attention stays on
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
        </article>

        <article class="tile tile-green">
          <div class="tile-icon" aria-hidden="true">❋</div>
          <h3 class="h3">Sensory Profiling</h3>
          <p class="tile-copy">
            Set up your sensory profile now. Filter by texture, temperature, and smell—so recipes feel safer and more
            predictable.
          </p>
          <RouterLink v-if="!isSignedIn" to="/auth" class="tile-link">Sign in / Sign-up →</RouterLink>
          <span v-else class="tile-link tile-link--disabled">Signed in</span>
        </article>

        <article class="tile">
          <div class="tile-icon" aria-hidden="true">⌁</div>
          <h3 class="h3">Safe Food Library</h3>
          <p class="tile-copy">Save what works, hide what doesn’t, and return to calm defaults.</p>
          <div class="thumb-grid" aria-hidden="true">
            <div class="thumb" />
            <div class="thumb" />
            <div class="thumb" />
          </div>
        </article>

        <article class="tile tile-dark">
          <h3 class="h3">Guided cooking</h3>
          <p class="tile-copy">
            Cook with one clear step at a time. Track progress, stay oriented, and move at your pace.
          </p>
        </article>
      </div>
    </section>

    <section class="section">
      <div class="cta-card">
        <div class="cta-copy">
          <h2 class="h2">Ready for a calmer kitchen?</h2>
          <p class="subhead">Start with a recipe search—or build your sensory profile first.</p>
        </div>
        <div class="cta-actions">
          <RouterLink to="/search" class="bb-btn bb-btn--primary cta">Find a recipe</RouterLink>
          <RouterLink v-if="!isSignedIn" to="/auth" class="bb-btn bb-btn--secondary cta">Sign in / Sign-up</RouterLink>
          <span v-else class="bb-btn bb-btn--secondary cta cta--disabled" aria-disabled="true">Sign in / Sign-up</span>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3.5rem;
}

.hero {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  align-items: center;
  gap: 3.5rem;
  padding: 2.5rem 0 2.25rem;
}
.hero-copy {
  min-width: 0;
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
.h1-sub {
  color: var(--bb-primary-container);
}
.lead {
  margin: 0;
  max-width: 38rem;
  color: var(--bb-muted);
  font-size: 1.1rem;
  line-height: 1.7;
}
.ctas {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.25rem;
}
.cta {
  padding: 0.85rem 1.15rem;
  font-family: var(--bb-font-headline);
  font-weight: 700;
}
.cta--disabled {
  opacity: 0.55;
  cursor: not-allowed;
  pointer-events: none;
}
.tile-link--disabled {
  opacity: 0.55;
  cursor: default;
}

.hero-media {
  position: relative;
}
.media-card {
  border-radius: 24px;
  background: var(--bb-surface-low);
  padding: 1.1rem;
  overflow: hidden;
}
.media-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: contain;
  border-radius: 18px;
  padding: 0.75rem;
  background: var(--bb-surface-lowest);
}
.media-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 30% 30%, rgba(68, 98, 113, 0.08), transparent 60%);
  pointer-events: none;
}

.section {
  margin-top: 3rem;
}
.section-soft {
  background: var(--bb-surface-low);
  border-radius: 20px;
  padding: 2.5rem 1.25rem;
}
.section-head {
  max-width: 44rem;
  margin: 0 auto 1.5rem;
  padding: 0 0.5rem;
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

.bento {
  max-width: 68rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 0.9rem;
  padding: 0 0.5rem;
}
.tile {
  background: var(--bb-surface-lowest);
  border-radius: 16px;
  padding: 1.35rem 1.35rem;
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.04);
  height: 100%;
  display: flex;
  flex-direction: column;
  align-self: stretch;
}
.tile-wide {
  grid-column: span 8;
}
.tile-green {
  grid-column: span 4;
  background: var(--bb-secondary-container);
}
.tile:not(.tile-wide):not(.tile-green):not(.tile-dark) {
  grid-column: span 5;
}
.tile-dark {
  grid-column: span 7;
  background: var(--bb-primary);
  color: #fff;
}
.tile-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bb-primary) 10%, transparent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  color: var(--bb-primary);
}
.tile-green .tile-icon {
  background: rgba(255, 255, 255, 0.35);
  color: var(--bb-on-secondary-container);
}
.h3 {
  margin: 0.85rem 0 0.35rem;
  font-family: var(--bb-font-headline);
  font-weight: 800;
  color: inherit;
}
.tile-copy {
  margin: 0;
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

.micro-flow {
  margin-top: 1rem;
  background: var(--bb-surface-high);
  border-radius: 16px;
  padding: 0.95rem;
  max-width: 360px;
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

.thumb-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
  margin-top: 1rem;
  margin-top: auto;
  padding-top: 1rem;
}
.thumb {
  aspect-ratio: 1 / 1;
  border-radius: 12px;
  background: var(--bb-surface-low);
}

.cta-card {
  border-radius: 22px;
  background: var(--bb-surface-high);
  padding: 1.6rem 1.35rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.cta-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

@media (max-width: 980px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 1.75rem;
  }
  .tile-wide {
    grid-column: span 12;
  }
  .tile-green {
    grid-column: span 12;
  }
  .tile {
    grid-column: span 12;
  }
  .tile-dark {
    grid-column: span 12;
  }
}
</style>
