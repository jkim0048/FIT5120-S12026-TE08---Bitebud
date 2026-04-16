import { prisma } from "../prisma.js";

async function main(): Promise<void> {
  const keys = ["oil", "sauce", "green onion"];
  const res = await prisma.ingredientIconMap.deleteMany({
    where: { ingredientKey: { in: keys } },
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ deleted: res.count, keys }, null, 2));
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

