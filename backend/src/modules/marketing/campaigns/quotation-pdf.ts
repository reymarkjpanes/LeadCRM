import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';
import { formatMoney, type QuotationDocument } from '@leadcrm/shared';

/** One renderer for reusable templates, completed previews and mail attachments. */
export async function renderQuotationPdf(value: QuotationDocument): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: {
    Title: value.quotationTitle, Creator: 'LeadCRM', CreationDate: new Date(`${value.date || '2000-01-01'}T00:00:00Z`),
  } });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolveOutput, reject) => {
    doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolveOutput(Buffer.concat(chunks))); doc.on('error', reject);
  });
  const fonts = resolve(__dirname, '../../../../assets/fonts');
  doc.registerFont('Regular', resolve(fonts, 'NotoSans-Regular.ttf'));
  doc.registerFont('Bold', resolve(fonts, 'NotoSans-Bold.ttf'));
  const left = 42, width = doc.page.width - 84, bottom = () => doc.page.height - 54;
  const room = (height: number) => { if (doc.y + height > bottom()) doc.addPage(); };
  const text = (content: string, bold = false, size = 9) => {
    doc.font(bold ? 'Bold' : 'Regular').fontSize(size).fillColor('#172033').text(content, left, doc.y, { width, lineGap: 3 });
    doc.moveDown(0.6);
  };
  text(value.quotationTitle, true, 22);
  text(value.header);
  text(`Quotation #: ${value.number}\nDate: ${value.date || '{{quotationDate}}'}\nValid Until: ${value.validUntil || '{{validUntil}}'}`, true);
  text('TO:', true);
  text([value.recipient.name, value.recipient.companyName, value.recipient.email, value.recipient.address].filter(Boolean).join('\n'));
  text(value.introduction);
  const widths = [105, width - 105 - 34 - 90 - 95, 34, 90, 95];
  const row = (cells: string[], heading = false) => {
    doc.font(heading ? 'Bold' : 'Regular').fontSize(8);
    const height = Math.max(25, ...cells.map((cell, index) => doc.heightOfString(cell, { width: widths[index] - 12 }) + 14));
    if (doc.y + height > bottom()) { doc.addPage(); if (!heading) tableHeading(); }
    doc.font(heading ? 'Bold' : 'Regular').fontSize(8);
    const y = doc.y;
    let x = left;
    cells.forEach((cell, index) => {
      doc.rect(x, y, widths[index], height).fillAndStroke(heading ? '#EEF2F7' : '#FFFFFF', '#D5DCE5');
      doc.fillColor('#172033').text(cell, x + 6, y + 6, { width: widths[index] - 12, align: index >= 2 ? 'right' : 'left', lineBreak: true });
      x += widths[index];
    });
    doc.y = y + height; doc.x = left;
  };
  const tableHeading = () => row(['Product', 'Description', 'Qty', 'Unit Price', 'Total'], true);
  room(55); tableHeading();
  for (const product of value.products) row([product.name, product.description, String(product.quantity), formatMoney(product.unitPrice, '₱', 2), formatMoney(product.total, '₱', 2)]);
  if (!value.products.length) row(['Product name', 'Product description', '1', '₱0.00', '₱0.00']);
  doc.moveDown(); room(50);
  text(`Subtotal: ${formatMoney(value.total, '₱', 2)}\nTotal: ${formatMoney(value.total, '₱', 2)}`, true, 11);
  if (value.notes) { room(45); text('Notes', true); text(value.notes); }
  if (value.footer) { room(45); text(value.footer); }
  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    doc.switchToPage(index);
    const margin = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font('Regular').fontSize(8).fillColor('#64748B').text(`${index + 1} / ${pages.count}`, left, doc.page.height - 35, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  return output;
}
