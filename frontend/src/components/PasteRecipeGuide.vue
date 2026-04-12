<template>
  <div class="paste-guide" role="region" aria-labelledby="paste-guide-title">
    <h2 id="paste-guide-title" class="paste-guide__title">How to paste a recipe</h2>
    <p class="paste-guide__intro">
      You can turn plain text into calm, step-by-step cooking. Follow these steps.
    </p>
    <ol class="paste-guide__steps">
      <li class="paste-guide__step">
        <span class="paste-guide__num" aria-hidden="true">1</span>
        <div class="paste-guide__body">
          <strong class="paste-guide__head">Open any recipe</strong>
          <p class="paste-guide__text">Use a website, book, or note—anywhere your recipe lives.</p>
        </div>
      </li>
      <li class="paste-guide__step">
        <span class="paste-guide__num" aria-hidden="true">2</span>
        <div class="paste-guide__body">
          <strong class="paste-guide__head">Copy the full text</strong>
          <p class="paste-guide__text">Include ingredients and instructions together when you can. That helps BiteBud build a clear flow.</p>
        </div>
      </li>
      <li class="paste-guide__step">
        <span class="paste-guide__num" aria-hidden="true">3</span>
        <div class="paste-guide__body">
          <strong class="paste-guide__head">Paste into the box above</strong>
          <p class="paste-guide__text">Paste everything into the large text box in the toolbar.</p>
        </div>
      </li>
      <li class="paste-guide__step">
        <span class="paste-guide__num" aria-hidden="true">4</span>
        <div class="paste-guide__body">
          <strong class="paste-guide__head">Tap Visualise</strong>
          <p class="paste-guide__text">We will open your recipe with ingredients, roadmap, and a visual flow you can cook from.</p>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.paste-guide {
  padding: 1.25rem 1.15rem 1.5rem;
  border-radius: 18px;
  background: var(--bb-surface-lowest);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 10%, transparent);
  box-shadow: 0 12px 32px rgba(26, 28, 25, 0.05);
  max-width: 44rem;
}
.paste-guide__title {
  margin: 0;
  font-family: var(--bb-font-headline);
  font-size: 1.2rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--bb-text);
}
.paste-guide__intro {
  margin: 0.5rem 0 0;
  color: var(--bb-muted);
  font-size: 0.95rem;
  line-height: 1.55;
}
.paste-guide__steps {
  margin: 1.1rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.85rem;
}
.paste-guide__step {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 0.75rem;
  align-items: start;
  padding: 0.75rem 0.85rem;
  border-radius: 14px;
  background: var(--bb-surface-low);
  border: 1px solid color-mix(in srgb, var(--bb-primary) 8%, transparent);
}
.paste-guide__num {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-family: var(--bb-font-headline);
  font-weight: 900;
  font-size: 0.95rem;
  background: color-mix(in srgb, var(--bb-primary) 14%, transparent);
  color: var(--bb-text);
}
.paste-guide__head {
  display: block;
  font-size: 0.95rem;
  color: var(--bb-text);
}
.paste-guide__text {
  margin: 0.35rem 0 0;
  font-size: 0.88rem;
  line-height: 1.5;
  color: var(--bb-muted);
}
</style>
