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

async function loadImageAsDataUrl(src: string): Promise<string> {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Failed to load image: ${src}`)
  const blob = await res.blob()

  const imgUrl = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not decode image'))
      el.src = imgUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(imgUrl)
  }
}

export async function downloadShoppingListPdf(payload: ShoppingListPdfPayload): Promise<void> {
  const title = (payload.recipeTitle || 'Recipe').trim() || 'Recipe'
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 48
  const contentW = pageW - margin * 2
  const footerText = 'Created by BiteBud'

  let y = margin

  function drawFooter() {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(110)
    doc.text(footerText, margin, pageH - margin + 18)
    doc.setTextColor(0)
  }

  function addPageWithFooter() {
    doc.addPage()
    drawFooter()
  }

  // Footer for first page.
  drawFooter()

  let logoDataUrl: string | null = null
  try {
    logoDataUrl = await loadImageAsDataUrl('/bitebud-mark.png')
  } catch {
    logoDataUrl = null
  }
  const logoSize = 28
  const headerX = logoDataUrl ? margin + logoSize + 10 : margin
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', margin, y - 8, logoSize, logoSize)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  const header = `Shopping list — ${title}`
  doc.text(header, headerX, y)
  y += 22

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  const metaBits = [payload.servingsLabel].filter((x): x is string => Boolean(x && x.trim()))
  if (metaBits.length) {
    doc.setTextColor(90)
    doc.text(metaBits.join(' • '), headerX, y)
    doc.setTextColor(0)
    y += 18
  } else {
    y += 6
  }

  const lineH = 14
  const sectionGap = 10

  function ensureSpace(nextHeight: number) {
    if (y + nextHeight <= pageH - margin) return
    addPageWithFooter()
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

