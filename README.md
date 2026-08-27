# Save Your PUB Files

Save Your PUB Files is a Windows desktop utility for batch converting Microsoft Publisher `.pub` files to PDF.

The product is designed for people who need to preserve Publisher document archives before Microsoft Publisher becomes harder to rely on. It processes files locally on the user's Windows PC and requires a working, licensed installation of Microsoft Publisher.

## Website

The static website describes the product, requirements, pricing, support, and legal policies for Paddle review and customer discovery.

Key website pieces:

- English homepage and SEO pages
- Localized landing pages
- Terms of Use, Privacy Policy, Refund Policy, and Support pages
- Shared CSS, JavaScript, icons, screenshots, and demo media

## Delivery Worker

The Cloudflare Worker in `delivery-worker/saveyourpubfiles-delivery` handles purchase-related delivery flow:

- Paddle webhook verification
- Completed transaction handling
- Download-token creation
- R2 installer download delivery
- KV purchase/download records

Runtime secrets are expected to be configured outside the repository through Cloudflare. Do not commit Paddle API keys, webhook secrets, Cloudflare tokens, `.env`, or `.dev.vars` files.

## Paddle Status

The frontend currently uses Paddle sandbox checkout values. Production payment values should be added only through a deliberate production switch after domain approval and a final preflight.

## Development Notes

This repository is intended to contain source files needed to maintain the website and Worker, not deploy ZIPs, local browser profiles, generated install payloads, or secrets.

The paid installer/download payload should be stored in the configured delivery bucket, not committed to the public source repository.
