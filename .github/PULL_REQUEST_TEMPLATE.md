## What and why

<!-- One or two sentences. Link the issue. -->

## Checklist

- [ ] `npm test` passes.
- [ ] I changed `scripts/mutagate.mjs` → I ran `npm run generate:runtime` (and `npm run generate:hooks` for hook wiring). I did not edit `scripts/mutagate-hook.cjs` by hand.
- [ ] Runner change → `npm run test:integration` for the affected fixtures (`MUTAGATE_FIXTURES=…`).
- [ ] Hook path change → `npm run test:performance` (p95 ≤ 80 ms).
- [ ] The package stays under 300 KB (`node test/package.mjs /tmp/mg-pkg`).
- [ ] A new decision has an ADR in `docs/adr/`; user-facing behavior is in `README.md`; `CHANGELOG.md` has an entry under Unreleased.
- [ ] No README ✅ changed without evidence records in `test/evidence/live/`.
