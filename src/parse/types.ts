/** One merchandise row inferred from OCR / LLM (draft before save). */
export type ReceiptLineDraft = {
  rawProductName: string;
  rawLine: string;
  lineTotal: number | null;
  /** Price per single unit when printed (Stückpreis / unit price) */
  unitPrice: number | null;
  quantity: number | null;
  /** LLM or heuristic grocery bucket name */
  suggestedCategory: string | null;
};

export type ParsedReceiptHeader = {
  amount: number | null;
  /** Merchandise subtotal before tax, when labeled in OCR */
  subtotal: number | null;
  tax: number | null;
  /** VAT / sales tax rate when printed as a percent (e.g. 7 for 7%) */
  taxRatePercent: number | null;
  currency: string;
  spentAt: string | null;
  /** Store / trading name */
  merchant: string | null;
  /** Street or venue line when separated from merchant */
  merchantAddress: string | null;
  /** How paid when stated (e.g. Kreditkarte, Bar) */
  paymentMethod: string | null;
  /** Transaction / auth / terminal reference when present */
  paymentReference: string | null;
  /** Checkout / register / Kasse number (card slips) */
  checkoutNumber: string | null;
  /** POS terminal / device ID when printed */
  terminalNumber: string | null;
  /** Verification token: Prüfziffer, STAN/trace, auth code, etc. */
  paymentChecksum: string | null;
  /** EU VAT / USt-Id of the merchant (e.g. DE123456789) */
  ustId: string | null;
};

/** Full heuristic parse from OCR text (Tesseract plain text or DeepSeek markdown). */
export type ParsedReceiptStructured = ParsedReceiptHeader & {
  lines: ReceiptLineDraft[];
};
