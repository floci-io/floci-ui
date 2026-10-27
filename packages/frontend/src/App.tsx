import {BrowserRouter, Navigate, Route, Routes, useLocation, useParams} from 'react-router-dom'
import {DefaultCloudRedirect, ScopedCloudRoute} from '@/components/DefaultCloudRedirect'
import {Layout} from '@/components/Layout'
import {CloudExplorerPage} from '@/pages/CloudExplorerPage'
import {CloudConsoleHomePage} from '@/pages/CloudConsoleHomePage'
import {isCloudProvider} from '@/lib/cloudProvider'
import {lazyPanel} from '@/lib/lazyPanel'
import {useDefaultCloud} from '@/lib/useDefaultCloud'

const SecretsManagerPage = lazyPanel(() => import('@/features/secretsmanager/SecretsManagerPage').then((m) => m.SecretsManagerPage))
const DatabaseDataPage = lazyPanel(() => import('@/pages/DatabaseDataPage').then((m) => m.DatabaseDataPage))
const SettingsPage = lazyPanel(() => import('@/pages/SettingsPage').then((m) => m.SettingsPage))

function LegacySettingsRedirect() {
    const location = useLocation()
    const {cloud} = useParams()
    const {cloud: defaultCloud} = useDefaultCloud()
    return (
        <Navigate
            to={{pathname: '/settings', search: location.search, hash: location.hash}}
            state={{...location.state, cloud: isCloudProvider(cloud) ? cloud : defaultCloud}}
            replace
        />
    )
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout/>}>
                    <Route index element={<DefaultCloudRedirect to="console"/>}/>
                    <Route path="/dashboard" element={<DefaultCloudRedirect to="console"/>}/>
                    <Route path="/console" element={<DefaultCloudRedirect to="console"/>}/>
                    <Route path="/console/:cloud" element={<ScopedCloudRoute><CloudConsoleHomePage/></ScopedCloudRoute>}/>
                    <Route path="/cloud-explorer" element={<DefaultCloudRedirect to="cloud-explorer"/>}/>
                    <Route path="/cloud-explorer/:cloud/:service" element={<ScopedCloudRoute><CloudExplorerPage/></ScopedCloudRoute>}/>
                    <Route path="/cloud-explorer/:cloud/:service/:resourceId/data" element={<ScopedCloudRoute><DatabaseDataPage/></ScopedCloudRoute>}/>
                    <Route path="/secretsmanager" element={<ScopedCloudRoute cloud="aws"><SecretsManagerPage/></ScopedCloudRoute>}/>
                    <Route path="/console/:cloud/settings" element={<LegacySettingsRedirect/>}/>
                    <Route path="/settings" element={<SettingsPage/>}/>
                    <Route path="*" element={<DefaultCloudRedirect to="console"/>}/>
                </Route>
            </Routes>
        </BrowserRouter>
    )
}
