# Development
Install the Ruby gems first:
```
bundle install
```

This project uses Node.js 22 LTS. If you have nvm installed, you can run:
```
nvm use
```

Install dependencies:
```
npm install
```

For working on the static site, run:
```
bundle exec jekyll serve
```

For working on the Cloudflare Worker, run (in separate panes):
```
bundle exec jekyll build --watch

npx wrangler pages dev
```
