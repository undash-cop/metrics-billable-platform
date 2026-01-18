# Documentation Site Deployment

## Deploy to Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
cd docs-site
vercel
```

## Deploy to Netlify

1. Install Netlify CLI:
```bash
npm i -g netlify-cli
```

2. Build and deploy:
```bash
cd docs-site
npm run build
netlify deploy --prod --dir=.vitepress/dist
```

## Deploy to Cloudflare Pages

1. Connect your repository to Cloudflare Pages
2. Set build command: `cd docs-site && npm run build`
3. Set output directory: `docs-site/.vitepress/dist`
4. Deploy!

## Deploy to GitHub Pages

1. Build the site:
```bash
cd docs-site
npm run build
```

2. Push `.vitepress/dist` to `gh-pages` branch

3. Configure GitHub Pages to serve from `gh-pages` branch

## Local Development

```bash
cd docs-site
npm install
npm run dev
```

Site will be available at `http://localhost:5173`
