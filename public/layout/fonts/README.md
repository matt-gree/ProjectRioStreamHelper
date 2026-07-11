# Scene layout fonts

Drop self-hosted font files here. They are served at `/layout/fonts/<filename>`.

## Bebas Neue Bold

Place the file as:

```
public/layout/fonts/BebasNeue-Bold.otf
```

Used by `scenes/rivalry.html` via `@font-face { font-family: 'Bebas Neue Bold'; ... }`.

## ITC Korinna

Place the file as one of (first match wins):

```
public/layout/fonts/Korinna.woff2
public/layout/fonts/Korinna.woff
public/layout/fonts/Korinna.otf
public/layout/fonts/Korinna.ttf
```

Used by `eventheader/eventheader.html` via `@font-face { font-family: 'ITC Korinna'; ... }`.
ITC Korinna is a commercial typeface — PRSH cannot ship it. When absent, the
Event Header falls back to a compatible serif (Georgia).

**Note:** Font files (`*.otf`, `*.ttf`, `*.woff`, `*.woff2`) in this directory are gitignored — licensing usually forbids committing them. Each machine that runs the app needs the font dropped in locally.
