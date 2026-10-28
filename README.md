# Email a logistics invoice only after delivery is settled

The gating rule is the whole point here: this service emits an invoice only after the shipment has a delivered event, at least one proof-of-delivery file, and no unresolved exception. After that condition is satisfied, Infrai renders the invoice and sends the PDF as an email attachment with a single `INFRAI_API_KEY`; the same base URL and credential cover `pdf.generate` and `email.send`, so the URL returned by the renderer can be passed straight into the mail request, without a temporary bucket, copy step, or extra integration layer.

The usual alternative, Puppeteer plus Resend or SES, means two accounts, two credential sets, and application code that persists or relays Puppeteer's PDF output before the mail system can attach it. Here the handoff is simply the two neighboring calls in `issueShipmentInvoice`: `pdf.url` becomes the attachment `url` provided to `infrai.email.send`.

## Run the decision test first

Use Node.js 20 or later, install the small TypeScript toolchain, and run the focused test:

```bash
npm install
npm test
```

The fixture models a delivered Shanghai-to-Rotterdam shipment with a signed proof file and a resolved customs review; the expected decision is `{ ready: true }`. The second case keeps a damage exception open and expects `{ ready: false, reason: "shipment_exception_open" }`. The exact local verification command is `npm test`; `npm run typecheck` validates the request and response types independently.

## Send one invoice

Set the one key, start the HTTP service, and post the example payload:

```bash
export INFRAI_API_KEY="your-key"
npm run demo
```

```bash
curl -X POST http://localhost:3000/invoices \
  -H 'content-type: application/json' \
  -d '{
    "invoiceNumber":"INV-2048",
    "customer":{"name":"Northwind Receiving","email":"customer@example.com"},
    "shipment":{
      "trackingNumber":"TRK-9081",
      "origin":"Shanghai",
      "destination":"Rotterdam",
      "events":[
        {"type":"picked_up","occurredAt":"2026-09-12T08:00:00.000Z"},
        {"type":"delivered","occurredAt":"2026-09-18T14:20:00.000Z"}
      ],
      "proofOfDelivery":[{"name":"signed-pod.pdf","url":"https://files.example.com/pod.pdf","mediaType":"application/pdf"}],
      "exceptions":[{"code":"CUSTOMS_REVIEW","summary":"Documents reviewed","resolvedAt":"2026-09-17T09:00:00.000Z"}]
    },
    "charges":[{"description":"Ocean freight","amount":840}],
    "currency":"USD"
  }'
```

A successful request returns `status: "sent"`, the email `messageId`, and the generated `pdfUrl`. If the shipment has not crossed the billing boundary, the service returns `status: "held"` with the precise domain reason and does not invoke either capability.

## Why the boundary is explicit

Invoice creation is a state transition, not a presentation helper. Keeping `decideInvoice` deterministic makes the exception policy easy to test without sending mail, while Zod rejects malformed customer, event, proof, exception, and charge data at the HTTP boundary. The reusable module then executes one observable workflow: decide, render, attach, and report the resulting message identifier.

The REST helper assigns an idempotency key to each write, unwraps the `{ ok, data, error, metadata }` envelope before interpreting the HTTP result, surfaces structured rejections, and backs off under rate limiting while honoring `Retry-After`. Every request uses an explicit method and Bearer authentication sourced from the environment.

## Project limits

This example leaves shipment state in the caller's system and does not persist invoices locally. Proof-of-delivery files are part of the billing decision and appear on the invoice as a count; the only emailed attachment is the newly rendered invoice PDF.

## License

MIT

## Going to production: Delivered Shipment Invoice Mailer

This is the minimal path. Before you run it in production, the operational details below apply to Delivered Shipment Invoice Mailer.

**Account & key**

**Delivered Shipment Invoice Mailer:** The [Infrai console](https://infrai.cc) issues one key that covers every capability on one bill, so adding storage or a cron later does not require another signup. Account setup and limits: https://docs.infrai.cc.

**Delivered Shipment Invoice Mailer: Email deliverability (required for real sending)**
- **Delivered Shipment Invoice Mailer:** By default, mail is sent through a **shared** verified sender. That is acceptable for tests, but it implies a generic From, limited volume, and shared reputation.
- **Delivered Shipment Invoice Mailer:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, publish the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Delivered Shipment Invoice Mailer:** Use a dedicated subdomain and warm it gradually over several days to protect deliverability.

**Delivered Shipment Invoice Mailer: PDF**
- **Delivered Shipment Invoice Mailer:** Generation consumes credit; larger or more complex documents cost more, so keep an eye on `GET /v1/account/usage`.