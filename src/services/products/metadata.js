const { plainText, publicOrigin } = require("../newsMetadata");
function productMetadata(product) {
  const site = process.env.PUBLIC_SITE_NAME || "San Water";
  const origin = publicOrigin();
  let canonicalUrl = null;
  // Existing canonical URLs are immutable during ordinary catalog editing.
  try {
    const url = new URL(product.seo?.canonicalUrl);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      canonicalUrl = url.href;
  } catch {
    /* Generate only when an origin is configured. */
  }
  if (!canonicalUrl && origin && (product.slug || product.serialNumber))
    canonicalUrl = `${origin}/products/view/${encodeURIComponent(product.slug || product.serialNumber)}`;
  return {
    title: `${plainText(product.name || product.productId)} | ${site}`,
    description: plainText(
      product.shortDescription || product.description || "",
    ).slice(0, 160),
    canonicalUrl,
    image: product.gallery?.[0] || null,
    robots:
      product.isActive &&
      product.status !== "archived" &&
      (!product.commerce || product.commerce.published)
        ? "index,follow"
        : "noindex,nofollow",
  };
}
module.exports = productMetadata;
