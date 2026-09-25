export interface ProvisioningState {
    dropletName?: string
    dropletId?: number
    ipAddress?: string
    dnsRecordName?: string
    dnsRecordId?: string
    rootDomain?: string
    caproverUrl?: string
    workerDropletName?: string
    workerDropletId?: number
    workerIpAddress?: string
}

export interface ProvisionedEnvironment {
    state: ProvisioningState
    testEnvironment: NodeJS.ProcessEnv
}
