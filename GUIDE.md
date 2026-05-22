# Site Guide

Everything you need to run, write, and maintain this Hugo site.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Starting the Dev Server](#2-starting-the-dev-server)
3. [Writing a Post](#3-writing-a-post)
4. [Writing a Note](#4-writing-a-note)
5. [Adding a Link to Reads](#5-adding-a-link-to-reads)
6. [Publishing (removing draft)](#6-publishing-removing-draft)
7. [Building for Production](#7-building-for-production)
8. [Site Structure Reference](#8-site-structure-reference)

---

## 1. Prerequisites

You need **Hugo** installed. Check if it's already there:

```bash
hugo version
```

If not installed, get it from [gohugo.io/installation](https://gohugo.io/installation/).  
On Windows with Winget:

```powershell
winget install Hugo.Hugo.Extended
```

On Mac:

```bash
brew install hugo
```

---

## 2. Starting the Dev Server

From the project root (the folder containing `hugo.yaml`):

```bash
hugo server
```

Then open **http://localhost:1313** in your browser.

The server watches for file changes and reloads automatically — but **template changes** (files in `layouts/`) require a full restart. Stop with `Ctrl+C` and re-run `hugo server`.

Useful flags:

```bash
# include draft posts in the preview
hugo server -D

# use a different port if 1313 is taken
hugo server --port 1414
```

---

## 3. Writing a Post

Posts are longer, considered pieces. They live in `content/posts/`.

**Step 1 — Create the file**

```bash
hugo new posts/your-post-title.md
```

This creates `content/posts/your-post-title.md` pre-filled with front matter from the archetype.

Or just create the file manually in `content/posts/`.

**Step 2 — Edit the front matter**

Open the file. You'll see this at the top:

```yaml
---
title: "Your Post Title"
date: 2026-05-22T10:00:00+00:00
draft: true
tags: []
description: ""
---
```

Fill in:
- `title` — displayed as the page heading and in the list
- `date` — controls sort order (newest first)
- `draft` — keep `true` while writing, change to `false` to publish
- `tags` — optional list, e.g. `["programming", "tools"]`
- `description` — optional short summary

**Step 3 — Write the content**

Below the closing `---`, write in Markdown:

```markdown
---
title: "My Post"
date: 2026-05-22
draft: false
tags: ["tools"]
description: "A post about tools."
---

Intro paragraph here.

## Section heading

More content. **Bold**, _italic_, `inline code`.

- bullet one
- bullet two

> A blockquote looks like this.
```

Posts show up on the home page (most recent 5) and at `/posts/`.

---

## 4. Writing a Note

Notes are shorter, rougher thoughts. They live in `content/notes/`. Same workflow as posts but simpler front matter — no tags or description field.

**Step 1 — Create the file**

```bash
hugo new notes/your-note-title.md
```

Or create `content/notes/your-note-title.md` manually.

**Step 2 — Edit the front matter**

```yaml
---
title: "Your Note Title"
date: 2026-05-22T10:00:00+00:00
draft: true
---
```

**Step 3 — Write the content**

```markdown
---
title: "on focus"
date: 2026-05-22
draft: false
---

One thought, written clearly. Notes don't need structure.
```

Notes show up on the home page (most recent 3) and at `/notes/`.

---

## 5. Adding a Link to Reads

Reads are curated links grouped by category. They're stored in `data/reads.yaml` — no Markdown file needed.

Open `data/reads.yaml`:

```yaml
tools:
  - title: "Hacker News"
    url: "https://news.ycombinator.com"
    note: "daily tech pulse"

articles:
  - title: "The Grug Brained Developer"
    url: "https://grugbrain.dev"
    note: "on simplicity and complexity"

philosophy:
  - title: "Meditations – Marcus Aurelius"
    url: "https://standardebooks.org/ebooks/marcus-aurelius/meditations/george-long"
    note: "stoicism, free ebook"
```

**To add a link to an existing category**, append a new entry under that category:

```yaml
tools:
  - title: "Hacker News"
    url: "https://news.ycombinator.com"
    note: "daily tech pulse"
  - title: "Your New Tool"          # add here
    url: "https://example.com"
    note: "short description"
```

**To add a new category**, add a new top-level key:

```yaml
books:
  - title: "The Pragmatic Programmer"
    url: "https://pragprog.com/titles/tpp20/"
    note: "foundational software craft"
```

The `note` field is optional. The reads page at `/reads/` updates automatically.

---

## 6. Publishing (removing draft)

New content is created with `draft: true`, which means it only appears when you run `hugo server -D`. It won't appear on the live site or in a regular `hugo server`.

To publish, open the file and change:

```yaml
draft: true
```

to:

```yaml
draft: false
```

Save the file. The post appears immediately in the dev server and in the next production build.

---

## 7. Building for Production

When you're ready to deploy, build the static files:

```bash
hugo
```

This outputs everything into the `public/` folder. Upload the contents of `public/` to any static host:

- **Netlify** — connect the repo, set build command to `hugo`, publish dir to `public`
- **GitHub Pages** — use the [Hugo GitHub Action](https://gohugo.io/hosting-and-deployment/hosting-on-github/)
- **Cloudflare Pages** — connect repo, build command `hugo`, output `public`
- **Any server** — just copy the `public/` folder contents via FTP/SCP

Before building, make sure your `baseURL` in `hugo.yaml` is set to your real domain:

```yaml
baseURL: 'https://yourdomain.com/'
```

---

## 8. Site Structure Reference

```
ajlog/
├── content/
│   ├── posts/          ← long-form posts (.md files)
│   ├── notes/          ← short notes (.md files)
│   └── reads/
│       └── _index.md   ← reads page intro text
├── data/
│   └── reads.yaml      ← all curated links live here
├── layouts/            ← HTML templates (edit with care)
├── static/
│   └── css/
│       └── main.css    ← all site styles
├── hugo.yaml           ← site config, title, menu, social links
└── GUIDE.md            ← this file
```

**To update your bio or contact links**, edit `hugo.yaml`:

```yaml
params:
  author: "aj"
  tagline: "writing to think"
  about: "Your short bio here."
  email: "you@domain.com"
  linkedin: "https://linkedin.com/in/yourhandle"
```
