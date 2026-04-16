import { prisma } from "../prisma.js";

async function main(): Promise<void> {
  const keys = [
    "soy sauce",
    "duck sauce",
    "plum sauce",
    "sauce",
    "spring onion",
    "scallion",
    "green onion",
    "wrappers",
    "dumpling wrapper",
    "oil",
  ];

  for (const k of keys) {
    const row = await prisma.ingredientIconMap.findUnique({ where: { ingredientKey: k } });
    // eslint-disable-next-line no-console
    console.log(`${k} => ${row?.wickedIconId ?? "none"}`);
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

