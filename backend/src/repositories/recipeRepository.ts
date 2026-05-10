import { prisma } from "../prisma.js";

export const recipeRepository = {
  recipeCreate: prisma.recipe.create.bind(prisma.recipe),

  recipeUpdate: prisma.recipe.update.bind(prisma.recipe),

  recipeFindMany: prisma.recipe.findMany.bind(prisma.recipe),

  recipeFindUnique: prisma.recipe.findUnique.bind(prisma.recipe),

  recipeProgressUpsert: prisma.recipeProgress.upsert.bind(prisma.recipeProgress),

  recipeProgressFindUnique: prisma.recipeProgress.findUnique.bind(prisma.recipeProgress),
};
