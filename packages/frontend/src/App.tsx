import {BrowserRouter, Navigate, Route, Routes, useLocation, useParams} from 'react-router-dom'
import {Layout} from '@/components/Layout'
import {SecretsManagerPage} from '@/features/secretsmanager/SecretsManagerPage'
import {CloudExplorerPage} from '@/pages/CloudExplorerPage'
import {CloudConsoleHomePage} from '@/pages/CloudConsoleHomePage'
import {DatabaseDataPage} from '@/pages/DatabaseDataPage'
import {SettingsPage} from '@/pages/SettingsPage'
import {isCloudProvider} from '@/lib/cloudProvider'

function LegacySettingsRedirect() {
    const location = useLocation()
    const {cloud} = useParams()
    return (
        <Navigate
            to={{pathname: '/settings', search: location.search, hash: location.hash}}
            state={{...location.state, cloud: isCloudProvider(cloud) ? cloud : 'aws'}}
            replace
        />
    )
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout/>}>
                    <Route index element={<Navigate to="/console/aws" replace/>}/>
                    <Route path="/dashboard" element={<Navigate to="/console/aws" replace/>}/>
                    <Route path="/console" element={<Navigate to="/console/aws" replace/>}/>
                    <Route path="/console/:cloud" element={<CloudConsoleHomePage/>}/>
                    <Route path="/cloud-explorer" element={<Navigate to="/cloud-explorer/aws/storage" replace/>}/>
                    <Route path="/cloud-explorer/:cloud/:service" element={<CloudExplorerPage/>}/>
                    <Route path="/cloud-explorer/:cloud/:service/:resourceId/data" element={<DatabaseDataPage/>}/>
                    <Route path="/secretsmanager" element={<SecretsManagerPage/>}/>
                    <Route path="/console/:cloud/settings" element={<LegacySettingsRedirect/>}/>
                    <Route path="/settings" element={<SettingsPage/>}/>
                    <Route path="*" element={<Navigate to="/console/aws" replace/>}/>
                </Route>
            </Routes>
        </BrowserRouter>
    )
}
