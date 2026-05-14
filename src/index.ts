import { Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import TurndownService from 'turndown';
import { parseHTML } from 'linkedom';
import { readTurnstileTokenFromUrl, verifyTurnstileToken } from '../../_shared/turnstile';
import { renderTextToolPage, turnstileSiteKeyFromEnv } from '../../_shared/tool-page';

type AppEnv = {
  Bindings: {
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
  };
};

const app = new Hono<AppEnv>();

app.use('/api/*', cors());

app.get('/', (c) => {
  return c.html(renderTextToolPage({ title: 'URL to Markdown', description: 'Fetch any public page and turn its main content into clean markdown.', endpoint: '/api/markdown', sample: '{ "url": "https://example.com", "markdown": "# Example Domain" }', siteKey: turnstileSiteKeyFromEnv(c.env), buttonLabel: 'Convert', toolSlug: 'url-to-markdown', formatOptions: [{ value: 'json', label: 'JSON' }, { value: 'markdown', label: 'Markdown' }] }));
});

app.get('/health', (c) => c.json({ ok: true }));

app.get('/api/markdown', async (c) => {
  const url = c.req.query('url') ?? '';
  const format = (c.req.query('format') ?? 'json').toLowerCase();
  return handleConvert(c, { url, format, turnstileToken: readTurnstileTokenFromUrl(c.req.url) ?? undefined });
});

app.post('/api/markdown', async (c) => {
  const body: { url?: string; format?: string; [key: string]: unknown } = await c.req
    .json<{ url?: string; format?: string; [key: string]: unknown }>()
    .catch(() => ({}));
  return handleConvert(c, {
    url: body.url ?? '',
    format: (body.format ?? 'json').toLowerCase(),
    turnstileToken: typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : undefined,
  });
});

type ConvertRequest = {
  url: string;
  format: string;
  turnstileToken?: string;
};

async function handleConvert(c: Context<AppEnv>, input: ConvertRequest) {
  const captcha = await verifyTurnstileToken(c.env, input.turnstileToken, c.req.header('CF-Connecting-IP'));
  if (!captcha.ok) {
    return c.json({ error: captcha.error }, 403);
  }

  const normalizedUrl = normalizeUrl(input.url);
  if (!normalizedUrl) {
    return c.json({ error: 'A valid http(s) URL is required.' }, 400);
  }

  const response = await fetch(normalizedUrl, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Lindo URL to Markdown/0.1 (+https://lindo.ai)',
      'accept': 'text/html,application/xhtml+xml',
    },
  }).catch(() => null);

  if (!response) {
    return c.json({ error: 'Failed to fetch the target URL.' }, 502);
  }

  if (!response.ok) {
    return c.json({ error: `Target responded with ${response.status}.` }, 502);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    return c.json({ error: 'Only HTML pages are supported.' }, 415);
  }

  const html = await response.text();
  const extracted = htmlToMarkdown(html, response.url);

  if (input.format === 'markdown') {
    return new Response(extracted.markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
      },
    });
  }

  return c.json({
    url: normalizedUrl,
    finalUrl: response.url,
    title: extracted.title,
    description: extracted.description,
    markdown: extracted.markdown,
  });
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const candidate = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function htmlToMarkdown(html: string, pageUrl: string) {
  const { document } = parseHTML(html);
  const title = document.title?.trim() ?? '';
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';

  document.querySelectorAll('script, style, noscript, iframe, svg, canvas, form, button, dialog').forEach((el: any) => el.remove());
  document.querySelectorAll('[hidden], [aria-hidden="true"]').forEach((el: any) => el.remove());

  absolutizeAttributes(document, pageUrl);

  const root = document.querySelector('article, main, [role="main"]') ?? document.body ?? document.documentElement;
  root.querySelectorAll('nav, footer, header, aside').forEach((el: any) => el.remove());

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'canvas']);

  turndown.addRule('links', {
    filter: 'a',
    replacement: (content, node) => {
      const href = (node as Element).getAttribute('href');
      if (!href) return content;
      const text = content.trim() || href;
      return `[${text}](${href})`;
    },
  });

  turndown.addRule('images', {
    filter: 'img',
    replacement: (_, node) => {
      const src = (node as Element).getAttribute('src');
      if (!src) return '';
      const alt = ((node as Element).getAttribute('alt') || '').replace(/\]/g, '\\]');
      return `![${alt}](${src})`;
    },
  });

  let markdown = turndown.turndown(root as any);
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

  if (title && !markdown.startsWith('# ')) {
    markdown = `# ${title}\n\n${markdown}`.trim();
  }

  return {
    title,
    description,
    markdown,
  };
}

function absolutizeAttributes(document: any, pageUrl: string) {
  const baseUrl = new URL(pageUrl);

  document.querySelectorAll('a[href]').forEach((el: any) => {
    const href = el.getAttribute('href');
    if (!href) return;
    const absolute = toAbsoluteUrl(href, baseUrl);
    if (absolute) el.setAttribute('href', absolute);
  });

  document.querySelectorAll('img[src]').forEach((el: any) => {
    const src = el.getAttribute('src');
    if (!src) return;
    const absolute = toAbsoluteUrl(src, baseUrl);
    if (absolute) el.setAttribute('src', absolute);
  });
}

function toAbsoluteUrl(value: string, baseUrl: URL): string | null {
  try {
    if (value.startsWith('javascript:') || value.startsWith('data:')) return null;
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

export default app;
