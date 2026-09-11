# Save Your PUB Files

Save Your PUB Files is a Windows utility for batch converting Microsoft Publisher `.pub` files to PDF.

It is built for people who have multiple Publisher files, full folders, or large archives with dozens or hundreds of `.pub` files. Instead of opening each Publisher file and saving it as a PDF one by one, Save Your PUB Files helps convert many files in one local Windows workflow.

## Key Features

- Batch convert Microsoft Publisher `.pub` files to PDF.
- Process multiple files or entire folders.
- Useful for dozens or hundreds of Publisher documents.
- Runs locally on the user's Windows PC.
- No Publisher files are uploaded to a server.
- Simple Windows desktop GUI.
- One-time purchase with no subscription.

## Requirements

- Windows PC.
- Microsoft Publisher must be installed.
- Conversion relies on the installed Microsoft Publisher application.

## Publisher End of Support

Microsoft Publisher support ends on October 1, 2026.

Save Your PUB Files helps people preserve existing Publisher archives as PDF before or around Publisher's retirement. It does not claim that `.pub` files will stop opening on that date; it is a practical tool for reducing risk while Publisher is still available.

## Website

Main website:

https://saveyourpubfiles.com/

Products page:

https://saveyourpubfiles.com/products/

## Privacy / Local Processing

Publisher-to-PDF conversion happens locally on the user's Windows PC.

The user's `.pub` files are not uploaded to Save Your PUB Files servers for conversion.

## Purchase

Save Your PUB Files is sold as a one-time purchase:

- Price: `$10.99`
- Subscription: none

## Repository Notes for Maintainers

This repository contains source files for the public website and the delivery Worker.

- Website source lives in the static site files.
- The delivery Worker lives in `delivery-worker/saveyourpubfiles-delivery`.
- Do not commit secrets, API keys, Paddle credentials, webhook secrets, Cloudflare tokens, download tokens, customer data, `.env`, or `.dev.vars` files.
- The paid installer and download payload should not be stored in this public repository.
