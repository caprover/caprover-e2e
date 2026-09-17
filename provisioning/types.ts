export interface ProvisioningState {
    dropletId?: number
    ipAddress?: string
    dnsRecordId?: string
    rootDomain?: string
    caproverUrl?: string
}

export interface ProvisionedEnvironment {
    state: ProvisioningState
    testEnvironment: NodeJS.ProcessEnv
}
