'use strict';
// Server-side PDF receipt (FR-2.3, spec 5.12). Standard Helvetica keeps the text extractable.
const PDFDocument = require('pdfkit');
const { formatPkr } = require('../domain/store/money');

// payload: receipt.payload of spec 5.12. Resolves to a Buffer that starts with %PDF.
function generateReceiptPdf(payload, { compress = true } = {}) {
  return new Promise((resolve, reject) => {
    const total = formatPkr(payload.total_minor);
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      compress,
      info: {
        Title: `Receipt ${payload.order_id}`,
        Author: 'NaSCon Sports Platform',
        Subject: `Order ${payload.order_id} total ${total}`,
        Keywords: `${payload.order_id} ${total}`,
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).text('Payment Receipt');
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(11);
    doc.text(`Order ID: ${payload.order_id}`);
    doc.text(`Customer ID: ${payload.customer_id}`);
    doc.text(`Paid at: ${payload.paid_at}`);
    doc.text(`Currency: ${payload.currency}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').text('Items');
    doc.font('Helvetica');
    for (const it of payload.items) {
      doc.text(`${it.variant_id}  x${it.quantity}  @ ${formatPkr(it.unit_price_minor)}  = ${formatPkr(it.quantity * it.unit_price_minor)}`);
    }
    doc.moveDown();
    doc.text(`Subtotal: ${formatPkr(payload.subtotal_minor)}`);
    doc.text(`Discount: ${formatPkr(payload.discount_minor)}`);
    doc.font('Helvetica-Bold').text(`Total: ${total}`);
    doc.end();
  });
}

const objectStore = require('../lib/objectStore');

// Fire-and-forget copy of the receipt to MinIO. Never throws, never blocks the request.
function uploadReceipt(orderId, buffer) {
  if (!objectStore.enabled()) return;
  try {
    const bucket = objectStore.defaultBucket();
    objectStore.ensureBucket(bucket)
      .then(() => objectStore.getClient().putObject(bucket, `${orderId}.pdf`, buffer, buffer.length, { 'Content-Type': 'application/pdf' }))
      .catch(() => {});
  } catch {
    // Storage is optional: the receipt is already returned inline as base64.
  }
}

module.exports = { generateReceiptPdf, uploadReceipt };
