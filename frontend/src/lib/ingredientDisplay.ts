/** Strip `For the …:` accidentally stored on the ingredient label. */
export function stripLeadingForTheFromLabel(label: string): string {
  return label.replace(/^((?:for\s+the\s+)[^:]+):\s*/i, '').trim()
}

/** Remove trailing duplicate ingredient name from a qty line. */
function qtyDetailWithoutTrailingLabel(detail: string, label: string): string {
  const d = detail.trim()
  const lab = label.trim()
  if (!lab || !d) return d
  const escaped = lab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const trimmed = d.replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '').trim()
  return trimmed.length >= 2 ? trimmed : d
}

function stripLabelFromQuantityDetail(detail: string, label: string): string {
  let d = detail.trim()
  const lab = label.trim()
  if (!lab || !d) return d

  d = qtyDetailWithoutTrailingLabel(d, lab)
  const escaped = lab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutLeading = d.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim()
  if (withoutLeading.length >= 1 && withoutLeading.length < d.length) d = withoutLeading

  const cleaned = stripUnitPrefixFromName(lab)
  if (cleaned && cleaned.toLowerCase() !== lab.toLowerCase()) {
    d = qtyDetailWithoutTrailingLabel(d, cleaned)
    const escapedClean = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const withoutLeadingClean = d.replace(new RegExp(`^${escapedClean}\\s+`, 'i'), '').trim()
    if (withoutLeadingClean.length >= 1 && withoutLeadingClean.length < d.length) d = withoutLeadingClean
  }

  return d.trim()
}

const UNIT_PREFIX_ON_NAME = /^(?:(?:\d+(?:\.\d+)?\s*)?)(?:tbs?|tbsp|tblsp|tsp|g|kg|ml|l|oz|cups?|cup)\s+/i

function stripUnitPrefixFromName(name: string): string {
  return name.trim().replace(UNIT_PREFIX_ON_NAME, '').trim()
}

const LEADING_QUANTITY =
  /^([\d]+(?:[./]\d+)?(?:\s*[-–]\s*[\d]+(?:[./]\d+)?)?(?:\s*(?:g|kg|mg|ml|l|cl|oz|lb|lbs|cups?|cup|tbsp|tbs|tblsp|tsp|pieces?|slices?|cloves?|pinch(?:es)?|bunch(?:es)?))?)\s+(.+)$/i

function detailMentionsName(detail: string, name: string): boolean {
  const dLo = detail.toLowerCase()
  const tokens = name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
  if (!tokens.length) return false
  return tokens.some((t) => dLo.includes(t))
}

function isMeasureOnly(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (/^[\d./\s\-–]+$/.test(t)) return true
  return /^[\d./\s\-–]+(?:\s*(?:g|kg|mg|ml|l|tbs?|tbsp|tblsp|tsp|oz|cups?|cup|lb|lbs|cloves?|pieces?|slices?))$/i.test(t)
}

/**
 * Split checklist label + scaled detail into display name and quantity only
 * (e.g. label "Pork Chops", detail "4 Pork Chops" → name "Pork Chops", quantity "4").
 */
export function splitIngredientNameAndQuantity(
  label: string,
  detail: string,
): { name: string; quantity: string } {
  const rawLabel = stripLeadingForTheFromLabel(label).trim() || label.trim()
  const rawDetail = detail.trim()

  if (!rawLabel && !rawDetail) return { name: '—', quantity: '—' }
  if (!rawLabel) return { name: rawDetail, quantity: '—' }

  const name = stripUnitPrefixFromName(rawLabel) || rawLabel

  if (!rawDetail) {
    const fromLabel = rawLabel.match(LEADING_QUANTITY)
    if (fromLabel) {
      const parsedName = stripUnitPrefixFromName(fromLabel[2].trim()) || fromLabel[2].trim()
      return { name: parsedName, quantity: fromLabel[1].trim() }
    }
    return { name, quantity: '—' }
  }

  let quantity = rawDetail
  if (detailMentionsName(rawDetail, rawLabel) || detailMentionsName(rawDetail, name)) {
    quantity = stripLabelFromQuantityDetail(rawDetail, rawLabel)
    const alt = stripLabelFromQuantityDetail(rawDetail, name)
    if (alt && (isMeasureOnly(alt) || alt.length < quantity.length)) quantity = alt
  } else if (isMeasureOnly(rawDetail)) {
    quantity = rawDetail
  }

  if (detailMentionsName(quantity, name)) {
    const m = quantity.match(LEADING_QUANTITY)
    if (m && detailMentionsName(m[2], name)) quantity = m[1].trim()
  }

  const qtyNorm = quantity.trim().toLowerCase()
  if (!qtyNorm || qtyNorm === rawLabel.toLowerCase() || qtyNorm === name.toLowerCase()) {
    quantity = '—'
  }

  return { name, quantity }
}
