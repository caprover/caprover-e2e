import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
if (!process.env.CI && existsSync('.env')) process.loadEnvFile('.env')

const required = [
    'DIGITALOCEAN_TOKEN',
    'DIGITALOCEAN_SSH_KEY_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ZONE_ID',
    'E2E_BASE_DOMAIN',
    'CAPROVER_E2E_SSH_PRIVATE_KEY',
    'E2E_GIT_HTTPS_REPO',
    'E2E_GIT_SSH_REPO',
    'E2E_GIT_BRANCH',
    'E2E_GIT_HTTP_USER',
    'E2E_GIT_HTTP_PASSWORD',
    'E2E_GIT_SSH_PRIVATE_KEY',
    'E2E_GIT_EXPECTED_COMMIT',
]

for (const key of required) {
    if (!process.env[key]?.trim()) {
        console.error(`Missing prerequisite: ${key}`)
        process.exitCode = 1
    }
}
if (process.exitCode) process.exit()

const httpsRepo = process.env.E2E_GIT_HTTPS_REPO.trim()
const sshRepo = process.env.E2E_GIT_SSH_REPO.trim()
const branch = process.env.E2E_GIT_BRANCH.trim()
const expected = process.env.E2E_GIT_EXPECTED_COMMIT.trim().toLowerCase()
const https = /^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/.exec(httpsRepo)
const ssh = /^git@github\.com:([^/]+\/[^/]+)\.git$/.exec(sshRepo)
if (!https || !ssh || https[1] !== ssh[1]) {
    throw new Error('Git fixture URLs must name the same GitHub repository')
}
if (!/^[a-zA-Z0-9._/-]+$/.test(branch) || branch.startsWith('refs/')) {
    throw new Error('E2E_GIT_BRANCH must be a branch name')
}
if (!/^[a-f0-9]{40}$/.test(expected)) {
    throw new Error('E2E_GIT_EXPECTED_COMMIT must be a full commit SHA')
}

const directory = await mkdtemp(join(tmpdir(), 'caprover-e2e-git-'))
try {
    const askpass = join(directory, 'askpass.sh')
    const keyPath = join(directory, 'deploy-key')
    const knownHosts = join(directory, 'known-hosts')
    await writeFile(
        askpass,
        '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "$E2E_GIT_HTTP_USER" ;;\n  *Password*) printf "%s\\n" "$E2E_GIT_HTTP_PASSWORD" ;;\nesac\n',
        { mode: 0o700 }
    )
    await writeFile(
        keyPath,
        `${process.env.E2E_GIT_SSH_PRIVATE_KEY.replace(/\\n/g, '\n').trim()}\n`,
        { mode: 0o600 }
    )

    const anonymous = await gitSucceeds(
        [
            '-c',
            'credential.helper=',
            'ls-remote',
            httpsRepo,
            `refs/heads/${branch}`,
        ],
        { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' }
    )
    if (anonymous) {
        throw new Error(
            'Git fixture must be private so authentication is tested'
        )
    }

    const httpsEnv = {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: askpass,
    }
    const httpsCommit = await gitCommit(
        [
            '-c',
            'credential.helper=',
            'ls-remote',
            httpsRepo,
            `refs/heads/${branch}`,
        ],
        httpsEnv,
        'HTTPS fixture authentication'
    )
    const sshCommit = await gitCommit(
        ['ls-remote', sshRepo, `refs/heads/${branch}`],
        {
            GIT_TERMINAL_PROMPT: '0',
            GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${knownHosts}`,
        },
        'SSH fixture authentication'
    )
    if (httpsCommit !== expected || sshCommit !== expected) {
        throw new Error(
            'Fixture branch does not point at E2E_GIT_EXPECTED_COMMIT'
        )
    }

    await runGit(
        [
            '-c',
            'credential.helper=',
            'clone',
            '--quiet',
            '--depth',
            '1',
            '--branch',
            branch,
            httpsRepo,
            join(directory, 'repo'),
        ],
        httpsEnv,
        'cloning the HTTPS fixture'
    )
    const [actual, committed] = await Promise.all([
        readFile(join(directory, 'repo', 'captain-definition'), 'utf8'),
        readFile('tests/fixtures/git-webhook-repo/captain-definition', 'utf8'),
    ])
    if (actual !== committed) {
        throw new Error(
            'Fixture captain-definition differs from the checked-in file'
        )
    }
    console.log('Private Git fixture and both authentication methods verified.')
} finally {
    await rm(directory, { recursive: true, force: true })
}

async function gitSucceeds(args, extraEnv) {
    try {
        await runGit(args, extraEnv, 'checking private fixture')
        return true
    } catch {
        return false
    }
}

async function gitCommit(args, extraEnv, description) {
    const { stdout } = await runGit(args, extraEnv, description)
    const commit = stdout.trim().split(/\s+/)[0]?.toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(commit ?? '')) {
        throw new Error(`${description} did not find the fixture branch`)
    }
    return commit
}

async function runGit(args, extraEnv, description) {
    try {
        return await execFile('git', args, {
            env: { ...process.env, ...extraEnv },
            timeout: 30_000,
            maxBuffer: 64_000,
        })
    } catch {
        // Git clone errors can include an authenticated remote or key path.
        throw new Error(
            `${description} failed; check fixture access and branch`
        )
    }
}
