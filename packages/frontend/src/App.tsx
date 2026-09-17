import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom'
import {Layout} from '@/components/Layout'
import {SecretsManagerPage} from '@/features/secretsmanager/SecretsManagerPage'
import {CloudExplorerPage} from '@/pages/CloudExplorerPage'
import {CloudConsoleHomePage} from '@/pages/CloudConsoleHomePage'
import {SettingsPage} from '@/pages/SettingsPage'
import {DatabaseDataPage} from '@/pages/DatabaseDataPage'

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
                    <Route path="/settings" element={<Navigate to="/console/aws/settings" replace/>}/>
                    <Route path="/console/:cloud/settings" element={<SettingsPage/>}/>
                    <Route path="*" element={<Navigate to="/console/aws" replace/>}/>
                </Route>
            </Routes>
        </BrowserRouter>
    )
}
