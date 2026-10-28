import { createServer } from "node:http";
import { InfraiError } from "./infrai.js";
import { invoiceRequestSchema, issueShipmentInvoice } from "./shipment_invoice.js";

const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/invoices") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = invoiceRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_request", issues: parsed.error.issues }));
      return;
    }

    const result = await issueShipmentInvoice(parsed.data);
    response.writeHead(result.status === "sent" ? 201 : 409, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof SyntaxError) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.code, message: error.message }));
      return;
    }
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "invoice_delivery_failed" }));
  }
});

server.listen(port, () => console.log(`Logistics invoice service listening on http://localhost:${port}`));
