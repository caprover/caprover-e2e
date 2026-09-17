import { appendFile } from 'node:fs/promises'

export async function exportGitHubEnvironment(
    environment: NodeJS.ProcessEnv
): Promise<void> {
    const githubEnv = process.env.GITHUB_ENV
    if (!githubEnv) return

    const content = Object.entries(environment)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(
            ([key, value]) =>
                `${key}<<CAPROVER_E2E_EOF\n${value}\nCAPROVER_E2E_EOF`
        )
        .join('\n')

    await appendFile(githubEnv, `${content}\n`)
}
