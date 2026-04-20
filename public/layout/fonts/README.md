# Scene layout fonts

Drop self-hosted font files here. They are served at `/layout/fonts/<filename>`.

## Bebas Neue Bold

Place the file as:

```
public/layout/fonts/BebasNeue-Bold.otf
```

Used by `scenes/rivalry.html` via `@font-face { font-family: 'Bebas Neue Bold'; ... }`.

**Note:** Font files (`*.otf`, `*.ttf`, `*.woff`, `*.woff2`) in this directory are gitignored — licensing usually forbids committing them. Each machine that runs the app needs the font dropped in locally.
