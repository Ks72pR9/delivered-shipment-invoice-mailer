import { z } from "zod";
import { infrai } from "./infrai.js";

const money = z.number().finite().nonnegative();

export const invoiceRequestSchema = z.object({
  invoiceNumber: z.string().min(1),
  customer: z.object({ name: z.string().min(1), email: z.string().email() }),
  shipment: z.object({
    trackingNumber: z.string().min(1),
    origin: z.string().min(1),
    destination: z.string().min(1),
    events: z.array(z.object({
      type: z.enum(["picked_up", "in_transit", "delivered", "exception"]),
      occurredAt: z.string().datetime(),
      note: z.string().optional(),
    })).min(1),
    proofOfDelivery: z.array(z.object({
      name: z.string().min(1),
      url: z.string().url(),
      mediaType: z.string().min(1),
    })),
    exceptions: z.array(z.object({
      code: z.string().min(1),
      summary: z.string().min(1),
      resolvedAt: z.string().datetime().optional(),
    })),
  }),
  charges: z.array(z.object({ description: z.string().min(1), amount: money })).min(1),
  currency: z.string().length(3),
});

export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

export type InvoiceDecision =
  | { ready: true }
  | { ready: false; reason: "shipment_not_delivered" | "proof_of_delivery_missing" | "shipment_exception_open" };

export function decideInvoice(input: InvoiceRequest): InvoiceDecision {
  if (!input.shipment.events.some((event) => event.type === "delivered")) {
    return { ready: false, reason: "shipment_not_delivered" };
  }
  if (input.shipment.proofOfDelivery.length === 0) {
    return { ready: false, reason: "proof_of_delivery_missing" };
  }
  if (input.shipment.exceptions.some((exception) => exception.resolvedAt === undefined)) {
    return { ready: false, reason: "shipment_exception_open" };
  }
  return { ready: true };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character] ?? character));

function invoiceHtml(input: InvoiceRequest): string {
  const total = input.charges.reduce((sum, charge) => sum + charge.amount, 0);
  const rows = input.charges.map((charge) =>
    `<tr><td>${escapeHtml(charge.description)}</td><td>${input.currency} ${charge.amount.toFixed(2)}</td></tr>`,
  ).join("");
  const delivered = input.shipment.events.find((event) => event.type === "delivered")!;
  return `<!doctype html><html><body><h1>Logistics invoice ${escapeHtml(input.invoiceNumber)}</h1><p>Bill to: ${escapeHtml(input.customer.name)}</p><p>Shipment ${escapeHtml(input.shipment.trackingNumber)}: ${escapeHtml(input.shipment.origin)} to ${escapeHtml(input.shipment.destination)}</p><p>Delivered: ${escapeHtml(delivered.occurredAt)}</p><p>Proof of delivery files: ${input.shipment.proofOfDelivery.length}</p><table>${rows}<tr><th>Total</th><th>${input.currency} ${total.toFixed(2)}</th></tr></table></body></html>`;
}

export async function issueShipmentInvoice(input: InvoiceRequest) {
  const decision = decideInvoice(input);
  if (decision.ready === false) return { status: "held" as const, reason: decision.reason };

  const pdf = await infrai.pdf.generate({
    html: invoiceHtml(input),
    page_size: "A4",
    orientation: "portrait",
    store: true,
  }, `invoice:${input.invoiceNumber}:pdf`);

  const email = await infrai.email.send({
    to: input.customer.email,
    subject: `Invoice ${input.invoiceNumber} for shipment ${input.shipment.trackingNumber}`,
    html: `<p>Hello ${escapeHtml(input.customer.name)},</p><p>Your delivered-shipment invoice is attached.</p>`,
    attachments: [{ filename: `invoice-${input.invoiceNumber}.pdf`, url: pdf.url }],
  }, `invoice:${input.invoiceNumber}:email`);

  return { status: "sent" as const, messageId: email.message_id, pdfUrl: pdf.url };
}
