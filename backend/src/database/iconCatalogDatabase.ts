import { prisma } from "../prisma.js";

/** Icon catalog persistence — single owner for Wicked icons + ingredient maps + user overrides. */
export const iconCatalogDatabase = {
  wickedIconCount: () => prisma.wickedIcon.count(),

  wickedIconFindMany: prisma.wickedIcon.findMany.bind(prisma.wickedIcon),

  wickedIconFindUnique: prisma.wickedIcon.findUnique.bind(prisma.wickedIcon),

  wickedIconFindFirst: prisma.wickedIcon.findFirst.bind(prisma.wickedIcon),

  wickedIconUpsert: prisma.wickedIcon.upsert.bind(prisma.wickedIcon),

  ingredientIconMapFindMany: prisma.ingredientIconMap.findMany.bind(prisma.ingredientIconMap),

  ingredientIconMapFindUnique: prisma.ingredientIconMap.findUnique.bind(prisma.ingredientIconMap),

  ingredientIconMapUpsert: prisma.ingredientIconMap.upsert.bind(prisma.ingredientIconMap),

  userIconOverrideUpsert: prisma.userIconOverride.upsert.bind(prisma.userIconOverride),

  userIconOverrideFindUnique: prisma.userIconOverride.findUnique.bind(prisma.userIconOverride),

  userIconOverrideFindMany: prisma.userIconOverride.findMany.bind(prisma.userIconOverride),
};
