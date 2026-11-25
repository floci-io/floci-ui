import {ACCOUNT_HEADER} from '@/lib/accountStore'
import {CONSOLE_DEFAULT_REGION, REGION_HEADER} from '@/lib/regionStore'

/** The account and region a request was confirmed in; a null region is the console's default. */
export interface RequestScope {
    accountId: string
    region: string | null
}

/**
 * Headers that pin a request to the account and region it was confirmed in, whatever
 * is selected by the time it is sent: later steps of a multi-request operation use them.
 */
export function scopeHeaders(scope: RequestScope): Record<string, string> {
    return {
        [ACCOUNT_HEADER]: scope.accountId,
        [REGION_HEADER]: scope.region ?? CONSOLE_DEFAULT_REGION,
    }
}
