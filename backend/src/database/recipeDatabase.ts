import { prisma } from "../prisma.js";

/** Recipe persistence — single owner for `recipe`, `recipeProgress`, `recipeCompletion` Prisma calls. */
export const recipeDatabase = {
  recipeCreate: prisma.recipe.create.bind(prisma.recipe),

  recipeUpdate: prisma.recipe.update.bind(prisma.recipe),

  recipeFindMany: prisma.recipe.findMany.bind(prisma.recipe),

  recipeFindUnique: prisma.recipe.findUnique.bind(prisma.recipe),

  recipeProgressUpsert: prisma.recipeProgress.upsert.bind(prisma.recipeProgress),

  recipeProgressFindUnique: prisma.recipeProgress.findUnique.bind(prisma.recipeProgress),

  recipeCompletionCreate: prisma.recipeCompletion.create.bind(prisma.recipeCompletion),

  recipeCompletionCount: prisma.recipeCompletion.count.bind(prisma.recipeCompletion),

  recipeCompletionFindMany: prisma.recipeCompletion.findMany.bind(prisma.recipeCompletion),
};
