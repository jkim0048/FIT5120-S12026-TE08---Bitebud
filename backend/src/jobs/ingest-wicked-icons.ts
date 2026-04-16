import "../env.js";
import { ingestWickedIcons } from "../services/icons.js";

const limit = Number(process.env.WICKED_INGEST_LIMIT ?? 1000);
const includeAssets = process.env.WICKED_INGEST_ASSETS !== "false";
const sourceUrl = process.env.WICKED_SOURCE_URL;

const result = await ingestWickedIcons({
  sourceUrl,
  limit: Number.isFinite(limit) && limit > 0 ? limit : 1000,
  includeAssets,
});

console.log(result);
