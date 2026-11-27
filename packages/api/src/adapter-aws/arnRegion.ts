/** AWS ARNs name the Region in their fourth field: arn:<partition>:<service>:<region>:<account>:<resource>. */
export function regionFromArn(arn?: string | null): string | null {
    return arn?.split(':')[3] || null
}
