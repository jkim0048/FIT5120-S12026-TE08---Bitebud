import { prisma } from "../prisma.js";

/** Sensory persistence — single owner for sensory profiles, food items, and code attempts. */
export const sensoryProfileDatabase = {
  sensoryProfileFindUnique: prisma.sensoryProfile.findUnique.bind(prisma.sensoryProfile),

  sensoryProfileUpsert: prisma.sensoryProfile.upsert.bind(prisma.sensoryProfile),

  sensoryFoodItemFindMany: prisma.sensoryFoodItem.findMany.bind(prisma.sensoryFoodItem),

  sensoryFoodItemFindFirst: prisma.sensoryFoodItem.findFirst.bind(prisma.sensoryFoodItem),

  sensoryFoodItemCreate: prisma.sensoryFoodItem.create.bind(prisma.sensoryFoodItem),

  sensoryFoodItemUpdate: prisma.sensoryFoodItem.update.bind(prisma.sensoryFoodItem),

  sensoryFoodItemDelete: prisma.sensoryFoodItem.delete.bind(prisma.sensoryFoodItem),

  sensoryCodeAttemptFindUnique: prisma.sensoryCodeAttempt.findUnique.bind(prisma.sensoryCodeAttempt),

  sensoryCodeAttemptUpsert: prisma.sensoryCodeAttempt.upsert.bind(prisma.sensoryCodeAttempt),

  sensoryCodeAttemptDelete: prisma.sensoryCodeAttempt.delete.bind(prisma.sensoryCodeAttempt),
};
