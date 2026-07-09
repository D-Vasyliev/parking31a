import { Hono } from "hono";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { AppContext } from "../env";
import { createDb } from "../db";
import { spots, spotOwners, owners, projects } from "../db/schema";
import { requireAuth } from "../middleware";
import type { Section } from "../../shared/spots";
import type { SearchResults, SearchSpot, SearchOwner, SearchProject } from "../../shared/api";

// Гомогліфи кирилиця→латиниця для номерних знаків (А↔A тощо).
const CYR2LAT: Record<string, string> = {
  А: "A", В: "B", С: "C", Е: "E", Н: "H", І: "I", К: "K", М: "M", О: "O", Р: "P", Т: "T", Х: "X",
};
function normPlate(s: string): string {
  return s
    .toUpperCase()
    .split("")
    .map((ch) => CYR2LAT[ch] ?? ch)
    .join("")
    .replace(/[^A-Z0-9]/g, "");
}
const digitsOf = (s: string) => s.replace(/\D/g, "");

export const searchRouter = new Hono<AppContext>();
searchRouter.use("*", requireAuth);

searchRouter.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const empty: SearchResults = { spots: [], owners: [], projects: [] };
  if (q.length < 1) return c.json(empty);
  const db = createDb(c.env.DB);
  const ql = q.toLowerCase();
  const qPlate = normPlate(q);
  const qDigits = digitsOf(q);

  const spotRows = await db
    .select({ number: spots.number, section: spots.section, plate: spots.plate, ownerName: owners.fullName })
    .from(spots)
    .leftJoin(spotOwners, and(eq(spotOwners.spotId, spots.id), isNull(spotOwners.endedAt), eq(spotOwners.isPrimary, 1)))
    .leftJoin(owners, eq(owners.id, spotOwners.ownerId))
    .orderBy(asc(spots.id));
  const spotResults: SearchSpot[] = [];
  for (const r of spotRows) {
    const numMatch = /^\d+$/.test(q) && String(r.number).startsWith(q);
    const plateMatch = qPlate.length >= 2 && r.plate != null && normPlate(r.plate).includes(qPlate);
    if (numMatch || plateMatch) spotResults.push({ number: Number(r.number), section: r.section as Section, ownerName: r.ownerName, plate: r.plate });
    if (spotResults.length >= 8) break;
  }

  const ownerRows = await db.select().from(owners).orderBy(asc(owners.fullName));
  const ownerResults: SearchOwner[] = [];
  for (const o of ownerRows) {
    const nameMatch = o.fullName.toLowerCase().includes(ql);
    const phoneMatch = qDigits.length >= 3 && o.phone != null && digitsOf(o.phone).includes(qDigits);
    if (nameMatch || phoneMatch) ownerResults.push({ id: o.id, fullName: o.fullName, phone: o.phone });
    if (ownerResults.length >= 8) break;
  }

  const projRows = await db.select({ id: projects.id, title: projects.title, status: projects.status }).from(projects).orderBy(desc(projects.id));
  const projResults: SearchProject[] = projRows.filter((p) => p.title.toLowerCase().includes(ql)).slice(0, 8);

  return c.json({ spots: spotResults, owners: ownerResults, projects: projResults } satisfies SearchResults);
});
