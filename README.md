# nimbus-api
if you liked stratus, you'll like this even more!

# what is this?
this is ANOTHER cloud gaming bypass that uses blacknut instead of raccoongame. it's built to be faster, better, and more optimized. it's also easier to set up!

# project notes/structure
```
.
├── api/
│   ├── mail/
│   │   ├── useMalq.ts
│   │   └── useOther.ts
│   ├── accounts.ts
│   ├── index.ts
│   └── stream.ts
│   └── status.ts
├── docs/
│   └── INDEX.md
├── public/
│   ├── embed.html
│   └── logo.svg
├── .env.example
├── .gitignore
├── bun.lock
├── package.json
├── README.md
└── tsconfig.json
```

# how to run nimbus
1. go to your vps and clone this repo anywhere you want
2. install dependencies with your package manager (ex. bun, npm, yarn, etc)
3. set your env (just port basically)
4. spin up your instance (i recommend using pm2)
```bash
pm2 start "bun run start" --name nimbus
pm2 save
```
5. link it to your app with caddy (or nginx if you want). in your caddyfile:
```Caddyfile
:443 { # for byod, but do this wherever your site blocks are
    handle /api/nimbus* {
        reverse_proxy 127.0.0.1:3000
    }

    # other config
}
```

# recommendations and tips
- use caddy
- use bun
- use malq as your email api (code ships for it, so why not!)