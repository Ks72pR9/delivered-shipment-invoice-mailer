import assert from "node:assert/strict";
import test from "node:test";
import { decideInvoice, invoiceRequestSchema } from "../src/shipment_invoice.js";

const shipment = {
  invoiceNumber: "INV-2048",
  customer: { name: "Northwind Receiving", email: "ap@example.com" },
  shipment: {
    trackingNumber: "TRK-9081",
    origin: "Shanghai",
    destination: "Rotterdam",
    events: [
      { type: "picked_up", occurredAt: "2026-09-12T08:00:00.000Z" },
      { type: "delivered", occurredAt: "2026-09-18T14:20:00.000Z" },
    ],
    proofOfDelivery: [{ name: "signed-pod.pdf", url: "https://files.example.com/pod.pdf", mediaType: "application/pdf" }],
    exceptions: [{ code: "CUSTOMS_REVIEW", summary: "Documents reviewed", resolvedAt: "2026-09-17T09:00:00.000Z" }],
  },
  charges: [{ description: "Ocean freight", amount: 840 }],
  currency: "USD",
};

test("a delivered shipment with evidence and resolved exceptions is invoiceable", () => {
  const input = invoiceRequestSchema.parse(shipment);
  assert.deepEqual(decideInvoice(input), { ready: true });
});

test("an open shipment exception holds the invoice", () => {
  const input = invoiceRequestSchema.parse({
    ...shipment,
    shipment: { ...shipment.shipment, exceptions: [{ code: "DAMAGE", summary: "Inspection pending" }] },
  });
  assert.deepEqual(decideInvoice(input), { ready: false, reason: "shipment_exception_open" });
});
