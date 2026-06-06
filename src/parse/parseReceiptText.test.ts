import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractBusinessUstId,
  extractCardPaymentFields,
  parseReceiptText,
} from "./parseReceiptText.js";

describe("parseReceiptText (ported)", () => {
  it("reads grand total from labeled Total line", () => {
    const raw = ["CORNER STORE", "Milk 3.40", "Bread 2.10", "Subtotal 5.50", "Tax 0.44", "Total 5.94"].join("\n");
    const p = parseReceiptText(raw);
    assert.equal(p.amount, 5.94);
    assert.equal(p.tax, 0.44);
    assert.equal(p.subtotal, 5.5);
  });

  it("parses ISO purchase date", () => {
    const p = parseReceiptText("Sale 2024-03-15\nTotal EUR 12.00");
    assert.equal(p.spentAt, "2024-03-15");
    assert.equal(p.amount, 12);
  });

  it("extracts German USt-IdNr", () => {
    const raw = "USt-IdNr.: DE123456789\nTotal 5.00";
    assert.equal(extractBusinessUstId(raw), "DE123456789");
    assert.equal(parseReceiptText(raw).ustId, "DE123456789");
  });

  it("extracts card payment metadata", () => {
    const raw = "Kasse Nr.: 3\nTerminal-ID 87492031\nPrüfziffer 482913\nTotal 12.00";
    assert.deepEqual(extractCardPaymentFields(raw), {
      checkoutNumber: "3",
      terminalNumber: "87492031",
      paymentChecksum: "482913",
    });
  });
});
