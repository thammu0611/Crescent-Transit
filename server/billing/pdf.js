// A one-page PDF writer with no dependencies, enough for a payment receipt.
// Text only, Helvetica, WinAnsi characters (so amounts print as "Rs").

const esc = (s) => String(s).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');

/**
 * @param lines [{ text, x, y, size?, bold? }] in points, origin bottom-left, A4 (595 x 842)
 * @param rules [{ x1, y1, x2, y2 }] horizontal/vertical lines
 * @returns Buffer
 */
export function renderPdf(lines, rules = []) {
  const ops = [];
  for (const r of rules) ops.push(`0.8 w ${r.x1} ${r.y1} m ${r.x2} ${r.y2} l S`);
  for (const l of lines) {
    ops.push(`BT /${l.bold ? 'F2' : 'F1'} ${l.size ?? 11} Tf ${l.x} ${l.y} Td (${esc(l.text)}) Tj ET`);
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** The payment receipt: what was bought, for whom, when, and how it was verified. */
export function receiptPdf(r) {
  const rows = [
    ['Receipt number', r.receiptNo],
    ['Student', `${r.studentName} (${r.username})`],
    ['Register no. / Department', `${r.registerNo ?? '-'} / ${r.department ?? '-'}`],
    ['Plan', `${r.planName} (${r.planCode})`],
    ['Access valid', `${r.validFrom} to ${r.validTo}`],
    ['Amount paid', r.amount],
    ['Payment method', r.method ?? '-'],
    ['Paid at', r.paidAt],
    ['Gateway payment ID', r.gatewayPaymentId],
    ['Gateway order ID', r.gatewayOrderId],
    ['Status', r.status],
  ];
  const lines = [
    { text: r.merchant, x: 50, y: 790, size: 16, bold: true },
    { text: 'University Bus Tracking System - app access subscription', x: 50, y: 770, size: 10 },
    { text: 'PAYMENT RECEIPT', x: 50, y: 730, size: 20, bold: true },
  ];
  rows.forEach(([k, v], i) => {
    const y = 690 - i * 24;
    lines.push({ text: k, x: 50, y, size: 11, bold: true });
    lines.push({ text: v, x: 230, y, size: 11 });
  });
  const noteY = 690 - rows.length * 24 - 20;
  lines.push({ text: 'This Rs 60 subscription is for app access only (live tracking, arrival estimates, alerts and', x: 50, y: noteY, size: 9 });
  lines.push({ text: 'the attendance record). It is not the bus fare; the transport fee is collected separately.', x: 50, y: noteY - 13, size: 9 });
  lines.push({ text: 'Payment confirmed by the gateway\'s signed notification. Refunds: full refund within 7 days.', x: 50, y: noteY - 26, size: 9 });
  if (r.status === 'REFUNDED') lines.push({ text: `REFUNDED on ${r.refundedAt}`, x: 50, y: noteY - 52, size: 14, bold: true });
  return renderPdf(lines, [{ x1: 50, y1: 715, x2: 545, y2: 715 }, { x1: 50, y1: noteY + 14, x2: 545, y2: noteY + 14 }]);
}
