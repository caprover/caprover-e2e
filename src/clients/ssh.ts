import { Client, ConnectConfig } from 'ssh2'

export interface SshCommandResult {
    stdout: string
    stderr: string
    exitCode: number
}

export interface SshClientOptions {
    host: string
    port: number
    username: string
    privateKey: string
    connectTimeoutMs?: number
    commandTimeoutMs?: number
}

export class SshClient {
    private readonly client = new Client()
    private readonly connectTimeoutMs: number
    private readonly commandTimeoutMs: number
    private connected = false

    constructor(private readonly options: SshClientOptions) {
        this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000
        this.commandTimeoutMs = options.commandTimeoutMs ?? 15_000
        this.client.on('error', () => {
            this.connected = false
        })
        this.client.on('close', () => {
            this.connected = false
        })
    }

    connect(): Promise<void> {
        if (this.connected) {
            return Promise.resolve()
        }

        return new Promise((resolve, reject) => {
            const onReady = () => {
                cleanup()
                this.connected = true
                resolve()
            }
            const onError = (error: Error) => {
                cleanup()
                reject(error)
            }
            const cleanup = () => {
                this.client.off('ready', onReady)
                this.client.off('error', onError)
            }

            this.client.once('ready', onReady)
            this.client.once('error', onError)

            const config: ConnectConfig = {
                host: this.options.host,
                port: this.options.port,
                username: this.options.username,
                privateKey: this.options.privateKey,
                readyTimeout: this.connectTimeoutMs,
            }

            this.client.connect(config)
        })
    }

    exec(
        command: string,
        timeoutMs = this.commandTimeoutMs
    ): Promise<SshCommandResult> {
        if (!this.connected) {
            return Promise.reject(new Error('SSH client is not connected'))
        }

        return new Promise((resolve, reject) => {
            this.client.exec(command, (error, stream) => {
                if (error) {
                    reject(error)
                    return
                }

                let stdout = ''
                let stderr = ''
                let settled = false

                const finish = (result?: SshCommandResult, failure?: Error) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    if (failure) reject(failure)
                    else resolve(result!)
                }

                const timer = setTimeout(() => {
                    stream.close()
                    finish(
                        undefined,
                        new Error(`SSH command timed out after ${timeoutMs}ms`)
                    )
                }, timeoutMs)

                stream.setEncoding('utf8')
                stream.stderr.setEncoding('utf8')
                stream.on('data', (data: string) => {
                    stdout += data
                })
                stream.stderr.on('data', (data: string) => {
                    stderr += data
                })
                stream.once('error', (streamError: Error) => {
                    finish(undefined, streamError)
                })
                stream.once('close', (exitCode: number | undefined) => {
                    finish({
                        stdout,
                        stderr,
                        exitCode: exitCode ?? -1,
                    })
                })
            })
        })
    }

    close(): void {
        if (!this.connected) return
        this.connected = false
        this.client.end()
    }
}
