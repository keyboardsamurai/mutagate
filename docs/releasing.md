# Releasing

A release starts when the maintainer pushes a `vX.Y.Z` tag by hand. `.github/workflows/release.yml` does the rest: it tests the tag, builds the package with `test/package.mjs`, force-pushes it as the orphan `skill` branch with the tag `skill-vX.Y.Z` ([ADR-0014](adr/0014-skill-branch-distribution.md)), installs from that tag, and creates the GitHub Release with `mutagate-vX.Y.Z.tgz`, `SHA256SUMS`, a build provenance attestation and the `CHANGELOG.md` section as notes. `0.x` releases are marked prerelease. Tags are not signed before 1.0; the attestation is the integrity record.

Never commit to the `skill` branch or create `skill-v*` tags by hand.

## Routine release

```sh
OLD=0.9.0 V=0.9.1
# 1. Bump the version.
npm pkg set version=$V
sed -i.bak -E "s/^export const VERSION = '[^']+';/export const VERSION = '$V';/" scripts/mutagate.mjs && rm scripts/mutagate.mjs.bak
# The SessionStart golden payloads carry the version too.
sed -i.bak -E "s/mutagate [0-9][^ ]* active/mutagate $V active/" test/payloads/*/SessionStart.expected.json && rm test/payloads/*/SessionStart.expected.json.bak
sed -i.bak -E "s/(mutagate |skill-v)$OLD/\1$V/g" README.md && rm README.md.bak   # OLD = previous version
# 2. Regenerate the generated files.
npm run generate:runtime
npm run generate:hooks
# 3. Test. Add `npm run test:integration` when runners changed.
npm test
npm run test:installer
npm run test:performance
node test/package.mjs "$(mktemp -d)/pkg"          # prints bytes; fails at >= 300 KB
# 4. CHANGELOG.md: move the Unreleased entries under "## [$V] - <YYYY-MM-DD>" and update the compare links.
# 5. Commit, tag, push.
git commit -am "mutagate $V"
git push origin main
git tag v$V -m v$V
git push origin v$V
```

Then verify:

```sh
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')"
git ls-remote origin refs/heads/skill refs/tags/skill-v$V
gh release view v$V
t=$(mktemp -d) && gh release download v$V --repo keyboardsamurai/mutagate -D "$t" \
  && (cd "$t" && shasum -a 256 -c SHA256SUMS) && gh attestation verify "$t/mutagate-v$V.tgz" --repo keyboardsamurai/mutagate
d=$(mktemp -d) && cd "$d" && git init -q && DISABLE_TELEMETRY=1 npx --yes skills@1.5.26 add keyboardsamurai/mutagate#skill-v$V -a claude-code --copy -y \
  && .claude/skills/mutagate/scripts/mutagate --version          # prints: mutagate $V
```

If `verify` fails, nothing is published: fix on `main` and release the next patch version. Do not reuse the tag: the "release tags" ruleset blocks deletion of `v*` tags. If `publish` fails after the branch push, re-run the failed job; the skill commit is reproducible.

## First public release (one-time)

Do these steps once, in order, for 0.9.0. Each command is for the maintainer; none of it runs in CI.

### 1. Pre-flight on the private repo

Every release-prep change is committed, `npm test` passes, and these print nothing:

```sh
git ls-files | grep -E '^\.(claude|mcp|ignore|DS_Store)'
git grep -n -e '/Users/[t]ag'
grep -oE '(src|href)="docs/[^"]+"' README.md | cut -d'"' -f2 | xargs git ls-files --error-unmatch >/dev/null
```

`.claude/plans/` is untracked; it is not in the public history.

### 2. Mirror backup, then squash to one commit

```sh
git clone --mirror . ../mutagate-private-history.git
gh api users/keyboardsamurai --jq .id                      # 67417
git config user.name 'Antonio Agudo'
git config user.email '67417+keyboardsamurai@users.noreply.github.com'
git checkout --orphan public
git add -A
git commit -m 'mutagate 0.9.0'
git branch -M public main
git reflog expire --expire=now --all && git gc --prune=now
```

Accept when all of these hold:

```sh
git count-objects -vH                         # size-pack under 15 MB
git log -p | grep -c '/Users/[t]ag'           # 0
git log --format='%an <%ae>' | sort -u        # only the noreply address
git rev-list --count HEAD                     # 1
```

Keep `../mutagate-private-history.git` offline; never push it.

### 3. Secret scan

```sh
gitleaks detect --source . --redact --report-path ../mutagate-0.9.0-gitleaks.json
```

Accept when it reports `no leaks found`. Keep the report as release evidence (not in the repo).

### 4. Create the repo and push `main`

```sh
gh repo create keyboardsamurai/mutagate --public --source . --remote origin \
  --description 'Mutation testing as a hook: blocks coding agents until their tests catch the bugs'
git push -u origin main
```

Wait for `ci` on `main` to pass before tagging.

### 5. Repo settings

```sh
R=keyboardsamurai/mutagate
gh repo edit $R --enable-discussions --enable-wiki=false \
  --add-topic mutation-testing,agent-skills,claude-code,codex,pitest,stryker,mutmut,quality-gate
gh api -X PUT repos/$R/private-vulnerability-reporting
for l in false-block runner-request; do gh label create $l --repo $R; done
```

Rulesets: no protection on `main`. `v*` tags are created by hand but never moved or deleted. The `skill` branch and `skill-v*` tags have no ruleset: on a personal-account repo GitHub refuses the GitHub Actions app as a bypass actor, and only the owner has write access. `release.yml` is the only writer by convention.

```sh
gh api -X POST repos/$R/rulesets --input - <<'EOF'
{"name":"release tags","target":"tag","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
 "rules":[{"type":"update"},{"type":"deletion"}],"bypass_actors":[]}
EOF
gh api repos/$R/rulesets --jq '.[].name'
```

By hand in Settings → General → Social preview: upload a 1280×640 PNG (made from `docs/img/mutagate_banner.png`).

### 6. Reserve the npm name

Publish a 0.0.0 placeholder from a temp dir. Never publish from the repo, and never remove `"private": true` from the dev `package.json`.

```sh
npm view mutagate                          # expect E404 before the first publish
d=$(mktemp -d) && cd "$d"
cat > package.json <<'EOF'
{"name":"mutagate","version":"0.0.0","description":"Name reserved. Install the skill: npx skills add keyboardsamurai/mutagate#skill","license":"MIT","repository":"github:keyboardsamurai/mutagate"}
EOF
printf '# mutagate\n\nName reserved. See https://github.com/keyboardsamurai/mutagate\n' > README.md
npm publish --access public
cd - && rm -rf "$d"
```

### 7. Move the red-test ticket into an issue

```sh
gh issue create --repo keyboardsamurai/mutagate --title 'One red test file errors every import-linked python target' \
  --body-file docs/red_test_cascade_ticket.md --label bug
gh issue close <number> --reason completed --comment 'Fixed in 0.9.0 (candidates 1-3).'
git rm docs/red_test_cascade_ticket.md
# Replace the path in test/review-fixes.md with the issue URL, then:
git grep -n red_test_cascade                # prints nothing
git commit -am 'Move the red-test cascade ticket to an issue' && git push
```

### 8. Tag and verify v0.9.0

```sh
git tag v0.9.0 -m v0.9.0
git push origin v0.9.0
```

Then run the checks in "Routine release" with `V=0.9.0`. Also confirm the `skill` branch holds only `SKILL.md`, `README.md`, `LICENSE`, `scripts/` and `references/`:

```sh
git fetch origin skill && git ls-tree --name-only origin/skill
```

Stranger smoke test: on a clean VM, follow the README Quick start verbatim for Claude Code and Codex. Reach the first block in 5 min or less (C# 10 min or less).

### 9. Soft launch

No Show HN for 0.9.0; it waits for 1.0.

- Day 0: pull requests to [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) and [ithiria894/awesome-claude-code-hooks](https://github.com/ithiria894/awesome-claude-code-hooks). skills.sh lists the repo from install telemetry; check <https://skills.sh> after the first installs.
- Day 1: pull request to [theofidry/awesome-mutation-testing](https://github.com/theofidry/awesome-mutation-testing). Courtesy notes to the PIT, Stryker, mutmut and gomutants maintainers.
- Day 14 or later: the [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) web form.
- Open a pinned Discussion for weekly metrics (stars, skills.sh installs, issue mix). mutagate has no telemetry of its own.

## 1.0 gate

Release 1.0 only when all of these hold:

- 30 days without a P0 issue.
- 50 or more installs outside the maintainer (skills.sh count).
- False-block issues are under 25% of all issues.

The Claude Code plugin is not on the 1.0 path.

## Before 1.0

- **SSH tag signing.** `git config gpg.format ssh && git config user.signingkey ~/.ssh/id_ed25519.pub`, add the key as a signing key on GitHub, then tag with `git tag -s`. Update this doc.
- **Stale-install warning (0.9.1).** `install` writes `scripts/.installed`; SessionStart and `doctor` warn on a mismatch.
- **`.cjs`-only package.** Ship `mutagate-hook.cjs` once, hash it in `fingerprint`, and drop `mutagate.mjs` from the package.
- **Evidence enforcement.** `test/eval.test.mjs` fails a release version whose ✅ cells have a stale package digest or harness pin. Run the full sweep first: `npm run eval -- --repeat 2`.
