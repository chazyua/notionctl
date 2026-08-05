# Command Reference

Complete reference for all 39 notionctl commands.

**Conventions:** All IDs accept Notion URLs, hyphenated UUIDs, or compact hex. All write commands support `--dry-run`. Output defaults to human-friendly in a TTY, JSON when piped. Override with `--format md|json|table|csv`.

---

## Meta

| Command | Description |
|---------|-------------|
| `whoami` | Show the current integration name and owner |
| `search <query>` | Search pages and databases by title/content |
| `resolve <url>` | Convert a Notion URL to a UUID |
| `api <METHOD> <path>` | Raw API escape hatch with auth and retries |

```sh
notionctl whoami
notionctl search "Q2 Roadmap" --type page
notionctl resolve "https://notion.so/My-Page-abc123..."
notionctl api POST /databases/<id>/query --body @filter.json
```

---

## Pages (11 commands)

### page get

Read a page as Markdown with YAML front-matter (database properties).

```sh
notionctl page get <id>                    # Markdown output
notionctl page get <id> --format json      # Raw API response
```

Nested blocks render with 2-space indentation. Database row pages include all properties in the front-matter.

### page create

Create a new page under a parent page.

```sh
notionctl page create --parent <id> --title "Sprint Review" --from notes.md
echo "# Hello" | notionctl page create --parent <id> --title "Quick Note"
```

If the Markdown contains an H1 matching `--title`, the duplicate heading is stripped.

### page append

Append Markdown blocks to an existing page.

```sh
notionctl page append <id> --from additions.md
cat update.md | notionctl page append <id>
```

### page update

Replace a page's content (and optionally its title).

```sh
notionctl page update <id> --from revised.md
notionctl page update <id> --title "New Title"
notionctl page update <id> --title "New Title" --from body.md
```

Existing blocks are deleted and replaced with the new content.

### page sync

Idempotent content-hashed sync between a local `.md` file and Notion.

```sh
notionctl page sync ./prd.md --parent <id>     # First sync (creates page)
notionctl page sync ./prd.md                   # Subsequent syncs (updates)
notionctl page sync ./prd.md --force           # Override drift protection
```

The file's YAML front-matter tracks `notion_id`, `notion_hash` (SHA-256), and `notion_synced_at`. If someone edits the page in Notion after your last sync, notionctl refuses to overwrite unless `--force` is passed.

### page open

Open a page in the default browser.

```sh
notionctl page open <id-or-url>
```

### page find-replace

Find and replace text across all blocks and the page title.

```sh
notionctl page find-replace <id> --find "v1" --replace "v2"
notionctl page find-replace <id> --find "old" --replace "new" --dry-run
```

Operates on paragraphs, headings, lists, to-dos, quotes, callouts, and toggles. Recurses into nested blocks.

### page duplicate

Deep-copy a page (content + nested blocks) to a new location.

```sh
notionctl page duplicate <id>
notionctl page duplicate <id> --parent <new-parent> --title "Copy of PRD"
```

### page move

Move a page to a new parent.

```sh
notionctl page move <id> --to <new-parent-id>
```

### page restore

Restore an archived (trashed) page.

```sh
notionctl page restore <id>
```

### page delete

Archive a page (soft delete). Requires `--yes` confirmation.

```sh
notionctl page delete <id> --yes
```

---

## Databases (8 commands)

### db create

Create a new database with typed columns.

```sh
notionctl db create --parent <page-id> --title "Tasks" \
  --prop Status=select:Todo,Doing,Done \
  --prop Priority=select:P0,P1,P2 \
  --prop Due=date \
  --prop Effort=number
```

Supported column types: `text`, `number`, `checkbox`, `date`, `url`, `email`, `phone`, `people`, `files`, `select`, `multi_select`. For complex schemas, use `--schema-json @schema.json`.

### db update

Modify a database's title, columns, or schema.

```sh
notionctl db update <id> --title "Sprint Backlog"
notionctl db update <id> --add-prop Reviewer=people
notionctl db update <id> --remove-prop OldColumn --yes
notionctl db update <id> --rename-prop Status=Stage
```

Removing a property deletes its data in every row and cannot be undone, so it
requires `--yes`. This covers `--remove-prop` and any `null` value passed via
`--schema-json`; if either is present without `--yes`, the whole command is
refused and nothing is written. `--title`, `--add-prop`, and `--rename-prop`
need no confirmation.

### db query

Query rows with an ergonomic filter DSL.

```sh
notionctl db query <id>
notionctl db query <id> --filter "Status=Done" --sort "Date:desc"
notionctl db query <id> --filter "Priority=P0" --filter "Due<=2026-04-15"
notionctl db query <id> --filter-json @complex-filter.json
```

Repeated `--filter` flags are ANDed. `--filter` and `--filter-json` cannot be
combined — pick one. Results are paginated automatically up to 100 pages
(~10,000 rows); past that the response carries a real `next_cursor` and a
truncation warning is printed to stderr.

**Filter operators by property type:**

| Type | Operators | Example |
|------|-----------|---------|
| select, status | `=` | `Status=Done` |
| checkbox | `=` | `Done=true` |
| number | `= > < >= <=` | `Count>=10` |
| title, rich_text | `=` (contains) | `Name=PRD` |
| date | `= > < >= <=` | `Due>2026-04-01` |
| multi_select | `=` (comma = AND) | `Tags=urgent,important` |

### db schema

Show a database's property names and types.

```sh
notionctl db schema <id>
notionctl db schema <id> --format json
```

### db row get

Read a single database row as Markdown with property front-matter.

```sh
notionctl db row get <page-id>
```

### db row create

Create a new row in a database.

```sh
notionctl db row create <db-id> --prop "Name=Ship v2" --prop "Status=Todo"
notionctl db row create <db-id> --prop "Name=Design doc" --from body.md
```

### db row update

Update properties on an existing row.

```sh
notionctl db row update <page-id> --prop "Status=Done" --prop "Priority=P0"
notionctl db row update <page-id> --prop "Points="          # empty value clears the property
```

An empty value clears the property.

**Property value syntax for `--prop Name=value`:**

| Type | Value | Example |
|------|-------|---------|
| title, rich_text, url, email, phone_number | the text itself | `--prop "Name=Ship v2"` |
| number | a number | `--prop "Points=3"` |
| checkbox | `true` / `false` | `--prop "Done=true"` |
| select, status | the option name | `--prop "Status=Done"` |
| multi_select | comma-separated names | `--prop "Tags=urgent,backend"` |
| date | a date, or `start..end` | `--prop "Due=2026-04-15"` |
| people | `user:<id>`, comma-separated for several | `--prop "Assignee=user:<id>,user:<id>"` |
| relation | `page:<id>`, comma-separated for several | `--prop "Blocks=page:<id>,page:<id>"` |
| files | `url:<https-url>` | `--prop "Spec=url:https://example.com/a.pdf"` |

`people` and `relation` take ids, not names — `notionctl user list` prints user
ids, and a page id may be pasted as a Notion URL. Square brackets are optional:
`[user:a, user:b]` and `user:a,user:b` mean the same thing. Wrap a value
containing a comma in quotes.

An empty value clears any property that can be empty — `--prop "Assignee="`
removes everyone, `--prop "Points="` clears the number.

### db row delete

Archive a database row. Requires `--yes`.

```sh
notionctl db row delete <page-id> --yes
```

---

## Blocks (5 commands)

### block get

Read a single block by ID.

```sh
notionctl block get <id>                   # JSON (default)
notionctl block get <id> --format md       # Markdown
```

### block children

List child blocks of a page or block.

```sh
notionctl block children <id>              # Direct children as Markdown
notionctl block children <id> --recursive  # Full subtree
```

### block append

Append blocks to a page or block. Supports `--after` for insertion position.

```sh
notionctl block append <id> --from content.md
notionctl block append <id> --from patch.md --after <block-id>
echo "New paragraph" | notionctl block append <id>
```

### block update

Patch a block with raw Notion JSON.

```sh
notionctl block update <id> --prop-json '{"paragraph":{"rich_text":[{"text":{"content":"Updated"}}]}}'
```

### block delete

Delete a block. Requires `--yes`.

```sh
notionctl block delete <id> --yes
```

---

## Files (1 command)

### file upload

Upload a file to Notion's CDN. Optionally attach it to a page.

```sh
notionctl file upload ./screenshot.png --parent <page-id>
notionctl file upload ./report.pdf
```

Images are attached as image blocks; other files as file blocks. Supports: PNG, JPG, GIF, WebP, SVG, PDF, MP4, MP3, WAV, CSV, TXT, JSON, ZIP.

---

## Comments (2 commands)

```sh
notionctl comment list <page-id>
notionctl comment add <page-id> --text "Looks good, ship it"
```

---

## Users (2 commands)

```sh
notionctl user list                        # All workspace members
notionctl user me                          # Current integration bot
```

---

## Auth (6 commands)

### auth login

OAuth browser-based login. Opens a browser for Notion authorization, exchanges the code for a token, and saves it.

```sh
notionctl auth login --client-id <id> --client-secret <secret>
notionctl auth login --client-id <id> --client-secret <secret> --port 9876
```

**Prerequisites:** Create a public integration at [notion.so/profile/integrations](https://www.notion.so/profile/integrations). Set the redirect URI to `http://localhost:9876/callback`.

Default port is 9876 (configurable via `--port`). The command starts a local HTTP server, opens the browser, and waits up to 5 minutes for the callback.

### auth set

Store an integration token (read from stdin, never shell arguments).

```sh
notionctl auth set
notionctl auth set --profile staging
echo "ntn_..." | notionctl auth set
```

`default` is reserved — omit `--profile` to use the default profile.

### auth status

Verify the current token against Notion's API.

```sh
notionctl auth status
notionctl auth status || notionctl auth login
```

Exits 0 when the token works and 3 when it does not, so it can gate a login in a
script. The JSON always reports `valid`.

### auth doctor

Run diagnostic checks: token source, file permissions, API connectivity, workspace, page access.

```sh
notionctl auth doctor
```

Prints every check regardless of outcome, then exits 3 if any check failed and 0
otherwise. Warnings are advisory — an integration connected to no pages is a
valid setup — so they do not fail the command.

### auth list

List configured profiles.

```sh
notionctl auth list
```

### auth clear

Remove the token file. Requires `--yes`.

```sh
notionctl auth clear --yes
```

Removes the config file only. If `NOTION_TOKEN` is exported it still takes
precedence and you remain authenticated — the command warns when that applies.

---

## Global Flags

| Flag | Description |
|------|-------------|
| `--format md\|json\|table\|csv` | Override output format |
| `--dry-run` | Preview writes without sending |
| `--verbose` | Show request count on stderr after completion |
| `--quiet` | Suppress non-essential output |
| `--no-color` | Disable colored output |
| `--yes` | Confirm destructive operations |
| `--profile <name>` | Use a named auth profile |
| `--debug` | Log HTTP method, path, and status to stderr (token-scrubbed) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NOTION_TOKEN` | Integration token (takes precedence over config file) |
| `NOTION_PROFILE` | Default profile name |
| `NOTION_TIMEOUT_MS` | Request timeout in ms (default: 30000) |
| `XDG_CONFIG_HOME` | Base dir for config (default: `~/.config`) |

## Markdown Support

notionctl's Markdown engine handles bidirectional conversion:

**Read (Notion to Markdown):** headings, paragraphs, bullet/numbered/to-do lists (nested), code blocks (with language), tables, quotes, callouts, toggles, dividers, images, bookmarks, bold, italic, strikethrough, inline code, links.

**Write (Markdown to Notion):** headings (H1-H3, ATX `#` or setext `===`/`---`), paragraphs, bullet/numbered/to-do lists (nested via 2-space indent), code blocks, tables, blockquotes, dividers, images, bold, italic, strikethrough, inline code, links.

**Broken front-matter is refused.** Every command that reads a Markdown file —
`page create/append/update`, `page sync`, `db row create`, `block append` —
refuses a file whose front-matter block opens and closes but does not parse,
naming the offending line. Writing it would put the delimiters and every YAML
line, `notion_id` included, onto the page as visible content. A file with no
front-matter, or one whose `---` opener is never closed, is not front-matter and
is written as-is; a file meant to open with a horizontal rule should use `***`.

**Empty paragraphs are not preserved.** A blank paragraph used as spacing in
Notion has no Markdown equivalent — a blank line is already how blocks are
separated — so spacers are dropped on read and not recreated on write. Syncing a
page back therefore removes its blank spacing. Only spacing is affected: a blank
paragraph that carries child blocks keeps them. This is stable, not cumulative;
a second sync changes nothing further.

**Mentions.** A person, page or database mention is written as
`[Name](notion://user/<id>)` (or `notion://page/`, `notion://database/`) and is
rebuilt as a real mention when the file is written back. Editing the label is
safe; changing the id changes who or what is mentioned.

**Callout icons.** An icon that the alert type does not already imply is kept in
a `<!-- icon: ... -->` comment above the callout body: an emoji, an image URL, or
`notion:<name>:<colour>` for one of Notion's built-in icons. An icon uploaded to
Notion cannot be written back — its URL expires — so it is marked
`notion-hosted` and the callout falls back to a default icon with a warning.

**Toggleable headings.** A heading that collapses in Notion is written as a
`<details>` block preceded by a marker naming its level, so both the toggle and
its nested content survive a round-trip:

```markdown
<!-- notion-heading: 2 -->
<details><summary>Collapsible section</summary>

Content inside the heading.

</details>
```

A `<details>` block with no marker above it is an ordinary toggle. A heading
written as `## text` is an ordinary, non-collapsing heading.

**Line breaks in headings.** Markdown headings occupy a single line, so a line
break inside a Notion heading is collapsed to a space when read. Syncing the file
back rewrites the heading in Notion to match.

**Multi-paragraph list items.** Content indented to the item's body column stays
inside that item:

```markdown
- Step one

  Why step one matters.

  ```bash
  run --it
  ```

- Step two
```

A line wrapped without a blank line above it (`- long item that\n  wraps`) is
folded into the item's own text, not made a separate block.

**Nesting limit.** Notion accepts at most two levels of nesting below the top
level of a page and rejects the entire request when a write exceeds it. Depth is
counted across all block types together — a list inside a callout inside a toggle
shares one budget with a three-level list. A table needs a level for its rows, so
it fits one level shallower than other blocks. Content past the limit is written
beside its parent instead, and a warning is printed to stderr.
