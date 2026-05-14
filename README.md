# URL to Markdown

Convert any public HTML page into clean markdown with a small Cloudflare Worker.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lindoai/url-to-markdown)

## Features

- fetches a public page
- extracts readable content
- returns JSON or raw markdown
- useful for AI workflows, briefs, and documentation pipelines

## Local development

```bash
npm install
npm run dev
npm run typecheck
```

## Deploy

```bash
npm run deploy
```

## Production env

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

## API

### GET `/api/markdown?url=https://example.com`

Returns JSON:

```json
{
  "url": "https://example.com",
  "finalUrl": "https://example.com/",
  "title": "Example Domain",
  "description": "...",
  "markdown": "# Example Domain\n..."
}
```

### GET `/api/markdown?url=https://example.com&format=markdown`

Returns raw markdown as `text/markdown`.

### POST `/api/markdown`

```json
{
  "url": "https://example.com",
  "format": "json",
  "cf-turnstile-response": "<token>"
}
```
