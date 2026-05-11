import { jsPDF } from 'jspdf'

type ShoppingListPdfGroup = {
  title: string | null
  lines: string[]
}

type ShoppingListPdfPayload = {
  recipeTitle: string
  servingsLabel: string | null
  buyGroups: ShoppingListPdfGroup[]
  pantryGroups?: ShoppingListPdfGroup[]
}

function safeFilenamePart(v: string): string {
  return v
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

export function downloadShoppingListPdf(payload: ShoppingListPdfPayload) {
  const title = (payload.recipeTitle || 'Recipe').trim() || 'Recipe'
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 48
  const contentW = pageW - margin * 2

  let y = margin

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  const header = `Shopping list — ${title}`
  doc.text(header, margin, y)
  y += 22

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  const metaBits = [payload.servingsLabel].filter((x): x is string => Boolean(x && x.trim()))
  if (metaBits.length) {
    doc.setTextColor(90)
    doc.text(metaBits.join(' • '), margin, y)
    doc.setTextColor(0)
    y += 18
  } else {
    y += 6
  }

  const lineH = 14
  const sectionGap = 10

  function ensureSpace(nextHeight: number) {
    if (y + nextHeight <= pageH - margin) return
    doc.addPage()
    y = margin
  }

  function drawSubHeader(text: string) {
    ensureSpace(26)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(text, margin, y)
    y += 18
  }

  function drawGroups(groups: ShoppingListPdfGroup[]) {
    for (const g of groups) {
      if (g.title) {
        ensureSpace(22)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(12)
        doc.text(g.title, margin, y)
        y += 18
      }

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)

      for (const raw of g.lines) {
        const line = (raw || '').trim()
        if (!line) continue

        const bullet = '• '
        const wrapped = doc.splitTextToSize(`${bullet}${line}`, contentW) as string[]
        ensureSpace(wrapped.length * lineH + 2)
        for (const w of wrapped) {
          doc.text(w, margin, y)
          y += lineH
        }
      }

      y += sectionGap
    }
  }

  drawSubHeader('List of ingredients I need to buy')
  if (payload.buyGroups.length) {
    drawGroups(payload.buyGroups)
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(90)
    doc.text('All ingredients are checked — nothing to buy.', margin, y)
    doc.setTextColor(0)
    y += 18
  }

  const pantryGroups = payload.pantryGroups ?? []
  if (pantryGroups.length) {
    y += 6
    drawSubHeader('List of ingredients I already have')
    drawGroups(pantryGroups)
  }

  const filename = `shopping-list-${safeFilenamePart(title)}.pdf`
  doc.save(filename)
}

