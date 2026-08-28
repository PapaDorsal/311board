# 311board — Design Brief

Status: written before step 0 (the Socrata data spike) returned a verdict. The
premise checks below are still open; everything here is direction, not a
commitment to ship.

## The thing we're making

A Chicago ward-level 311 response-time leaderboard. Public 311 service requests
are already open data; what nobody publishes is the comparison — which wards
close which request types fast, and which don't. The product is that
comparison, made legible.

## Register

The through-line across the earlier builds worth carrying here: **take the
bureaucratic artifact seriously as data, refuse to take its language
seriously.**

That is the whole voice. Concretely:

- The underlying record is treated with real rigor — correct fields, honest
  aggregation, stated methodology, no massaged numbers.
- The *presentation* of that record is plain-spoken and a little deadpan.
  "Pothole in the public way" becomes "potholes." A 47-day median becomes "a
  month and a half."
- Never sneering at the people inside the system. The joke is the language and
  the process, not the ward superintendent. This is what makes it land with
  residents and with the bureaucrats simultaneously — a bureaucrat should be
  able to send it to a colleague without it reading as an attack.
- No triumphalism, no outrage-farming. Deadpan means the number carries the
  weight; we don't add adjectives to it.

## Principles

1. **Lead with a live, concrete hook.** Not "explore 311 data." A specific,
   currently-true sentence: "Ward 34 closed potholes 3× slower than Ward 40
   this year." The hook is generated from the data and changes as the data
   changes.
2. **Rank with receipts.** Every ward's position is backed by the actual
   requests behind it — real request text, real dates, real durations. A score
   with no visible source is a rumor. Any number on the page should be one
   click from the rows that produced it.
3. **Methodology in view, not in a footer.** How we define "closed," what we do
   with reopened and duplicate requests, which types are excluded and why. In
   the page, at the point of the claim. Being visibly honest about limits is
   what earns the right to make the comparison at all.
4. **Plain language over official language,** with the official term available.
   Show "graffiti removal," keep "Graffiti Removal Request" one hover away, so
   anyone checking our work can match it against the source.
5. **Comparison is the product.** A single ward's number means little. Rank,
   spread, and the fastest/slowest gap are the substance.

## Visual direction

Prior art in this space (chispections and similar) is all-dark terminal mono.
That's a *reference for attitude, not a template* — the attitude is right, the
execution is a ceiling we should clear.

- Lighter, more legible visual system. Real typographic hierarchy rather than
  one monospace weight doing every job.
- Monospace stays, but as an accent for data — figures, durations, IDs — not as
  body text.
- Density is fine; illegibility is not. This is a table-forward product and the
  tables should be genuinely pleasant to read.
- Light and dark both work properly. Not a dark-mode gimmick.

## Open questions (blocked on step 0)

- Does the leaderboard premise survive contact with the data — is per-ward
  spread on the top actionable request types large enough to be interesting,
  and stable rather than noise?
- Is ward coverage complete enough to rank all 50, or do we scope to the wards
  with adequate volume?
- Which request type carries the front page? It needs volume, ward coverage,
  and a duration that varies meaningfully.

Once `tools/spike-311.mjs` reports, fold its verdict in here and cut whatever
this brief assumed that turned out to be false.
