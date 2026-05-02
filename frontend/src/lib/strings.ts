export const STRINGS = {
  appTitle: "Price Compare",
  appSubtitle: "AI-powered product comparison across top Indian stores",

  chatPlaceholder: "Ask me to find a product...",
  chatSendLabel: "Send",
  chatEmptyHeading: "What are you looking for?",
  chatEmptySubtext: "Try one of these to get started:",
  chatExamplePrompts: [
    "Find me a gaming laptop under ₹80,000",
    "Compare OnePlus 12 5G prices",
    "Best iPhone 15 deals on Flipkart and Amazon",
  ],

  typingIndicatorLabel: "Searching...",
  assistantName: "PriceBot",

  tableEmptyHeading: "No products found",
  tableEmptySubtext: "Try a different search term or broaden your query.",
  tableLoadingLabel: "Loading results...",
  tableErrorHeading: "Something went wrong",
  tableErrorSubtext: "We couldn't fetch products. Please try again.",

  columnName: "Product",
  columnSource: "Store",
  columnCurrentPrice: "Price",
  columnOriginalPrice: "MRP",
  columnDiscount: "Discount",
  columnRating: "Rating",
  columnReviews: "Reviews",
  columnRank: "Rank",
  columnLink: "",

  topMatchBadge: "Top match",
  viewButtonLabel: "View",
  noRankLabel: "—",
} as const;
