import { CapRoverClient } from './clients/caprover'
import { HttpClient } from './clients/http'
import { SshClient } from './clients/ssh'
import { TestConfig } from './config'
import { DockerInspector } from './inspectors/docker'

export interface TestContext {
    caprover: CapRoverClient
    ssh: SshClient
    docker: DockerInspector
    http: HttpClient
}

export function createTestContext(config: TestConfig): TestContext {
    const ssh = new SshClient({
        host: config.sshHost,
        port: config.sshPort,
        username: config.sshUser,
        privateKey: config.sshPrivateKey,
    })

    return {
        caprover: new CapRoverClient(
            config.caproverUrl,
            config.caproverPassword
        ),
        ssh,
        docker: new DockerInspector(ssh),
        http: new HttpClient(),
    }
}
