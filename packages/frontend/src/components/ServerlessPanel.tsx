import {useEffect, useState} from 'react'
import {ChevronDown, ChevronUp, Loader2, Play, Zap} from 'lucide-react'
import {useMutation} from '@tanstack/react-query'
import {invokeLambdaFunction} from '@/api/services'
import type {LambdaInvokeResult} from '@/api/services'
import type {CloudProvider} from '@/types/cloud'
import type {CloudResource} from '@/types/resource'

interface ServerlessPanelProps {
    cloud: CloudProvider
    resource?: CloudResource
    runtimeReachable: boolean
}

export function ServerlessPanel({cloud, resource, runtimeReachable}: ServerlessPanelProps) {
    const [payload, setPayload] = useState('{\n  \n}')
    const [invokeResult, setInvokeResult] = useState<LambdaInvokeResult | null>(null)
    const [showLog, setShowLog] = useState(false)

    useEffect(() => {
        setPayload('{\n  \n}')
        setInvokeResult(null)
        setShowLog(false)
    }, [resource?.id])

    const canInvoke =
        cloud === 'aws' &&
        resource?.service === 'serverless' &&
        resource?.type === 'lambda' &&
        runtimeReachable

    const invokeMutation = useMutation({
        mutationFn: () => invokeLambdaFunction(resource!.name, payload),
        onSuccess: (result) => {
            setInvokeResult(result)
            setShowLog(false)
        },
    })

    const isInvokeError = Boolean(
        invokeResult?.functionError || (invokeResult && invokeResult.statusCode >= 400),
    )

    if (!resource || resource.service !== 'serverless') {
        return (
            <section className="table-panel">
                <div className="empty compact">
                    <h3>Select a Lambda function</h3>
                    <p>Select a serverless resource to invoke it from Cloud Explorer.</p>
                </div>
            </section>
        )
    }

    return (
        <section className="table-panel">
            <div className="dynamic-stage-header">
                <div>
                    <p className="eyebrow">Serverless Actions</p>
                    <h3>
                        <Zap size={15}/>
                        Invoke Lambda
                    </h3>
                    <p className="muted compact-text">
                        Send a JSON event payload to the selected Lambda function.
                    </p>
                </div>
                <span className={`runtime-state ${canInvoke ? 'ready' : 'pending'}`}>
                    {canInvoke ? 'Ready' : 'Runtime unavailable'}
                </span>
            </div>

            <div className="resource-create-inline">
                <label>
                    <span className="metric-label">Event payload JSON</span>
                    <textarea
                        className="json-editor"
                        value={payload}
                        onChange={(event) => setPayload(event.target.value)}
                        spellCheck={false}
                        placeholder="{}"
                        style={{minHeight: 140}}
                    />
                </label>

                <button
                    className="button primary"
                    type="button"
                    disabled={!canInvoke || invokeMutation.isPending}
                    onClick={() => invokeMutation.mutate()}
                >
                    {invokeMutation.isPending ? <Loader2 size={13}/> : <Play size={13}/>}
                    {invokeMutation.isPending ? 'Invoking' : 'Invoke'}
                </button>

                {invokeMutation.isError && (
                    <p className="error-text compact-text">
                        {invokeMutation.error instanceof Error
                            ? invokeMutation.error.message
                            : 'Invocation failed'}
                    </p>
                )}

                {invokeResult && (
                    <div className="inspector-section">
                        <div className="inspector-section-header">
                            <p className="metric-label">Invocation Result</p>
                            <span className={`runtime-state ${isInvokeError ? 'unavailable' : 'ready'}`}>
                                HTTP {invokeResult.statusCode}
                            </span>
                        </div>

                        {invokeResult.functionError && (
                            <p className="error-text compact-text">
                                {invokeResult.functionError}
                            </p>
                        )}

                        <pre className={`invoke-result ${isInvokeError ? 'error' : 'success'}`}>
                            {tryFormatJson(invokeResult.payload) || '(empty)'}
                        </pre>

                        {invokeResult.logResult && (
                            <div>
                                <button
                                    className="button"
                                    type="button"
                                    onClick={() => setShowLog((open) => !open)}
                                >
                                    Log tail
                                    {showLog ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                                </button>
                                {showLog && (
                                    <div className="log-tail">
                                        {invokeResult.logResult}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    )
}

function tryFormatJson(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
        return raw
    }
}