import { CapRoverClient } from './clients/caprover.js'
import { HttpClient } from './clients/http.js'
import { SshClient } from './clients/ssh.js'
import { TestConfig } from './config.js'
import { DockerInspector } from './inspectors/docker.js'

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
