// robots.txt and sitemap.xml for search engines (Google, Bing).
// They use your real address automatically: SITE_URL if set in Vercel, otherwise the domain the visitor used.
//   /robots.txt  → api/seo?f=robots   (see vercel.json rewrites)
//   /sitemap.xml → api/seo?f=sitemap
export default function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const base = (process.env.SITE_URL || `https://${host}`).replace(/\/$/, '');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.query.f === 'sitemap') {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    const today = new Date().toISOString().slice(0, 10);
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
</urlset>`);
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  // The old *.vercel.app address shouldn't compete with your own domain in Google.
  const isVercelApp = /\.vercel\.app$/i.test(host) && process.env.SITE_URL && !process.env.SITE_URL.includes(host);
  return res.status(200).send(isVercelApp ? 'User-agent: *\nDisallow: /\n' : `User-agent: *
Allow: /
Disallow: /staff
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`);
}