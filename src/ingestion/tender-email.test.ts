import assert from "node:assert/strict";
import { emailLinks, normalizeTenderEmail, plainEmailText, tenderInboxAddress, tenderInboxTokenHash, tenderInboxTokens } from "./tender-email";

const hash = tenderInboxTokenHash("abcdefghijklmnopqrstuvwx");
assert.equal(hash.length, 64);
assert.equal(tenderInboxAddress("abcdefghijklmnopqrstuvwx", "inbound.estimator.ai"), "tender-abcdefghijklmnopqrstuvwx@inbound.estimator.ai");
assert.deepEqual(tenderInboxTokens(["EstimatorAI <tender-abcdefghijklmnopqrstuvwx@inbound.estimator.ai>"]), ["abcdefghijklmnopqrstuvwx"]);
assert.equal(plainEmailText(null, "<p>Roof replacement &amp; painting</p>"), "Roof replacement & painting");
assert.deepEqual(emailLinks("See https://buyer.example/tender.", null), ["https://buyer.example/tender"]);

const tender = normalizeTenderEmail({
  sourceKey: "merx",
  emailId: "email-1",
  messageId: "message-1",
  sender: "City of Toronto <procurement@example.ca>",
  subject: "Fwd: RFP 24-123 Office renovation",
  createdAt: "2026-08-08T12:00:00.000Z",
  text: "Closing: August 20, 2026 at 2:00 PM. Paint 5,000 sq ft. https://buyer.example/24-123",
  html: null,
  attachmentCount: 2
});
assert.equal(tender.source, "merx");
assert.equal(tender.solicitationNumber, "24-123");
assert.equal(tender.procurementCategory, "construction");
assert.equal(tender.buyerName, "City of Toronto");
assert.equal(tender.sourceUrl, "https://buyer.example/24-123");
assert.ok(tender.closingAt);

export default Promise.resolve();
