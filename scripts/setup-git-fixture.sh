#!/usr/bin/env bash

set -Eeuo pipefail

TARGET_REPO="caprover/caprover-e2e"
FIXTURE_REPO=""
BRANCH="main"
USE_GH_TOKEN=false
DEPLOY_KEY_TITLE="CapRover E2E fixture"

usage() {
    cat <<'EOF'
Create the private Git fixture used by tests/git-webhooks.test.ts and set its
seven Actions secrets.

Usage:
  scripts/setup-git-fixture.sh [options]

Options:
  --target-repo OWNER/REPO   Repository that receives the Actions secrets
                             (default: caprover/caprover-e2e)
  --fixture-repo OWNER/REPO  Private fixture repository to create or update
                             (default: <authenticated-user>/caprover-e2e-git-fixture)
  --branch NAME              Fixture branch (default: main)
  --use-gh-token             Use `gh auth token` for HTTPS cloning. This may
                             grant broader access than a fixture-only token.
  -h, --help                 Show this help

By default, the script reads a fine-grained token from
CAPROVER_E2E_GIT_HTTP_TOKEN or prompts for it without echoing. Give that token
read-only Contents access to the fixture repository.
EOF
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

while (($#)); do
    case "$1" in
        --target-repo)
            (($# >= 2)) || die '--target-repo requires a value'
            TARGET_REPO=$2
            shift 2
            ;;
        --fixture-repo)
            (($# >= 2)) || die '--fixture-repo requires a value'
            FIXTURE_REPO=$2
            shift 2
            ;;
        --branch)
            (($# >= 2)) || die '--branch requires a value'
            BRANCH=$2
            shift 2
            ;;
        --use-gh-token)
            USE_GH_TOKEN=true
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *) die "unknown option: $1" ;;
    esac
done

for command_name in gh git ssh ssh-keygen; do
    command -v "$command_name" >/dev/null 2>&1 ||
        die "required command not found: $command_name"
done

gh auth status --hostname github.com >/dev/null 2>&1 ||
    die 'authenticate GitHub CLI first: gh auth login'

GITHUB_LOGIN=$(gh api user --jq .login)
[[ -n "$FIXTURE_REPO" ]] ||
    FIXTURE_REPO="$GITHUB_LOGIN/caprover-e2e-git-fixture"

repo_pattern='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
[[ "$TARGET_REPO" =~ $repo_pattern ]] ||
    die "invalid target repository: $TARGET_REPO"
[[ "$FIXTURE_REPO" =~ $repo_pattern ]] ||
    die "invalid fixture repository: $FIXTURE_REPO"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ && "$BRANCH" != refs/* ]] ||
    die "invalid branch name: $BRANCH"

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
FIXTURE_FILE="$ROOT_DIR/tests/fixtures/git-webhook-repo/captain-definition"
[[ -f "$FIXTURE_FILE" ]] || die "fixture file not found: $FIXTURE_FILE"

gh repo view "$TARGET_REPO" >/dev/null 2>&1 ||
    die "cannot access target repository: $TARGET_REPO"
gh api "repos/$TARGET_REPO/actions/secrets/public-key" >/dev/null 2>&1 ||
    die "cannot administer Actions secrets in target repository: $TARGET_REPO"

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/caprover-e2e-git-fixture.XXXXXX")
cleanup() {
    rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

if gh repo view "$FIXTURE_REPO" >/dev/null 2>&1; then
    VISIBILITY=$(gh repo view "$FIXTURE_REPO" --json visibility --jq .visibility)
    [[ "$VISIBILITY" == PRIVATE ]] ||
        die "fixture repository exists but is not private: $FIXTURE_REPO"
    printf 'Updating private fixture repository %s\n' "$FIXTURE_REPO"
else
    printf 'Creating private fixture repository %s\n' "$FIXTURE_REPO"
    gh repo create "$FIXTURE_REPO" \
        --private \
        --disable-issues \
        --disable-wiki \
        --description 'Private authenticated Git fixture for CapRover E2E tests'
fi

gh repo clone "$FIXTURE_REPO" "$WORK_DIR/repository" -- --quiet

if git -C "$WORK_DIR/repository" show-ref --verify --quiet \
    "refs/heads/$BRANCH"; then
    git -C "$WORK_DIR/repository" switch --quiet "$BRANCH"
elif git -C "$WORK_DIR/repository" show-ref --verify --quiet \
    "refs/remotes/origin/$BRANCH"; then
    git -C "$WORK_DIR/repository" switch --quiet --track \
        "origin/$BRANCH"
else
    git -C "$WORK_DIR/repository" switch --quiet --orphan "$BRANCH"
fi

cp -- "$FIXTURE_FILE" "$WORK_DIR/repository/captain-definition"
git -C "$WORK_DIR/repository" add captain-definition
if ! git -C "$WORK_DIR/repository" diff --cached --quiet; then
    git -C "$WORK_DIR/repository" \
        -c user.name='CapRover E2E Fixture' \
        -c user.email='caprover-e2e@users.noreply.github.com' \
        commit --quiet -m 'Update CapRover E2E Git fixture'
fi

git -C "$WORK_DIR/repository" rev-parse --verify HEAD >/dev/null 2>&1 ||
    die 'fixture branch has no commit'
git -C "$WORK_DIR/repository" push --quiet --set-upstream origin "$BRANCH"
EXPECTED_COMMIT=$(git -C "$WORK_DIR/repository" rev-parse HEAD)

if [[ -n "${CAPROVER_E2E_GIT_HTTP_TOKEN:-}" ]]; then
    HTTP_TOKEN=$CAPROVER_E2E_GIT_HTTP_TOKEN
elif [[ "$USE_GH_TOKEN" == true ]]; then
    HTTP_TOKEN=$(gh auth token)
else
    [[ -t 0 ]] ||
        die 'set CAPROVER_E2E_GIT_HTTP_TOKEN or pass --use-gh-token'
    printf '%s\n' \
        'Create a fine-grained GitHub token with read-only Contents access' \
        "to $FIXTURE_REPO. GitHub cannot create this token through its API:" \
        'https://github.com/settings/personal-access-tokens/new' >&2
    read -r -s -p 'Fine-grained token: ' HTTP_TOKEN
    printf '\n' >&2
fi
[[ -n "$HTTP_TOKEN" ]] || die 'the HTTPS token cannot be empty'

HTTPS_REPO="https://github.com/$FIXTURE_REPO.git"
SSH_REPO="git@github.com:$FIXTURE_REPO.git"
ASKPASS_FILE="$WORK_DIR/askpass.sh"
cat >"$ASKPASS_FILE" <<'EOF'
#!/bin/sh
case "$1" in
    *Username*) printf '%s\n' "$E2E_GIT_HTTP_USER" ;;
    *Password*) printf '%s\n' "$E2E_GIT_HTTP_PASSWORD" ;;
esac
EOF
chmod 700 "$ASKPASS_FILE"

if GIT_TERMINAL_PROMPT=0 GIT_ASKPASS= \
    git -c credential.helper= ls-remote "$HTTPS_REPO" >/dev/null 2>&1; then
    die 'fixture repository is anonymously readable'
fi

HTTP_COMMIT=$(
    E2E_GIT_HTTP_USER="$GITHUB_LOGIN" \
        E2E_GIT_HTTP_PASSWORD="$HTTP_TOKEN" \
        GIT_TERMINAL_PROMPT=0 \
        GIT_ASKPASS="$ASKPASS_FILE" \
        git -c credential.helper= ls-remote \
        "$HTTPS_REPO" "refs/heads/$BRANCH" | awk '{print $1}'
)
[[ "$HTTP_COMMIT" == "$EXPECTED_COMMIT" ]] ||
    die 'HTTPS authentication did not resolve the expected fixture commit'

OLD_DEPLOY_KEY_IDS=$(
    gh api "repos/$FIXTURE_REPO/keys" \
        --jq ".[] | select(.title == \"$DEPLOY_KEY_TITLE\") | .id"
)

KEY_FILE="$WORK_DIR/deploy-key"
ssh-keygen -q -t ed25519 -N '' -C 'caprover-e2e-git-fixture' -f "$KEY_FILE"

gh api --method POST "repos/$FIXTURE_REPO/keys" \
    -f "title=$DEPLOY_KEY_TITLE" \
    -f "key=$(<"$KEY_FILE.pub")" \
    -F read_only=true >/dev/null

SSH_COMMIT=$(
    GIT_TERMINAL_PROMPT=0 \
        GIT_SSH_COMMAND="ssh -i $KEY_FILE -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$WORK_DIR/known-hosts" \
        git ls-remote "$SSH_REPO" "refs/heads/$BRANCH" | awk '{print $1}'
)
[[ "$SSH_COMMIT" == "$EXPECTED_COMMIT" ]] ||
    die 'SSH authentication did not resolve the expected fixture commit'

set_secret() {
    local name=$1
    local value=$2
    printf '%s' "$value" | gh secret set "$name" --repo "$TARGET_REPO"
}

printf 'Setting seven Actions secrets in %s\n' "$TARGET_REPO"
set_secret E2E_GIT_HTTPS_REPO "$HTTPS_REPO"
set_secret E2E_GIT_SSH_REPO "$SSH_REPO"
set_secret E2E_GIT_BRANCH "$BRANCH"
set_secret E2E_GIT_HTTP_USER "$GITHUB_LOGIN"
set_secret E2E_GIT_HTTP_PASSWORD "$HTTP_TOKEN"
gh secret set E2E_GIT_SSH_PRIVATE_KEY --repo "$TARGET_REPO" <"$KEY_FILE"
set_secret E2E_GIT_EXPECTED_COMMIT "$EXPECTED_COMMIT"

SECRET_NAMES=$(gh secret list --repo "$TARGET_REPO" --json name --jq '.[].name')
for secret_name in \
    E2E_GIT_HTTPS_REPO \
    E2E_GIT_SSH_REPO \
    E2E_GIT_BRANCH \
    E2E_GIT_HTTP_USER \
    E2E_GIT_HTTP_PASSWORD \
    E2E_GIT_SSH_PRIVATE_KEY \
    E2E_GIT_EXPECTED_COMMIT; do
    grep -Fxq "$secret_name" <<<"$SECRET_NAMES" ||
        die "Actions secret was not found after setting it: $secret_name"
done

while IFS= read -r key_id; do
    [[ -n "$key_id" ]] || continue
    gh api --method DELETE "repos/$FIXTURE_REPO/keys/$key_id"
done <<<"$OLD_DEPLOY_KEY_IDS"

unset HTTP_TOKEN CAPROVER_E2E_GIT_HTTP_TOKEN
printf '\nFixture setup complete.\n'
printf 'Repository: https://github.com/%s\n' "$FIXTURE_REPO"
printf 'Branch:     %s\n' "$BRANCH"
printf 'Commit:     %s\n' "$EXPECTED_COMMIT"
printf 'Secrets:    %s (all seven E2E_GIT_* values verified present)\n' \
    "$TARGET_REPO"
