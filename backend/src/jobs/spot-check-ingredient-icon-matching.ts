import "../env.js";
import { prisma } from "../prisma.js";
import { debugResolveWickedIconForIngredientLabel } from "../services/icons.js";

type Case = {
  ingredient: string;
  expectId?: string;
  /** FAIL if resolved icon id equals this */
  forbidIconId?: string;
  /** FAIL if resolved icon id contains this substring */
  forbidIconIdContains?: string;
  /** FAIL if resolver picked this candidate key (e.g. naked "fillet") */
  forbidChosenKey?: string;
};

const cases: Case[] = [
  { ingredient: "milk", expectId: "milk-glass" },
  { ingredient: "white flour", expectId: "white-flour" },
  { ingredient: "flour", expectId: "white-flour" },
  { ingredient: "lemon juice" },
  { ingredient: "lemonjuice" },
  { ingredient: "hotsauce" },
  { ingredient: "carror", expectId: "carrot" },
  { ingredient: "egg roll wrappers" },
  { ingredient: "dumpling wrappers", expectId: "dumpling-wrappers" },
  {
    ingredient: "butter",
    forbidIconId: "peanut-butter",
    forbidIconIdContains: "peanut",
  },
  {
    ingredient: "smoked salmon fillet",
    forbidChosenKey: "fillet",
    forbidIconIdContains: "ikura",
  },
];

function okLine(ok: boolean): string {
  return ok ? "OK" : "FAIL";
}

for (const c of cases) {
  const resolved = await debugResolveWickedIconForIngredientLabel(c.ingredient);
  const expectedExists = c.expectId
    ? await prisma.wickedIcon.findUnique({ where: { id: c.expectId }, select: { id: true, name: true } })
    : null;

  let ruleOk = true;
  if (c.forbidIconId && resolved.iconId === c.forbidIconId) ruleOk = false;
  if (c.forbidIconIdContains && resolved.iconId?.includes(c.forbidIconIdContains)) ruleOk = false;
  if (c.forbidChosenKey && resolved.chosenKey === c.forbidChosenKey) ruleOk = false;

  const expectOk = !c.expectId || !!expectedExists;
  const allOk = expectOk && ruleOk;

  // eslint-disable-next-line no-console
  console.log(
    [
      okLine(allOk),
      `ingredient="${c.ingredient}"`,
      `candidates=${JSON.stringify(resolved.candidates)}`,
      `method=${resolved.method}`,
      `chosenKey=${resolved.chosenKey ?? "∅"}`,
      `repairedKey=${resolved.repairedKey ?? "∅"}`,
      `resolvedIconId=${resolved.iconId ?? "∅"}`,
      c.expectId ? `expectId=${c.expectId}` : null,
      expectedExists ? `expectName="${expectedExists.name}"` : c.expectId ? "expectMissingInDB" : null,
      !ruleOk ? "RULE_FAIL" : null,
    ]
      .filter(Boolean)
      .join(" | "),
  );
}
