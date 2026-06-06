import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_ID } from "./index.js";

describe("li-books-gateway scaffold", () => {
  it("exports product id", () => {
    assert.equal(PRODUCT_ID, "li-books");
  });
});
