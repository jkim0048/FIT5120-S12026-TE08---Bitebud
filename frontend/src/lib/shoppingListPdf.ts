import { jsPDF } from 'jspdf'

export type ShoppingListPdfRow = {
  name: string
  quantity: string
  imageSrc: string | null
  visualFallback: string
}

export type ShoppingListPdfGroup = {
  title: string | null
  rows: ShoppingListPdfRow[]
}

export type ShoppingListPdfPayload = {
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

function resolveAssetUrl(src: string): string {
  const s = src.trim()
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s
  if (typeof window !== 'undefined' && window.location?.origin) {
    return s.startsWith('/') ? `${window.location.origin}${s}` : `${window.location.origin}/${s}`
  }
  return s
}

async function loadImageAsDataUrl(src: string): Promise<string> {
  const res = await fetch(resolveAssetUrl(src))
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

async function preloadRowImages(rows: ShoppingListPdfRow[]): Promise<Map<ShoppingListPdfRow, string>> {
  const out = new Map<ShoppingListPdfRow, string>()
  await Promise.all(
    rows.map(async (row) => {
      if (!row.imageSrc) return
      try {
        out.set(row, await loadImageAsDataUrl(row.imageSrc))
      } catch {
        /* use visualFallback in cell */
      }
    }),
  )
  return out
}

/** Render and download a printable shopping-list PDF (tabular: ingredient, quantity, image). */
export async function downloadShoppingListPdf(payload: ShoppingListPdfPayload): Promise<void> {
  const title = (payload.recipeTitle || 'Recipe').trim() || 'Recipe'
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 48
  const contentW = pageW - margin * 2
  const footerText = 'Created by BiteBud'

  const colCheck = 18
  const colImage = 36
  const colQty = 108
  const colGap = 8
  const colName = contentW - colCheck - colImage - colQty - colGap * 2
  const xCheck = margin
  const xName = margin + colCheck + colGap
  const xQty = xName + colName + colGap
  const xImage = margin + contentW - colImage
  const imageSize = 28
  const lineH = 13
  const headerH = 20
  const rowPad = 6

  const allRows = [
    ...payload.buyGroups.flatMap((g) => g.rows),
    ...(payload.pantryGroups ?? []).flatMap((g) => g.rows),
  ]
  const imageByRow = await preloadRowImages(allRows)

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
  doc.text(`Shopping list — ${title}`, headerX, y)
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

  function drawCheckbox(cx: number, cy: number) {
    const size = 10
    doc.setDrawColor(80)
    doc.setLineWidth(0.6)
    doc.rect(cx, cy - size + 2, size, size)
    doc.setDrawColor(0)
  }

  function drawTableHeader() {
    ensureSpace(headerH + 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('Ingredient', xName, y)
    doc.text('Required quantity', xQty, y)
    doc.text('Image', xImage + colImage / 2, y, { align: 'center' })
    y += headerH
    doc.setDrawColor(180)
    doc.setLineWidth(0.5)
    doc.line(margin, y - 6, margin + contentW, y - 6)
    doc.setDrawColor(0)
  }

  function drawTableRow(row: ShoppingListPdfRow) {
    const name = (row.name || '').trim() || '—'
    const quantity = (row.quantity || '').trim() || '—'
    const nameLines = doc.splitTextToSize(name, colName) as string[]
    const qtyLines = doc.splitTextToSize(quantity, colQty) as string[]
    const textLines = Math.max(nameLines.length, qtyLines.length, 1)
    const rowH = Math.max(textLines * lineH + rowPad, imageSize + rowPad)

    ensureSpace(rowH + 2)
    const rowTop = y
    const midY = rowTop + rowH / 2

    drawCheckbox(xCheck, midY)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    let ty = rowTop + rowPad / 2 + lineH - 2
    for (let i = 0; i < textLines; i++) {
      if (nameLines[i]) doc.text(nameLines[i], xName, ty)
      if (qtyLines[i]) doc.text(qtyLines[i], xQty, ty)
      ty += lineH
    }

    const imgData = imageByRow.get(row)
    const imgY = rowTop + (rowH - imageSize) / 2
    if (imgData) {
      try {
        doc.addImage(imgData, 'PNG', xImage, imgY, imageSize, imageSize)
      } catch {
        doc.setFontSize(14)
        doc.text(row.visualFallback, xImage + colImage / 2, midY + 4, { align: 'center' })
        doc.setFontSize(10)
      }
    } else {
      doc.setFontSize(14)
      doc.text(row.visualFallback, xImage + colImage / 2, midY + 4, { align: 'center' })
      doc.setFontSize(10)
    }

    y = rowTop + rowH
    doc.setDrawColor(220)
    doc.setLineWidth(0.35)
    doc.line(margin, y, margin + contentW, y)
    doc.setDrawColor(0)
    y += 2
  }

  function drawGroups(groups: ShoppingListPdfGroup[]) {
    const hasRows = groups.some((g) => g.rows.length > 0)
    if (!hasRows) return

    drawTableHeader()

    for (const g of groups) {
      if (g.title) {
        ensureSpace(22)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.text(g.title, margin, y)
        y += 16
      }
      for (const row of g.rows) {
        drawTableRow(row)
      }
      y += 6
    }
  }

  drawSubHeader('List of ingredients I need to buy')
  if (payload.buyGroups.some((g) => g.rows.length > 0)) {
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
  if (pantryGroups.some((g) => g.rows.length > 0)) {
    y += 6
    drawSubHeader('List of ingredients I already have')
    drawGroups(pantryGroups)
  }

  doc.save(`shopping-list-${safeFilenamePart(title)}.pdf`)
}
