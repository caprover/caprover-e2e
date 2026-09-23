import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { loadConfig } from '../src/config'
import { createTestContext, type TestContext } from '../src/context'
import { withImmediateFailureDiagnostics } from '../src/diagnostics'
import { withCleanup } from '../src/helpers/cleanup'
import {
    nextVersion,
    waitForDeployment,
    waitForImage,
    waitForServiceStable,
} from '../src/helpers/deployment'
import { createTestNames } from '../src/helpers/names'
import { cleanUpApp } from '../src/helpers/test-context'
import { requireEphemeral } from '../src/test-selection'

// The dedicated private fixture repo contains this one-line captain-definition.
const FIXTURE_IMAGE =
    'nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de'

interface GitFixture {
    httpsRepo: string
    sshRepo: string
    branch: string
    user: string
    password: string
    sshKey: string
    commit: string
}

test('private Git credentials, branch filtering, token rotation, and disabling webhooks', async () => {
    requireEphemeral()
    const fixture = loadGitFixture()
    const config = loadConfig()
    const context = createTestContext(config)
    const { initialAppName: originalName, renamedAppName: renamedName } =
        createTestNames()

    try {
        await context.caprover.login()
        await context.ssh.connect()
        await context.docker.validateEnvironment()
        const { rootDomain } = await context.caprover.getApps()

        await withImmediateFailureDiagnostics(context.ssh, config, () =>
            withCleanup(async (cleanup) => {
                cleanUpApp(context, cleanup, originalName)
                cleanUpApp(context, cleanup, renamedName)
                await context.caprover.createApp(originalName)
                await waitForServiceStable(context, originalName)

                await context.caprover.patchApp(originalName, {
                    appPushWebhook: {
                        repoInfo: {
                            repo: fixture.httpsRepo,
                            branch: fixture.branch,
                            user: fixture.user,
                            password: fixture.password,
                        },
                    },
                })
                const httpsToken = await assertRepository(
                    context,
                    originalName,
                    fixture.httpsRepo,
                    fixture.branch,
                    fixture.password,
                    ''
                )

                // CapRover acknowledges all recognized webhook events before its
                // asynchronous branch filter and build have finished.
                const initialVersion = (
                    await context.caprover.getApp(originalName)
                ).deployedVersion
                expect(
                    await postPush(config.caproverUrl, httpsToken, 'untracked')
                ).toBe(100)
                await assertNoBuild(context, originalName, initialVersion)

                expect(
                    await postPush(
                        config.caproverUrl,
                        `${httpsToken}invalid`,
                        fixture.branch
                    )
                ).toBe(1000)
                await assertNoBuild(context, originalName, initialVersion)

                await triggerAndVerify(
                    context,
                    config.caproverUrl,
                    originalName,
                    httpsToken,
                    fixture,
                    rootDomain
                )

                await context.caprover.patchApp(originalName, {
                    appPushWebhook: {
                        repoInfo: {
                            repo: fixture.sshRepo,
                            branch: fixture.branch,
                            user: '',
                            password: '',
                            sshKey: fixture.sshKey,
                        },
                    },
                })
                const sshToken = await assertRepository(
                    context,
                    originalName,
                    fixture.sshRepo,
                    fixture.branch,
                    '',
                    fixture.sshKey
                )
                expect(sshToken === httpsToken).toBe(true) // Credential changes do not rotate the token.
                await triggerAndVerify(
                    context,
                    config.caproverUrl,
                    originalName,
                    sshToken,
                    fixture,
                    rootDomain
                )

                await context.caprover.renameApp(originalName, renamedName)
                await waitForServiceStable(context, renamedName)
                const renamedToken = await assertRepository(
                    context,
                    renamedName,
                    fixture.sshRepo,
                    fixture.branch,
                    '',
                    fixture.sshKey
                )
                expect(renamedToken === sshToken).toBe(false)
                const renamedVersion = (
                    await context.caprover.getApp(renamedName)
                ).deployedVersion
                expect(
                    await postPush(config.caproverUrl, sshToken, fixture.branch)
                ).toBe(1000)
                await assertNoBuild(context, renamedName, renamedVersion)
                await triggerAndVerify(
                    context,
                    config.caproverUrl,
                    renamedName,
                    renamedToken,
                    fixture,
                    rootDomain
                )

                await context.caprover.patchApp(renamedName, {
                    appPushWebhook: {},
                })
                expect(
                    (await context.caprover.getApp(renamedName)).appPushWebhook
                ).toBeUndefined()
                const lastVersion = (await context.caprover.getApp(renamedName))
                    .deployedVersion
                // Current backend sends status 100, then catches the missing
                // repoInfo in the background. Disabling means no new build.
                expect(
                    await postPush(
                        config.caproverUrl,
                        renamedToken,
                        fixture.branch
                    )
                ).toBe(100)
                await assertNoBuild(context, renamedName, lastVersion)
            })
        )
    } finally {
        context.caprover.destroy()
        context.ssh.close()
    }
}, 420_000)

function loadGitFixture(environment = process.env): GitFixture {
    const names = [
        'E2E_GIT_HTTPS_REPO',
        'E2E_GIT_SSH_REPO',
        'E2E_GIT_BRANCH',
        'E2E_GIT_HTTP_USER',
        'E2E_GIT_HTTP_PASSWORD',
        'E2E_GIT_SSH_PRIVATE_KEY',
        'E2E_GIT_EXPECTED_COMMIT',
    ] as const
    for (const name of names) {
        if (!environment[name]?.trim())
            throw new Error(`Missing required Git fixture setting: ${name}`)
    }

    const fixture: GitFixture = {
        httpsRepo: environment.E2E_GIT_HTTPS_REPO!.trim(),
        sshRepo: environment.E2E_GIT_SSH_REPO!.trim(),
        branch: environment.E2E_GIT_BRANCH!.trim(),
        user: environment.E2E_GIT_HTTP_USER!.trim(),
        password: environment.E2E_GIT_HTTP_PASSWORD!,
        sshKey: environment.E2E_GIT_SSH_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        commit: environment.E2E_GIT_EXPECTED_COMMIT!.trim().toLowerCase(),
    }
    const https = /^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/.exec(
        fixture.httpsRepo
    )
    const ssh = /^git@github\.com:([^/]+\/[^/]+)\.git$/.exec(fixture.sshRepo)
    if (!https || !ssh || https[1] !== ssh[1]) {
        throw new Error(
            'Git fixture URLs must refer to the same GitHub repository'
        )
    }
    if (
        !/^[a-zA-Z0-9._/-]+$/.test(fixture.branch) ||
        fixture.branch.startsWith('refs/')
    ) {
        throw new Error(
            'E2E_GIT_BRANCH must be a branch name, without refs/heads/'
        )
    }
    if (!/^[a-f0-9]{40}$/.test(fixture.commit)) {
        throw new Error(
            'E2E_GIT_EXPECTED_COMMIT must be a 40-character Git commit SHA'
        )
    }
    return fixture
}

async function assertRepository(
    context: TestContext,
    name: string,
    repo: string,
    branch: string,
    password: string,
    sshKey: string
): Promise<string> {
    const webhook = (await context.caprover.getApp(name)).appPushWebhook
    expect(webhook?.repoInfo.repo === repo).toBe(true)
    expect(webhook?.repoInfo.branch === branch).toBe(true)
    // The current authenticated-admin API returns decrypted Git credentials.
    // Compare only booleans so a failed assertion never prints the secrets.
    expect(webhook?.repoInfo.password === password).toBe(true)
    expect((webhook?.repoInfo.sshKey?.trim() ?? '') === sshKey.trim()).toBe(
        true
    )
    const token = webhook?.pushWebhookToken
    expect(typeof token === 'string' && token.length > 0).toBe(true)
    if (!token) throw new Error('Git webhook token was not generated')
    return token
}

async function triggerAndVerify(
    context: TestContext,
    baseUrl: string,
    name: string,
    token: string,
    fixture: GitFixture,
    rootDomain: string
): Promise<void> {
    const before = await context.caprover.getApp(name)
    const version = nextVersion(before)
    expect(await postPush(baseUrl, token, fixture.branch)).toBe(100)
    const deployed = await waitForDeployment(context, name, version)
    expect(deployed.deployedVersion).toBe(before.deployedVersion + 1)
    expect(
        deployed.versions
            .find((entry) => entry.version === version)
            ?.gitHash?.trim()
            .toLowerCase()
    ).toBe(fixture.commit)
    await waitForImage(context, name, FIXTURE_IMAGE)
    await context.http.waitUntilReachable(
        `http://${name}.${rootDomain}`,
        'Welcome to nginx!'
    )
}

async function postPush(
    baseUrl: string,
    token: string,
    branch: string
): Promise<number> {
    const url = new URL('/api/v2/user/apps/webhooks/triggerbuild', baseUrl)
    url.searchParams.set('namespace', 'captain')
    url.searchParams.set('token', token)
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Event': 'push',
        },
        body: JSON.stringify({ ref: `refs/heads/${branch}` }),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
    })
    if (!response.ok)
        throw new Error(`Git webhook returned HTTP ${response.status}`)
    const envelope = (await response.json()) as { status: number }
    return envelope.status
}

async function assertNoBuild(
    context: TestContext,
    name: string,
    version: number
): Promise<void> {
    // The webhook response precedes the branch check. Sample across the
    // scheduling window and assert that no version was added or started.
    const deadline = Date.now() + 7_000
    while (Date.now() < deadline) {
        const app = await context.caprover.getApp(name)
        expect(app.deployedVersion).toBe(version)
        expect(app.isAppBuilding).toBe(false)
        expect((await context.caprover.getBuildLogs(name)).isAppBuilding).toBe(
            false
        )
        await delay(700)
    }
    expect((await context.caprover.getApp(name)).deployedVersion).toBe(version)
}
