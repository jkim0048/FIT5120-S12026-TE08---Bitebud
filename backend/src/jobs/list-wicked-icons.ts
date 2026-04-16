import "../env.js";
import { prisma } from "../prisma.js";

const q = (process.env.WICKED_LIST_QUERY ?? "").trim().toLowerCase();
const limit = Number(process.env.WICKED_LIST_LIMIT ?? 200);

const rows = await prisma.wickedIcon.findMany({
  where: q
    ? {
        OR: [
          { id: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      }
    : undefined,
  orderBy: { name: "asc" },
  take: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 2000) : 200,
  select: { id: true, name: true },
});

for (const r of rows) {
  // eslint-disable-next-line no-console
  console.log(`${r.id}\t${r.name}`);
}

// eslint-disable-next-line no-console
console.log(`\ncount=${rows.length}`);

