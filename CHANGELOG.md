# Changelog

All notable changes to `notionctl` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] — 2026-08-09

### Changed
- CSV output no longer rewrites cells that a spreadsheet might evaluate as a
  formula. Prefixing them with `'` was not the stored data: every international
  phone number came out as `'+1 555 0100`, and writing that back through
  `--prop` persisted the corruption. The rewrite also only ever covered the
  first character of a `--format csv` cell, so the same value still reached a
  spreadsheet unescaped via `--format json | jq -r @csv` or the table output —
  it was never the boundary that could enforce this. The CSV now holds the data
  unchanged, and a cell that really does look executable (`=…`, or `+`/`-`/`@`
  followed by a call or a DDE pipe) is reported on stderr with the column that
  contains it, so stdout stays clean for the consumer.

### Fixed

**Content destruction**
- `page update --from` and `page sync` deleted every block on a page when the
  input parsed to no blocks at all, reported `deletedBlocks: N,
  appendedBlocks: 0`, and exited 0. An empty file, a wrong `--from` path, or a
  document whose only line is the `# H1` that becomes the title were all enough,
  and nothing in the output said the content was gone. `page append` had
  guarded this case all along; the two commands that *replace* content did not.
  Both now refuse and explain, with `--force` still available for deliberately
  emptying a page.
- A truncated or hand-mangled `notion_synced_at` silently switched drift
  detection off. The value is still valid YAML, so nothing upstream rejected it;
  it parsed to `NaN`, the comparison was skipped, and `page sync` overwrote
  genuine remote edits with stale local content — no warning, no `--force`
  needed. A baseline that is present but unreadable now fails closed, the same
  way an unreadable remote already did. A genuinely absent baseline still
  classifies as a normal first push.

**Auth**
- A config file with permissions *stricter* than 0600 was rejected as insecure.
  `chmod 400` — hardening the file — made every command fail with advice to run
  a `chmod` that would loosen it again. The check now tests that group and other
  have no access, rather than requiring the mode to equal 0600 exactly.
- A config file containing the literal JSON `null` crashed with a raw
  `Internal error: Cannot read properties of null`. `JSON.parse("null")`
  succeeds, so the surrounding catch never fired. It now reports a clean auth
  error naming the file.

**Databases**
- `--schema-json` bypassed the same-column ambiguity guard: a key in the JSON
  silently overruled a `--remove-prop` the user had already confirmed with
  `--yes`, so the column survived and the command reported success. Keys from
  `--schema-json` now go through the same `claim()` check as every other flag.

**Regressions in the round of fixes above**
- An inline code span longer than 2000 characters came back with two literal
  backticks spliced into it, and lost the `code` annotation entirely on the
  next round-trip. Notion splits a run at 2000 characters and each run had
  started emitting its own delimiter pair, so `` `a` `` + `` `b` `` was written
  as `` `a``b` `` and read back as one span containing the delimiters. Runs
  that share their annotations and link are merged before anything is emitted.
- A paragraph mixing prose dollars with a real inline equation lost the
  equation and gained a bogus one whose expression ended in a stray backslash.
  The scanner searched for the closing `$` with a plain `indexOf`, so an
  escaped `\$` written by the escaper was accepted as a delimiter. Escaped
  dollars are now skipped. (Such an equation still degrades to literal text
  when the closing `$` is followed by an alphanumeric — the `$…$` form cannot
  express that — but every character survives.)
- An inline code span consisting only of whitespace grew on every read: a
  single space came back as three. The padding CommonMark strips is only
  stripped when the content is not all spaces, so all-whitespace content is now
  written unpadded, which round-trips exactly.
- A property value containing a backslash lost half of them on every
  `--prop` write, and again on each later cycle: `C:\\server\\share` was
  written as `C:\server\share` and a stored `\\d+` as `\d+`. Unescaping was
  applied to values that were never quoted, with `\\` in the escape set. Only
  `\"` and `\'` are unescaped now.
- Emphasis escaping scanned the whole line once per asterisk and once per run.
  On a paragraph where no asterisk short-circuits the check — every one
  followed by a letter and preceded by a space, as in `takes *ctx and *req` —
  200 runs over 23k characters took 2.5 seconds per block. The scan is now
  single-pass; the same input takes about 6ms.
- A database column name containing an apostrophe made `page get` emit
  front-matter it could not read back. Keys were quoted for colons and
  newlines but not apostrophes, and the reader treats one as opening a quoted
  span wherever it appears, so the separating colon was hidden and the line
  parsed as "no key". The whole block was then discarded — `notion_id`
  included — and `page sync` refused the file with no `--force` to get past it.
- `page sync` and `page get` could fail with a bare `Internal error: EEXIST`
  and, on a first sync, create a duplicate page on every retry. The atomic
  write opened its temp file with `wx` at a path keyed only on the process id,
  so any leftover — a run killed between write and rename, a pid reused across
  containers on a shared volume — failed every later run, after the remote
  write had already landed and before the new page id was recorded. The temp
  name now carries random bytes, and a failed write cleans up after itself.
- `--help` stopped working once it sat more than two arguments after the verb:
  `db row get <id> --help`, `api GET /users/me --help` and
  `page find-replace <id> --find X --help` all failed with "Flag --help
  requires a value". Help is recognised anywhere again, except where the token
  is a value belonging to the flag before it — which is the case the bounded
  window had been introduced to handle.

**Data integrity**
- A database column whose name contained a colon corrupted the front-matter
  `page get` and `db row get` write: `Ref: x` was emitted bare, so reading it
  back gave the key `Ref` with the value `x: <value>` and the column was
  silently renamed. Front-matter keys are now quoted and escaped the way values
  always have been. With a newline in the name the same gap emitted a whole
  extra line — a second `notion_id:` that overrode the real one and pointed the
  next sync at another page, straight past the reserved-key guard. A repeated
  key is now refused outright rather than resolved last-wins.
- `page sync` overwrote remote edits without checking for drift whenever the
  metadata fetch failed. A transient 5xx or a permissions error left no remote
  timestamp, and the classifier silently skips the comparison when it has none,
  so the guard degraded to off exactly when the connection was unreliable. It
  now refuses unless `--force` is given. A missing page still reports as such.
- `page sync` could refuse forever on a workstation whose clock ran slow.
  `notion_synced_at` was stamped from the local clock but compared against
  Notion's, so a sync could record a time earlier than the edit it had just
  made and every later run read that as drift. Both `page get` and `page sync`
  now record the remote's own `last_edited_time`.
- A page whose first block was an empty paragraph carrying nested children was
  rewritten in full on every sync, untouched or not — the same hash mismatch
  fixed earlier for blank spacer paragraphs, reached by a second route.

**Safety flags**
- `auth set` and `auth login` ignored `--dry-run` and overwrote the stored token
  anyway. Both now report what they would do and write nothing.
- `--dry-run=yes` (and `=1`, `=on`) performed the real write. Only the literal
  `true` was recognised, so the spellings a user reaches for when they want the
  safe path silently selected the unsafe one. All the usual boolean spellings
  are accepted now, and a value that is none of them is refused rather than
  guessed in either direction.
- `db update --remove-prop X --rename-prop X=Y` renamed the column instead of
  removing it, and skipped the `--yes` confirmation on the way past. Two schema
  flags naming the same column are now refused.
- Any `-h` or `--help` appearing as a flag *value* printed help and exited 0
  instead of running the command, so `page find-replace --find -h` reported
  success having replaced nothing. Subcommand help is now recognised only in the
  argument positions where it can be meant.

**Network**
- Request timeouts covered only the response headers. `fetch` resolves as soon
  as those arrive, and the deadline was cancelled at that point, so a peer that
  sent headers and then stopped writing hung the command forever with
  `NOTION_TIMEOUT_MS` having no effect.
- A hostile or broken `Retry-After` of zero or less passed straight through to
  the backoff, firing immediately and collapsing the retry ladder into five
  back-to-back requests. It is now clamped at both ends.
- A paginated response whose second or later page came back without `results`
  escaped as an opaque internal error instead of a typed API error.

**Output**
- CSV cells beginning `=`, `+`, `@`, or a tab are prefixed with `'`. A page
  titled `=cmd|'/C calc'!A0` executed when the export was opened in Excel,
  Sheets, or LibreOffice. Negative numbers are left alone so ordinary exports
  stay usable.
- Table and CSV output stripped no control characters, though the error path
  has always done so and documents why. Remote text — a title, a property
  value, a comment — could clear the operator's screen or forge a `notionctl:`
  line. A lone carriage return, which the row-splitting pattern also missed,
  overwrote the row it was printed on.
- `--format` was silently ignored by `resolve`, `auth status`, `auth doctor`,
  and `auth list`, and `block children --format csv` returned Markdown. Each
  now honours the formats it can produce and refuses the rest; `resolve`,
  `auth list`, and `auth doctor` gained real JSON output.

**Markdown round-trip**
- A sub-page link was rebuilt as a page mention on write while the real
  sub-page block was (correctly) left in place, so every `page get` →
  `page update` cycle added another copy of the link.
- Ordinary text acquired emphasis it never had. Escaping was decided one
  rich-text run at a time while the parser sees the whole line, so two adjacent
  runs holding `5*x` and ` and 2*3` — neither an emphasis pair alone — came
  back with `x and 2` italicised.
- `$` was never escaped and could not be escaped, so a paragraph reading
  `The variable $n$ is the count` came back with `$n$` retyped as an equation.
- An inline code span containing a backtick was truncated: ``a`b`` returned as
  code `a` followed by the text ``b` ``. The delimiter is now sized to the
  content, as CommonMark specifies.
- Date mentions were written as `<2024-01-01>` and read back as literal text,
  losing the mention. They now round-trip, and an angle-bracketed date written
  as prose stays prose.
- A paragraph inside a toggle whose text began `</details>` closed the element
  early and the toggle lost its body.

**Argument handling**
- `--` now ends option parsing instead of being read as a flag named `""` that
  swallowed the argument after it.
- A stray positional is refused by every command that has a fixed shape, not
  just the destructive ones.
- A property name containing an apostrophe could not be set at all:
  `--prop "Owner's Notes=x"` was rejected as missing its `=`. A value that is
  genuinely quoted can now be written with `\"`.
- A list value containing a comma rendered indistinguishably from two values in
  `db query` table and CSV output, and feeding that cell back really did create
  two. Such values are quoted now.
- `page duplicate` reported a bare API error when the follow-up append failed,
  leaving a partial copy with no id to find it by — the two sibling commands
  already handled this.
- `--quiet` did not reach the HTTP layer's retry notices.

### Security

- `page open` validated only the scheme and host of the URL it handed to the
  platform opener. On Windows that opener is `cmd /c start`, which splits on
  shell metacharacters, so the unconstrained tail of the URL was a potential
  injection point. The path is now restricted to the characters a Notion URL
  actually uses.
- The OAuth callback handler ran as an async function passed straight to
  `createServer`, where a throw becomes an unhandled rejection: the process
  dies and the login promise never settles, with the port still bound. It is
  now wrapped, and the response is flushed before the server closes so the
  success page cannot be cut short by the process exiting.

**Content loss**
- `page update` and `page sync` moved every sub-page and sub-database on the page
  to the trash, along with everything inside them. Replacing a page's content
  deletes its blocks by id, and a sub-page link's id *is* the sub-page — so an
  unchanged file was enough to lose an entire branch of the workspace, with no
  warning, because an empty sub-page has no children to warn about. Those links
  are now left in place and reported; remove them in Notion if you mean to.
- `page sync` renamed the page to a heading from the middle of the body and
  deleted that heading. Only the *leading* `# ` line is the title, which is what
  `page get` writes and what the surrounding code already assumed. Worst on a
  database row, which has no title line: every sync renamed the row to its first
  section and ate one heading.
- A page whose content began with a blank paragraph was rewritten in full on
  every sync, even untouched. The leading blank lines were written into the file
  but stripped when it was read back, so the content never matched its own hash
  — and for `page sync` a mismatch means delete-and-recreate. Blocks that render
  to nothing no longer contribute blank lines.

- `page update` and `page sync` deleted a page's existing blocks before writing
  the replacement, so a failure during the write (a block Notion rejected, a
  dropped connection, exhausted retries) left the page with its original
  content gone and nothing in its place. The new content is now written first.
- `page get` followed by `page sync` could delete and recreate every block on a
  page the user had not touched, permanently losing uploaded images and files.
  The written file carried one more trailing newline than the content that was
  hashed, so an unchanged file was misread as edited. This affected any page
  ending in a blank paragraph, and any page with a title and no content.
- `page update` and `page sync` now warn when the blocks being replaced contain
  nested children. The previous warning only inspected top-level blocks, so an
  image inside a toggle or callout was deleted with no warning at all.
- `db row create --from` failed outright for files producing more than 100
  blocks, creating no row. Content beyond the first 100 blocks is now written
  in a follow-up request.
- Number properties could not be cleared: `--prop Points=` wrote `0` over the
  existing value. An empty value now clears the property, matching `select`,
  `status`, and `date`.
- Prose that began with a Markdown marker was rewritten into that block on the
  next sync. A paragraph reading `---` came back as a divider with its text
  gone; `# note` became a heading, `- note` a bullet, `> note` a quote; quote
  and callout bodies beginning with a marker lost their text entirely. This
  fired on any `page sync` of a page containing such text, even one nobody had
  edited. Those lines now carry a backslash in the Markdown, removed again on
  the way back, so both the text and the block type survive. In a hand-written
  file, a line such as `\---` is now read as the text `---` rather than as a
  literal backslash followed by three dashes.
- `page sync` treated a file whose front-matter failed to parse as a file that
  had none: it ignored `notion_id`, created a second page, left the original
  orphaned, and wrote the old YAML into the new page as visible text. A single
  line missing its colon was enough. Such a file is now refused, with the parse
  error and the offending line. Files with no front-matter, or with an unclosed
  `---` opener, still create as before. A `notion_id` that is present but
  unusable — blank, `null`, `~`, or a number — is refused for the same reason;
  it too was read as "no id" and created a duplicate. **Note:** a file that opens
  with a `---` horizontal rule is indistinguishable from a broken front-matter
  block and is now refused — write the rule as `***`.
- A file saved with a UTF-8 byte-order mark — the default for PowerShell and
  several Windows editors — had its front-matter ignored entirely, because the
  mark sits in front of the opening `---`. `page sync` read the file as new,
  created a duplicate page, orphaned the original, and wrote the raw YAML onto
  the new page as text. The mark is now stripped before the front-matter is
  matched, and no longer leaks into page content.
- Text containing a literal `$$` was rewritten into a rendered equation: `a $$x$$ b`
  became `a $` + an inline equation + `$ b`. The second `$` of a `$$` pair no
  longer opens an inline equation. Genuine `$x$` equations and currency amounts
  such as `$5 and $10` are unaffected.

**Write-safety flags**
- `--profile` with no value consumed the following flag as its value, so
  `page delete <id> --profile --dry-run --yes` performed a real delete. A value
  that looks like a flag is now rejected.
- Writing `--yes false` to decline a confirmation did the opposite: boolean
  flags take no value, so `--yes` was set and `false` was silently discarded as
  an unused argument. `page delete <id> --yes false`, `block delete`,
  `api DELETE` and `db update --remove-prop` all performed the destructive
  action. Those commands now reject any argument they have no use for, so the
  stray value is a usage error instead. Use `--yes` alone to confirm, omit it to
  decline, or write `--yes=false` to be explicit.
- `api POST|PATCH|DELETE` ignored `--dry-run` and performed the request.
- `page restore` ignored `--dry-run` and performed the request.
- `db update` removed database properties without any confirmation. Removing a
  property deletes its data in every row and cannot be undone, yet it was the
  only destructive operation with no `--yes` gate. It now requires `--yes`,
  whether the removal comes from `--remove-prop` or from a `null` value inside
  `--schema-json`. **Breaking:** scripts calling `db update --remove-prop`
  without `--yes` now exit with a usage error instead of deleting the column.

**Silent or misleading output**
- Output larger than 64 KB was truncated when piped, while still reporting
  success. Every exit path now flushes before exiting, and a reader that closes
  early (`| head`) ends the pipeline cleanly.
- Paginated reads past roughly 10,000 items reported the result as complete.
  The response now carries the real cursor and a warning is printed.
- `--filter` was silently ignored when `--filter-json` was also given. Passing
  both is now a usage error, raised before any request.
- `--filter Count=` on a number property queried for `Count == 0` instead of
  reporting an error, so an unset shell variable returned the wrong rows.
- A quoted comma in a select or multi-select option list silently produced
  malformed options: `--prop 'Severity=select:"Bug, Regression",Feature'` split
  into fragments carrying stray quote characters and created them. Option lists
  now honour quoting, so the value reaches Notion intact and is rejected with a
  clear message — Notion does not permit commas in option names — instead of
  corrupting the schema.
- `block get --format md` returned nothing for a table and other blocks whose
  content lives in their children. Children are now fetched when present.
- A response with a non-JSON body — an intercepting proxy or captive portal —
  surfaced as an internal error rather than a description of the problem.
- Retry backoff produced no output, so the CLI appeared frozen for up to a
  minute per attempt. Waits are now reported.
- Error messages could carry terminal control sequences from remote content.

**Hangs**
- `page create`, `page append` and every other command that reads Markdown from
  stdin blocked forever, with no output at all, when stdin was a pipe that
  stayed open — a background job, a producer that stalled, an inherited
  descriptor. These commands read stdin whenever it is not a terminal, so this
  needed no explicit redirection to happen. They now say they are waiting after
  ten seconds and stop after two minutes, rather than never. The limit is on
  idle time and every chunk resets it, so a producer that is slow but still
  sending is never cut off, and typing at a terminal — including `--from -` —
  has no limit at all, only a prompt saying input is being read.

**Diagnostics**
- `auth doctor` reported `[OK]` for a config directory its own owner cannot
  open: the check only rejected group and other permissions. It now requires the
  owner to be able to read, write and enter it.
- `auth doctor` said nothing about a config file left behind with loose
  permissions when `NOTION_TOKEN` was in use — a readable file still holding a
  usable token. It now warns, without failing the command.
- `auth doctor` was the one command whose output skipped the scrubbing applied
  to every error, so text from the API reached the terminal with any control
  characters intact. Its report is now scrubbed like everything else.
- A config file that could not be read for a reason other than being absent was
  passed over in silence. That reason is now reported.

- `auth doctor` never reported insecure config file permissions. The check only
  ran once the token had loaded, but loading refuses any mode other than 0600 —
  so the one case it existed for could not reach it. A file with the wrong
  permissions now gets its own line, with the `chmod` command that fixes it.
- `auth doctor` reported a bare "Could not verify page access" for a permission
  error, a timeout and a malformed response alike. It now names the cause, the
  way the connectivity check above it already did.

**Misleading success**
- `auth status` and `auth doctor` exited 0 even when they reported failure, so
  `notionctl auth status || notionctl auth login` never ran the fallback and a
  failing check looked healthy to CI. Both now exit 3 on failure. `auth doctor`
  still prints its complete report first, and warnings alone do not fail it.
  The JSON shape of `auth status` is unchanged.
- `auth clear --yes` reported success while `NOTION_TOKEN` remained set and
  still authenticated the user. It now says so.
- `--profile default` wrote a profile that no unflagged command could see,
  while `auth list` displayed it identically to the real default profile.
  `default` is now reserved.
- Interactive `auth set` appeared to hang: it waited for end-of-input, so
  pressing Enter after pasting a token did nothing. It now accepts the line.
- `file upload` discarded the upload identifier when attaching the file to a
  page failed, leaving no way to reference the uploaded file. It is now
  reported with the error.
- `file upload --dry-run` made a network request before printing its preview,
  which could stall for minutes on an unresponsive connection.
- An upload rejected by notionctl's own 20 MiB limit was reported as exceeding
  the workspace limit.
- `page create` reported success without indicating that no content was
  supplied, unlike `page append`.
- When writing content beyond the first 100 blocks failed, `page create` and
  `db row create` gave no way to find the partially-written page. `page sync`
  additionally created a duplicate page on every retry.
- `block append` omitted the guidance about connecting the integration that
  other commands show for the same error.
- A write that failed after Notion had already received it — a 5xx, a dropped
  connection, or a client-side timeout — was retried up to five times, so
  `page create`, `comment add`, `db row create` and block appends could create
  the same page, comment or blocks repeatedly while reporting a single success.
  Notion offers no way to deduplicate a repeated write, so these are no longer
  retried automatically, and the error now states that the request may already
  have been applied. `page move` is treated the same way, since Notion documents
  no retry guarantee for it. Rate-limit (429) retries are unchanged, as are
  retries for reads, property and schema updates, and deletes.

**Content loss (continued)**
- `page create`, `page append`, `db row create` and `block append`
  gave no sign when a file's front-matter block could not be parsed. The whole
  file — delimiters and every YAML line, `notion_id` included — became the body,
  so a single mistyped line put the metadata on the page as visible content
  without a word about it. They now say so, naming the offending line, and still
  write the file as it stands: a block that will not parse may equally be a
  horizontal rule above ordinary prose, which is what `block get` emits for a
  page starting with a divider, so refusing it would reject notionctl's own
  output. `page update` and `page sync` refuse instead, because both replace what
  is already there — writing the YAML would delete the page's existing blocks, or
  orphan the page entirely, and neither can be undone from the file.
- A page whose first block is a divider lost its opening section when read back
  and written elsewhere — `block get` emits no front-matter, so the leading `---`
  and the prose under it looked like a front-matter block, and whenever that
  prose happened to parse as YAML it was silently discarded. A `---` with a blank
  line beneath it is now read as a horizontal rule, which is what it is.
- A callout icon whose value contained a space — an image URL with one — split
  the callout into three blocks, leaving the callout empty, the marker comment
  visible as text, and the body in a separate quote. Any comment that is not one
  notionctl wrote is now skipped rather than ending the callout.
- A callout silently changed colour on every sync: a red one came back blue, and
  a default one came back blue, because the colour was only recorded when it
  could not be guessed from the alert type — while the alert type was chosen
  from the icon. The colour is now recorded whenever it differs from what the
  alert implies.

**Property values**
- Quoting list values did not work. `--prop 'Assignee="user:a","user:b"'` was
  read as one malformed entry, and `--prop 'Tags="Bug, Regression"'` became two
  options rather than one, because the surrounding quotes were removed before
  the list was split. Both now behave as written, for `people`, `relation` and
  `multi_select` alike.
- Setting more than one person or relation without square brackets silently
  produced one malformed id: `--prop "Assignee=user:a,user:b"` was read as a
  single user called `a,user:b`, and Notion rejected the row with an error that
  did not say why. Brackets are now optional, matching `multi_select`, and an
  empty value clears the property rather than failing. The error for a value
  missing its prefix now names the offending item and shows the accepted forms.
- The `user:` / `page:` prefixes and the bracket syntax were not documented
  anywhere. Every property type now has its value syntax in the command
  reference.

**Emphasis**
- Italic starting immediately after a word character was destroyed: the text was
  written as `ab*c*` and read back as those five literal characters, losing the
  italic and adding two asterisks to the text. The reader now accepts an opener
  mid-word, as CommonMark does, and the writer escapes asterisks wherever that
  would change the meaning — so `5*x*2` still comes back exactly as typed.
- Closing an italic run before a word character rewrote the wrong character when
  the text itself contained an underscore, turning `a_b` into `a*b` in the file.
  The opener's position is now recorded rather than guessed.

**Blocks that destroyed their neighbours**
- An equation spanning more than one line, or an empty one, swallowed the whole
  rest of the page. Its closing `$$` was written on the same line as the last
  line of the formula, where nothing recognises it, so everything below was read
  as part of the equation — and it grew by another `$$` on every sync. Such an
  equation is now written with its delimiters on their own lines.
- A toggle whose body merely mentioned `</details>` lost that content and left a
  stray paragraph behind; one mentioning `<details>` — a code sample, for
  instance — pulled the blocks that followed it inside the toggle. Only a tag
  alone on its own line, outside a code block, now opens or closes one.
- A backtick in a table cell merged that cell with the one after it and deleted
  the last column of every row, gaining a backslash on each sync. A line break in
  a cell stopped the table being a table at all. Both now survive.

**Markdown conversion**
- Setext headings were mangled. `Title` followed by `===` became a single
  paragraph with the underline in the text; `Title` followed by `---` became a
  paragraph plus a horizontal rule. Both are now headings, H1 and H2
  respectively, matching every other Markdown tool. **Breaking:** a line of
  prose immediately followed by a line of dashes or equals signs — any number of
  them, so `-`, `--` and `======` all count — is now a heading, and the
  underline line is consumed. Existing files written by an earlier version, or
  by hand, are reinterpreted the first time they are written back: `Total` above
  a row of dashes was a paragraph and a rule, and becomes a heading. To keep a
  rule, leave a blank line above it or write it as `***`; to keep the text,
  prefix the line with a backslash. Text synced down from Notion is shielded
  automatically, including a heading that contains a line break.
- A list item with more than one paragraph broke apart. `- Item` followed by a
  blank line and an indented continuation moved the continuation out of the list
  to the top level, with its indentation showing in the visible text. Indented
  content — extra paragraphs, quotes, code — now stays inside the item it
  belongs to, including when a deeper nested item sits between the two. A line
  wrapped without a blank line above it now folds into the item's own text
  instead of becoming a separate block.
- Nesting deeper than Notion allows was rejected outright rather than adjusted.
  Only list depth was being counted, so three levels of mixed toggles, quotes and
  callouts exceeded the limit and Notion refused the whole request — the page was
  not written at all. A table two levels down failed the same way, since its rows
  need a level of their own. Depth is now tracked across every block type, and
  content past the limit is moved up beside its parent with a warning, as
  over-deep lists already were. Lists gained a level in the process: three levels
  of nesting are preserved where the fourth used to be flattened.
- A list item's own child blocks were written back to Markdown without
  indentation, so a `page get` followed by a `page update` moved them out of the
  list. They now round-trip in place.
- Toggleable headings were destroyed by a round-trip. The heading was written
  out as ordinary `# text` with its children dumped after it as siblings, and
  nothing in Markdown could produce a toggleable heading, so `page get` followed
  by `page update` left a plain heading with its content spilled out below and
  the toggle gone. A toggleable heading is now written as a `<details>` block
  preceded by a `<!-- notion-heading: N -->` marker naming its level, which
  restores both the toggle and the nesting. Plain headings are unchanged.
- A heading containing a line break came back as a heading plus a separate
  paragraph, turning one block into two on every sync. Markdown headings are a
  single line, so the break is now collapsed to a space — the heading stays one
  block and the text is kept. **Note:** this rewrites the heading in Notion the
  first time the page is synced.
- A toggle whose title contained `</summary>` or `</details>` lost everything
  after it, because the title is written inside an HTML element. Those sequences
  are now escaped and restored.
- A paragraph whose text happened to be one of the markers the reader emits —
  `<!-- notion-table: ... -->`, or a lone `#` — was swallowed on the next sync,
  and the marker went on to retype the following block. Those lines are now
  shielded like any other prose that begins with a marker.
- A marker left behind after hand-editing changed a block far below it: a
  leftover table marker stripped the header row off the next table it found,
  however many paragraphs sat in between. A marker now applies only to the block
  directly beneath it and is otherwise ignored.
- An empty heading came back as a paragraph containing `#`.
- Mentions were destroyed by a round-trip. A person mention was written as
  `@user:` followed by a raw account id, losing the name and putting an
  identifier into the visible text; page and database mentions became links
  pointing at a `notion://` address nothing can open. All three are now written
  as `[Name](notion://user/<id>)` and rebuilt as real mentions on the way back,
  so the name stays readable and the mention survives.
- A toggle whose title contained a line break lost the title entirely: written
  across two lines it ended its own `<summary>` element. Titles are now written
  on one line, as headings already were, and the same applies to list items,
  whose line break used to push the rest of the text out of the list.
- A link preview's title was written out unescaped, so a title ending its own
  link — `Ship it](https://elsewhere/)` — became a real, clickable link to an
  address the user never wrote, with the rest left as stray text. Titles come
  from the linked page, so this was remote content forging markup. Every mention
  kind is now escaped, including ones added to the API later. The same applied to
  sub-page titles, bookmark and image captions and embed captions — all remote
  text placed inside a link — which are now escaped too.
- A link or mention whose text contained a square bracket was destroyed. `]`
  ends a link label and was stripped of its escape on the way back in, but was
  never escaped on the way out, so a page titled `Roadmap] Q3 draft` ended its
  own link: an ordinary link silently became plain text, and a mention put the
  raw `notion://` address onto the page as visible content. Text such as
  `array[0]` was also written back with a stray backslash. Both brackets are now
  escaped, and a label is unescaped when read.
- Callout icons other than emoji were replaced with a default. A custom image
  icon or one of Notion's built-in icons was dropped on read and reinvented as
  the emoji matching the callout's colour. Both now round-trip. An icon uploaded
  to Notion still cannot be preserved — its address is temporary — so the
  callout keeps a default icon and says so, instead of writing back a link that
  has already expired.

### Added
- Test coverage for each fix above, alongside the module it exercises.



## [0.1.4] — 2026-04-24

### Security
- **Confused-deputy via property-name collision in sync metadata** (high): a
  Notion DB column named `notion_id`, `notion_hash`, or `notion_synced_at`
  could overwrite the corresponding sync-metadata frontmatter key emitted by
  `page get` / `db row get`. A subsequent `page sync` would then push the
  local body to whichever page id the attacker placed in the column,
  enabling cross-workspace exfiltration or drift-check bypass between
  collaborators with shared write access. Fix: `RESERVED_FRONTMATTER_KEYS`
  is now applied when projecting Notion properties into frontmatter, so a
  colliding property is dropped instead of overwriting sync state.
- **Symlink-follow in `notionctl auth set`** (low): `saveToken` used
  `writeFile`, which follows symlinks. A same-UID local process that
  pre-planted a symlink at `~/.config/notion-cli/config.json` pointing at,
  e.g., `~/.ssh/authorized_keys` would have that file overwritten with the
  token JSON. Fix: atomic write-then-rename using `open(..., "wx", 0o600)`
  on a temp file and `rename` into place. Refuses to write through an
  existing symlink at the destination.

### Added
- 5 regression tests covering the reserved-keys guard and the symlink case
  (731 → 736).

## [0.1.3] — 2026-04-12

### Fixed
- **Column content silently dropped** (BUG-13): `page get`, `page update`,
  `page sync`, and `page find-replace` now recurse into `column_list`/`column`
  blocks. Column content is rendered as sequential paragraphs with a sidecar
  comment preserving the column_list ID. Previously, all content inside columns
  was silently lost.
- **Embed block URLs lost** (BUG-14): embed blocks now preserve their URL as a
  `[url](url)` link with a sidecar comment (same pattern as bookmarks and
  link_previews). The write path round-trips embeds back to the correct block
  type. Previously, only the block ID was kept in an HTML comment and the URL
  was dropped entirely.
- **`page get` output triggers unnecessary sync re-push** (BUG-15): `page get`
  now includes `notion_hash` and `notion_synced_at` in YAML frontmatter so
  `page get > f.md && page sync f.md` correctly detects UNCHANGED state instead
  of re-pushing all blocks.
- **`page get` DB row detection** adapted to 2025-09-03+ API: uses
  `database_id` field presence instead of `parent.type` string comparison.
- **`page update --title` in non-TTY** no longer auto-reads empty stdin,
  preventing accidental content deletion in scripts.
- **`page delete` guard ordering**: `--yes` check now runs before `--dry-run`
  so dry-run without confirmation is rejected.
- **`page sync` hosted-media warning**: CHANGED/DRIFT paths now warn before
  deleting Notion-hosted media blocks (matching `page update` behavior).
- **`page restore` / `page delete`** now show 404 hints about Connections
  instead of bare "not found" errors.
- **Indented code blocks in list items**: read path indents code fences for list
  children; write path re-associates indented fences with the parent list item.

### Added
- 7 new regression tests (706 → 713).

## [0.1.3a] — 2026-04-12

### Fixed
- **Over-escaped markdown output**: `richTextToMarkdown` no longer backslash-
  escapes intraword underscores (`multi_select` not `multi\_select`), asterisks
  between alphanumerics (`2*3` not `2\*3`), or content inside inline code runs
  (`` `**bold**` `` not `` `\*\*bold\*\*` ``). Uses all-or-nothing strategy per
  character type to avoid context-shift bugs from selective escaping.
- **`.m4b` MIME type**: audiobook uploads now send `audio/mp4` instead of
  `application/octet-stream`.

### Added
- 9 new regression tests (722 → 731).

## [0.1.2] — 2026-04-11

### Fixed
- **Media block round-trip**: `page get → page update` no longer creates duplicate
  stub blocks for image/video/file/pdf/bookmark/link_preview. The write path
  absorbs the round-trip sidecar comment and preserves the original block type.
- **Multi-paragraph blockquote/callout formatting**: bold, italic, and links inside
  multi-paragraph blockquotes are no longer silently stripped on round-trip.
  Paragraph breaks between quote/callout children also survive round-tripping.
- **Infinite loop on whitespace-only list items**: `markdownToBlocks("- ")` no
  longer hangs. Empty-body bullets and numbered items are accepted as valid.
- **`page find-replace` now reaches all content**: previously missed text under
  toggleable headings, paragraphs with nested children, and table cells (table
  cells remain a documented limitation).
- **`page get` renders heading and paragraph children**: content nested under
  toggleable headings or deeply-appended paragraphs is no longer silently dropped.
- **`page update` H1 handling matches `page create`**: a leading H1 is only
  stripped from the body when it matches the explicit `--title` value, not
  unconditionally.
- **`page duplicate` skips Notion-hosted file blocks** with a clear warning instead
  of silently creating empty media blocks from expired signed URLs.
- **`page update` warns before deleting uploaded file attachments** that cannot be
  recreated from markdown, recommending `page append` for additive edits.
- **`page sync` warns on UNCHANGED when remote is inaccessible**: if `notion_id`
  points to a trashed page, stderr now explains instead of silently succeeding.
- **Symlink escape prevention in `page sync`**: resolves symlink targets via
  `realpath` so a symlink inside the working directory cannot redirect writes
  outside it.
- **`extractSyncTitle` fence tracking**: mixed-length fences (e.g. ```` inside a
  ````` block) no longer confuse the code-block state and promote an H1 inside
  code to the page title.
- **`replaceInRichText` skips equation and mention runs**: find-replace no longer
  rewrites equation expressions or mention references into plain-text runs.
- **CRLF normalization**: `markdownToBlocks` strips carriage returns so Windows
  line endings don't leak `\r` into Notion rich-text content.
- **Property parse for select/status/date**: empty values now send `null` (to clear
  the property) instead of `{name: ""}` which Notion rejects. Open-ended date
  ranges like `..2026-04-20` are rejected client-side with a clear message.
- **`parseColumnSpec` for select/multi_select**: trailing commas no longer create
  empty-name options; duplicate option names are rejected client-side.
- **`unique_id` render** includes the hyphen separator between prefix and number
  (TASK-42, not TASK42) matching Notion's UI.
- **Link title attributes** (`[label](url "title")`) are stripped so Notion doesn't
  reject the URL as invalid.
- **Notion-hosted media in `page get`**: uploaded files/images/videos/pdfs are now
  represented as sidecar-only markers instead of emitting ephemeral signed URLs
  that break on round-trip.

### Added
- **`--verbose` flag**: shows request count on stderr after command completion.
- **`--debug` flag**: logs HTTP method, path, and response status to stderr
  (token-scrubbed).
- 31 new regression tests (588 → 619).

## [0.1.1] — 2026-04-10

### Added
- **Nested list support** — both read and write paths preserve 2-space indentation.
  `page create`, `page update`, `page append`, and `page sync` emit correctly
  nested block trees; `page get` pre-fetches children and renders with
  indentation.
- **`db create` command** — create a database from the CLI with
  `--prop Name=type[:options]` for text/number/checkbox/date/url/email/phone/
  people/files/select/multi_select, plus `--schema-json` for unusual types.
- **`db update` command** — rename the database, add/remove/rename columns
  via `--add-prop`, `--remove-prop`, `--rename-prop`.
- **Richer `db query` filters** — number and date comparisons (`>`, `<`,
  `>=`, `<=`), plus multi_select `contains` (comma-separated values become
  AND-of-contains).
- **Sync drift detection** — `page sync` now fetches the remote page's
  `last_edited_time` and refuses to overwrite if it's newer than the local
  `notion_synced_at`. Override with `--force`.
- **`block children --recursive`** — fetches the full block subtree.
- **`page move` command** — move a page to a new parent with
  `page move <id> --to <parent-id>`. Uses Notion's dedicated move endpoint.
- **`page duplicate` command** — deep-copy a page with all its blocks
  (including nested children) to the same or a different parent.
- **Integration-not-connected hints** — NOT_FOUND errors from page/database
  fetches now suggest checking the Notion Connections menu.

### Fixed
- `page sync` on a trashed page now gives an actionable error pointing to
  removing `notion_id` from the frontmatter instead of a bare NOT_FOUND.
- `page create` / `page append` / `page update` with markdown containing
  YAML frontmatter no longer treat the frontmatter as content blocks.
- `page get` on non-database pages now prepends `# Title` so the
  `page get → page update` round-trip preserves the title.
- `resolve` no longer crashes on URLs that include `#block-anchor`
  fragments.
- `page create`'s body no longer double-prints the title when the body
  begins with an H1 that matches `--title`.
- `block update --prop-json` and `api --body` give clean error messages
  on malformed JSON instead of an unhandled exception.

### Changed
- `USER_AGENT` in `src/http.ts` now reads from `src/version.ts`, which is
  auto-generated from `package.json` on every build.
- `--version` flag reads from the same generated constant.

## [0.1.0] — 2026-04-09

### Added
- Initial implementation of 28 Notion CLI commands (`page`, `db`, `block`, `comment`, `user`, `auth`, and meta commands)
- Zero-runtime-dependency TypeScript codebase using Node 18+ built-ins
- Markdown ↔ Notion blocks round-trip converter with metadata sidecars
- Property value DSL covering all writable Notion property types
- Content-hashed `page sync` command for idempotent file-backed pages
- Raw REST escape hatch (`notionctl api <METHOD> <path>`)
- Structured error model with typed error codes and distinct exit codes
- `--dry-run` support on all write operations

## [0.0.1] — 2026-04-09

### Added
- Initial placeholder package to reserve the `notionctl` name on npm registry
