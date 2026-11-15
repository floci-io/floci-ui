import {Hono} from 'hono'
import type {Context} from 'hono'
import type {
    CreateAmiInput,
    CreateNatGatewayInput,
    CreateRouteInput,
    Ec2Tag,
    IpPermissionInput,
    RunInstanceInput,
    VpcWizardInput,
} from '../services/ec2'
import {ec2Service} from '../services/ec2'
import {mapAwsSdkError} from '../adapter-aws/awsErrors'
import {toHttpError, ValidationError} from '../cloud-spi/errors'

type Ec2Service = typeof ec2Service

// An AWS failure keeps its meaning (403 access denied, 404 not found, ...); anything
// else is this route's own check or a malformed body, as before.
function handleError(c: Context, error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const {status, body} = toHttpError(mapAwsSdkError(error) ?? new ValidationError(msg))
    return c.json(body, status)
}

export function createEc2Router(svc: Ec2Service = ec2Service) {
    const app = new Hono()
    app.onError((error, c) => handleError(c, error))

    // Instances
    app.get('/instances', async (c) => {
        return c.json(await svc.listInstances())
    })

    app.get('/instances/:instanceId', async (c) => {
        return c.json(await svc.describeInstance(c.req.param('instanceId')))
    })

    app.post('/instances', async (c) => {
        try {
            const input = await c.req.json<RunInstanceInput>()
            return c.json(await svc.runInstance(input))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/instances/:instanceId/start', async (c) => {
        try {
            await svc.startInstance(c.req.param('instanceId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/instances/:instanceId/stop', async (c) => {
        try {
            await svc.stopInstance(c.req.param('instanceId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/instances/:instanceId/reboot', async (c) => {
        try {
            await svc.rebootInstance(c.req.param('instanceId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/instances/:instanceId/terminate', async (c) => {
        try {
            await svc.terminateInstance(c.req.param('instanceId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.put('/instances/:instanceId/tags', async (c) => {
        try {
            const {toAdd, toRemove} = await c.req.json<{toAdd: Ec2Tag[]; toRemove: string[]}>()
            await svc.updateInstanceTags(c.req.param('instanceId'), toAdd, toRemove)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/instances/:instanceId/image', async (c) => {
        try {
            const body = await c.req.json<Omit<CreateAmiInput, 'instanceId'>>()
            const result = await svc.createImage({...body, instanceId: c.req.param('instanceId')})
            return c.json(result)
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.get('/instances/:instanceId/console', async (c) => {
        try {
            return c.json(await svc.getConsoleOutput(c.req.param('instanceId')))
        } catch (error) {
            return handleError(c, error)
        }
    })

    // AMIs
    app.get('/amis', async (c) => {
        return c.json(await svc.listAmis())
    })

    app.post('/amis/:imageId/deregister', async (c) => {
        try {
            await svc.deregisterImage(c.req.param('imageId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // Key pairs
    app.get('/key-pairs', async (c) => {
        return c.json(await svc.listKeyPairs())
    })

    app.post('/key-pairs', async (c) => {
        try {
            const {name} = await c.req.json<{name: string}>()
            return c.json(await svc.createKeyPair(name))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/key-pairs/:name', async (c) => {
        try {
            await svc.deleteKeyPair(c.req.param('name'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // Security groups
    app.get('/security-groups', async (c) => {
        const vpcId = c.req.query('vpcId')
        return c.json(await svc.listSecurityGroups(vpcId))
    })

    app.post('/security-groups', async (c) => {
        try {
            const {name, description, vpcId} = await c.req.json<{name: string; description: string; vpcId: string}>()
            return c.json(await svc.createSecurityGroup(name, description, vpcId))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/security-groups/:groupId', async (c) => {
        try {
            await svc.deleteSecurityGroup(c.req.param('groupId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/security-groups/:groupId/ingress', async (c) => {
        try {
            const permission = await c.req.json<IpPermissionInput>()
            await svc.authorizeSecurityGroupIngress(c.req.param('groupId'), permission)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/security-groups/:groupId/ingress', async (c) => {
        try {
            const permission = await c.req.json<IpPermissionInput>()
            await svc.revokeSecurityGroupIngress(c.req.param('groupId'), permission)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/security-groups/:groupId/egress', async (c) => {
        try {
            const permission = await c.req.json<IpPermissionInput>()
            await svc.authorizeSecurityGroupEgress(c.req.param('groupId'), permission)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/security-groups/:groupId/egress', async (c) => {
        try {
            const permission = await c.req.json<IpPermissionInput>()
            await svc.revokeSecurityGroupEgress(c.req.param('groupId'), permission)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // Meta
    app.get('/availability-zones', async (c) => {
        return c.json(await svc.listAvailabilityZones())
    })

    app.get('/instance-types', async (c) => {
        return c.json(await svc.listInstanceTypes())
    })

    // VPCs
    app.get('/vpcs', async (c) => {
        return c.json(await svc.listVpcs())
    })

    app.post('/vpcs', async (c) => {
        try {
            const {cidrBlock} = await c.req.json<{cidrBlock: string}>()
            return c.json(await svc.createVpc(cidrBlock))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/vpcs/:vpcId', async (c) => {
        try {
            await svc.deleteVpc(c.req.param('vpcId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.get('/vpcs/:vpcId/attributes', async (c) => {
        try {
            return c.json(await svc.getVpcAttributes(c.req.param('vpcId')))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.put('/vpcs/:vpcId/attributes', async (c) => {
        try {
            const {attribute, value} = await c.req.json<{attribute: 'enableDnsHostnames' | 'enableDnsSupport'; value: boolean}>()
            await svc.modifyVpcAttribute(c.req.param('vpcId'), attribute, value)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // Subnets
    app.get('/subnets', async (c) => {
        const vpcId = c.req.query('vpcId')
        return c.json(await svc.listSubnets(vpcId))
    })

    app.post('/subnets', async (c) => {
        try {
            const {vpcId, cidrBlock, availabilityZone} = await c.req.json<{
                vpcId: string
                cidrBlock: string
                availabilityZone?: string
            }>()
            return c.json(await svc.createSubnet(vpcId, cidrBlock, availabilityZone))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/subnets/:subnetId', async (c) => {
        try {
            await svc.deleteSubnet(c.req.param('subnetId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.put('/subnets/:subnetId/attributes', async (c) => {
        try {
            const {mapPublicIpOnLaunch} = await c.req.json<{mapPublicIpOnLaunch: boolean}>()
            await svc.modifySubnetMapPublicIp(c.req.param('subnetId'), mapPublicIpOnLaunch)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // Internet Gateways
    app.get('/internet-gateways', async (c) => {
        return c.json(await svc.listInternetGateways())
    })

    app.post('/internet-gateways', async (c) => {
        try {
            const body = await c.req.json<{name?: string}>().catch(() => ({} as {name?: string}))
            return c.json(await svc.createInternetGateway(body.name))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/internet-gateways/:igwId/attach', async (c) => {
        try {
            const {vpcId} = await c.req.json<{vpcId: string}>()
            await svc.attachInternetGateway(c.req.param('igwId'), vpcId)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/internet-gateways/:igwId/detach', async (c) => {
        try {
            const {vpcId} = await c.req.json<{vpcId: string}>()
            await svc.detachInternetGateway(c.req.param('igwId'), vpcId)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/internet-gateways/:igwId', async (c) => {
        try {
            await svc.deleteInternetGateway(c.req.param('igwId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // NAT Gateways
    app.get('/nat-gateways', async (c) => {
        const vpcId = c.req.query('vpcId')
        return c.json(await svc.listNatGateways(vpcId))
    })

    app.post('/nat-gateways', async (c) => {
        try {
            const input = await c.req.json<CreateNatGatewayInput>()
            return c.json(await svc.createNatGateway(input))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/nat-gateways/:natId', async (c) => {
        try {
            await svc.deleteNatGateway(c.req.param('natId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // Route Tables
    app.get('/route-tables', async (c) => {
        const vpcId = c.req.query('vpcId')
        return c.json(await svc.listRouteTables(vpcId))
    })

    app.post('/route-tables', async (c) => {
        try {
            const {vpcId, name} = await c.req.json<{vpcId: string; name?: string}>()
            return c.json(await svc.createRouteTable(vpcId, name))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/route-tables/:rtbId', async (c) => {
        try {
            await svc.deleteRouteTable(c.req.param('rtbId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/route-tables/:rtbId/routes', async (c) => {
        try {
            const input = await c.req.json<CreateRouteInput>()
            await svc.createRoute(c.req.param('rtbId'), input)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/route-tables/:rtbId/routes', async (c) => {
        try {
            const cidr = c.req.query('cidr')
            if (!cidr) return handleError(c, new Error('cidr query parameter is required'))
            await svc.deleteRoute(c.req.param('rtbId'), cidr)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/route-tables/:rtbId/associations', async (c) => {
        try {
            const {subnetId} = await c.req.json<{subnetId: string}>()
            const associationId = await svc.associateRouteTable(c.req.param('rtbId'), subnetId)
            return c.json({associationId})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.delete('/route-table-associations/:associationId', async (c) => {
        try {
            await svc.disassociateRouteTable(c.req.param('associationId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // Elastic IPs
    app.get('/elastic-ips', async (c) => {
        return c.json(await svc.listElasticIps())
    })

    app.post('/elastic-ips', async (c) => {
        try {
            const body = await c.req.json<{name?: string}>().catch(() => ({} as {name?: string}))
            return c.json(await svc.allocateElasticIp(body.name))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/elastic-ips/:allocationId/release', async (c) => {
        try {
            await svc.releaseElasticIp(c.req.param('allocationId'))
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/elastic-ips/:allocationId/associate', async (c) => {
        try {
            const {instanceId} = await c.req.json<{instanceId: string}>()
            return c.json(await svc.associateElasticIp(c.req.param('allocationId'), instanceId))
        } catch (error) {
            return handleError(c, error)
        }
    })

    app.post('/elastic-ips/:allocationId/disassociate', async (c) => {
        try {
            const {associationId} = await c.req.json<{associationId: string}>()
            await svc.disassociateElasticIp(associationId)
            return c.json({ok: true})
        } catch (error) {
            return handleError(c, error)
        }
    })

    // VPC Wizard — creates VPC + IGW + subnets + route tables + optional NAT GW in one call
    app.post('/vpc-wizard', async (c) => {
        try {
            const input = await c.req.json<VpcWizardInput>()
            const result = await svc.createVpcWizard(input)
            return c.json(result)
        } catch (error) {
            return handleError(c, error)
        }
    })

    return app
}

export default createEc2Router()
