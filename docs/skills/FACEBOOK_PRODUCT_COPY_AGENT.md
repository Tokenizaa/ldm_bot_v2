# Canonical Skill — Facebook Product Copy Agent

## Purpose

Generate high-quality Portuguese (Brazil) Facebook group copy for real catalog products.

The agent is responsible for **understanding the product data and writing the copy**. It is not responsible for browser automation or publication.

## Source of truth

Only these product fields may be used:

- `product_name`
- `brand`
- `category`
- `sku`

Never invent specifications, benefits, discounts, ratings, stock, shipping, warranty or technical claims.

## Hard rules

1. **Never include price.**
2. **Never include an URL.**
3. Never include currency symbols such as `R$`.
4. Never fabricate a promotion or discount.
5. Use the real product name as the primary semantic/SEO term.
6. Use category and brand naturally when available.
7. Write for discovery and conversion, not keyword stuffing.
8. The copy must be useful and interesting even without the link.
9. Include `@todos` on its own line.
10. Use up to four relevant hashtags.
11. Return only publication-ready copy.

## Recommended structure

1. Strong product-specific hook.
2. Product name with natural search terms.
3. One or two factual context lines derived from supplied fields.
4. Short CTA such as “Confira a oferta e veja os detalhes.”
5. `@todos`.
6. Relevant hashtags.

## Persistence lifecycle

Copy generation happens during product ingestion, not at publication time.

### Future scrapes

1. Crawler discovers and normalizes the real product.
2. Product is inserted/updated in `affiliate_links`.
3. If the product has no copy, or its semantic fields changed (`product_name`, `brand`, `category`, `sku`), the canonical agent generates a new copy.
4. The copy is saved in `affiliate_links.facebook_copy`.
5. The scrape is considered prepared only when the product has a non-empty `facebook_copy`.

### Existing products

Use `npm run backfill:copy` to generate copy for every product whose `facebook_copy` is empty. The script is resumable by design: already populated products are skipped.

## Open Graph publication protocol

The affiliate URL is handled by the publisher, not by the LLM.

Publication sequence:

1. Generate canonical copy.
2. Open Facebook group composer.
3. Insert copy.
4. Append affiliate URL as a separate final line.
5. Wait until Facebook renders the Open Graph/link preview.
6. Remove only the raw URL line.
7. Keep the generated preview.
8. Publish.

The URL remains the source of truth for dynamic offer metadata such as current price. The raw URL must not remain in the final copy.

## Quality gate

Reject generated copy when it contains:

- `http://` or `https://`
- `R$`
- explicit price expressions
- invented claims

A valid result is a compelling, factual, evergreen product post.

## Implementation

The canonical implementation is:

- `server/services/FacebookCopyAgent.ts`
- `server/services/ContentService.ts`
- `server/services/FacebookService.ts`
- `server/services/FacebookPublisherService.ts`
- `scripts/backfill-facebook-copy.ts`
- `docs/migrations/20260911_add_facebook_copy.sql`

The AI model generates the copy; Playwright owns the Open Graph preview lifecycle.
