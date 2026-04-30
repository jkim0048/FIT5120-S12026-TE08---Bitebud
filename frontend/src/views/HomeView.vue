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
          Cooking,<br />
          <span class="h1-sub">Made simple.</span>
        </h1>
        <p class="lead">
          BiteBud reduces culinary friction for neurodiverse minds. No loud prompts, no complex grids just a serene path
          to a safe meal.
        </p>
        <div class="ctas">
          <RouterLink to="/search" class="bb-btn bb-btn--primary cta">Let's Start Cooking</RouterLink>
          <RouterLink to="/restaurants" class="bb-btn bb-btn--secondary cta">Find sensory restaurant</RouterLink>
          <RouterLink v-if="!isSignedIn" to="/auth" class="bb-btn bb-btn--secondary cta">Customise sensory profile</RouterLink>
          <RouterLink v-else to="/sensory/setup" class="bb-btn bb-btn--secondary cta">Customise sensory profile</RouterLink>
        </div>
      </div>
    </section>

    <section class="section section-soft">
      <div class="section-head">
        <div class="intro-head">
          <h2 class="h2">Introducing BiteBud</h2>
        </div>
        <p class="subhead">
          BiteBud turns recipes into calm, step-by-step flows and helps you set up a sensory profile—so cooking feels more
          predictable and comfortable.
        </p>
      </div>

      <div class="bento">
        <details class="tile tile-wide">
          <summary class="tile-summary">
            <h3 class="h3">Visual Recipe Flow</h3>
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

        <details class="tile tile-green">
          <summary class="tile-summary">
            <h3 class="h3">Sensory Profiling</h3>
            <span class="tile-summary__chevron" aria-hidden="true">⌄</span>
          </summary>
          <p class="tile-copy">
            Customise your sensory profile and filter by dietary and cultural requirements.
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

        <details class="tile tile-dark">
          <summary class="tile-summary">
            <h3 class="h3">Guided cooking</h3>
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

.bento {
  max-width: 68rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
  padding: 0;
}
.tile {
  background: var(--bb-surface-lowest);
  border-radius: 16px;
  padding: 0.85rem 0.85rem;
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.04);
  min-height: 84px;
  display: flex;
  flex-direction: column;
  align-self: stretch;
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
