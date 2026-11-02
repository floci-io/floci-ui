import React from 'react'
import ReactDOM from 'react-dom/client'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import App from './App'
import './index.css'
import '@/components/sodium/styles.css'
import {SodiumPortalProvider} from '@/lib/sodium/portal'
import {Toaster} from '@/components/sodium/ui/toast'
import {TooltipProvider} from '@/components/sodium/ui/tooltip'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            staleTime: 3000,
        },
    },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <div className="sodium h-full">
                <SodiumPortalProvider>
                    <TooltipProvider>
                        <App/>
                    </TooltipProvider>
                    <Toaster/>
                </SodiumPortalProvider>
            </div>
        </QueryClientProvider>
    </React.StrictMode>
)
