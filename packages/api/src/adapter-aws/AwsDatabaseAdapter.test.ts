import {describe, expect, test} from 'bun:test'
import {
    CreateDBInstanceCommand,
    CreateDBSnapshotCommand,
    DeleteDBInstanceCommand,
    DescribeDBInstancesCommand,
    DescribeDBSnapshotsCommand,
    DescribeOrderableDBInstanceOptionsCommand,
    ListTagsForResourceCommand,
    ModifyDBInstanceCommand,
    type RDSClient,
} from '@aws-sdk/client-rds'
import {ConflictError, ValidationError} from '../cloud-spi/errors'
import {createRdsService} from '../services/rds'
import {mapAwsSdkError} from './awsErrors'
import {AwsDatabaseAdapter} from './AwsDatabaseAdapter'

type RdsCommand =
    | CreateDBInstanceCommand
    | CreateDBSnapshotCommand
    | DeleteDBInstanceCommand
    | DescribeDBInstancesCommand
    | DescribeDBSnapshotsCommand
    | DescribeOrderableDBInstanceOptionsCommand
    | ListTagsForResourceCommand
    | ModifyDBInstanceCommand

type Responder = (command: RdsCommand) => unknown | Promise<unknown>

function recordingRds(responder: Responder) {
    const commands: RdsCommand[] = []
    const client = {
        async send(command: RdsCommand) {
            commands.push(command)
            return responder(command)
        },
    } as unknown as RDSClient

    return {client, commands}
}

function adapterWith(responder: Responder) {
    const recording = recordingRds(responder)
    return {
        ...recording,
        adapter: new AwsDatabaseAdapter(createRdsService(recording.client), recording.client),
    }
}

function instanceResponse(command: CreateDBInstanceCommand) {
    return {
        DBInstance: {
            DBInstanceIdentifier: command.input.DBInstanceIdentifier,
            Engine: command.input.Engine,
            EngineVersion: command.input.EngineVersion,
            DBInstanceClass: command.input.DBInstanceClass,
            AllocatedStorage: command.input.AllocatedStorage,
            MasterUsername: command.input.MasterUsername,
            DBName: command.input.DBName,
            DBInstanceStatus: 'creating',
        },
    }
}

const validCreateValues = {
    dbInstanceIdentifier: 'orders-db',
    engine: 'postgres',
    masterUserPassword: 'secret-pass',
}

describe('AwsDatabaseAdapter', () => {
    test('keeps list search behavior intact', async () => {
        const {adapter} = adapterWith(async (command) => {
            expect(command).toBeInstanceOf(DescribeDBInstancesCommand)
            return {
                DBInstances: [
                    {DBInstanceIdentifier: 'orders-db', Engine: 'postgres', VpcSecurityGroups: []},
                    {DBInstanceIdentifier: 'users-db', Engine: 'mysql', VpcSecurityGroups: []},
                ],
            }
        })

        const resources = await adapter.list({search: ' ORDERS '})

        expect(resources.map(({id}) => id)).toEqual(['orders-db'])
    })

    test('keeps get 404 behavior intact', async () => {
        const {adapter} = adapterWith(async () => {
            throw Object.assign(new Error('not found'), {$metadata: {httpStatusCode: 404}})
        })

        await expect(adapter.get('missing-db')).resolves.toBeNull()
    })

    test('creates an instance with required values and provider defaults', async () => {
        const {adapter, commands} = adapterWith((command) => {
            expect(command).toBeInstanceOf(CreateDBInstanceCommand)
            return instanceResponse(command as CreateDBInstanceCommand)
        })

        const resource = await adapter.create({values: {
            dbInstanceIdentifier: ' orders-db ',
            engine: 'postgres',
            masterUserPassword: 'secret-pass',
        }})

        const createCommand = commands[0] as CreateDBInstanceCommand
        const {MasterUserPassword, ...nonSensitiveInput} = createCommand.input
        expect(nonSensitiveInput).toEqual({
            DBInstanceIdentifier: 'orders-db',
            Engine: 'postgres',
            DBInstanceClass: 'db.t3.micro',
            AllocatedStorage: 20,
            MasterUsername: 'root',
        })
        expect(MasterUserPassword === validCreateValues.masterUserPassword).toBe(true)
        expect(JSON.stringify(resource).includes(validCreateValues.masterUserPassword)).toBe(false)
        expect(resource).toMatchObject({
            id: 'orders-db',
            name: 'orders-db',
            type: 'db-instance',
            status: 'creating',
            engine: 'postgres',
            instanceClass: 'db.t3.micro',
        })
    })

    test('maps all nine create fields including security groups', async () => {
        const {adapter, commands} = adapterWith((command) => instanceResponse(command as CreateDBInstanceCommand))

        await adapter.create({values: {
            dbInstanceIdentifier: 'orders-db',
            engine: 'mariadb',
            masterUserPassword: 'secret-pass',
            dbInstanceClass: ' db.m6g.large ',
            allocatedStorage: '100',
            masterUsername: ' app_user ',
            dbName: ' orders ',
            engineVersion: ' 10.11 ',
            securityGroupIds: 'sg-12345678, sg-87654321',
        }})

        const createCommand = commands[0] as CreateDBInstanceCommand
        const {MasterUserPassword, ...nonSensitiveInput} = createCommand.input
        expect(nonSensitiveInput).toEqual({
            DBInstanceIdentifier: 'orders-db',
            Engine: 'mariadb',
            DBInstanceClass: 'db.m6g.large',
            AllocatedStorage: 100,
            MasterUsername: 'app_user',
            DBName: 'orders',
            EngineVersion: '10.11',
            VpcSecurityGroupIds: ['sg-12345678', 'sg-87654321'],
        })
        expect(MasterUserPassword === validCreateValues.masterUserPassword).toBe(true)
    })

    test('accepts array of security group ids', async () => {
        const {adapter, commands} = adapterWith((command) => instanceResponse(command as CreateDBInstanceCommand))

        await adapter.create({values: {
            ...validCreateValues,
            securityGroupIds: ['sg-11111111', 'sg-22222222'],
        }})

        const createCommand = commands[0] as CreateDBInstanceCommand
        expect(createCommand.input.VpcSecurityGroupIds).toEqual(['sg-11111111', 'sg-22222222'])
    })

    test('uses defaults for blank values and omits blank database name and engine version', async () => {
        const {adapter, commands} = adapterWith((command) => instanceResponse(command as CreateDBInstanceCommand))

        await adapter.create({values: {
            ...validCreateValues,
            dbInstanceClass: ' ',
            allocatedStorage: '',
            masterUsername: '   ',
            dbName: ' ',
        }})

        const input = (commands[0] as CreateDBInstanceCommand).input
        expect(input.DBInstanceClass).toBe('db.t3.micro')
        expect(input.AllocatedStorage).toBe(20)
        expect(input.MasterUsername).toBe('root')
        expect(input.DBName).toBeUndefined()
        expect(input.EngineVersion).toBeUndefined()
    })

    test('rejects invalid instance identifiers before calling RDS', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))

        for (const dbInstanceIdentifier of ['', 'Orders-db', '1-orders', 'orders--db', 'orders-', 'a'.repeat(64)]) {
            await expect(adapter.create({values: {
                ...validCreateValues,
                dbInstanceIdentifier,
            }})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(commands).toHaveLength(0)
    })

    test('rejects unsupported engines before calling RDS', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))

        for (const engine of ['', 'oracle', 'POSTGRES', 42]) {
            await expect(adapter.create({values: {...validCreateValues, engine}})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(commands).toHaveLength(0)
    })

    test('rejects invalid passwords without exposing them or calling RDS', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))

        for (const masterUserPassword of ['', 'short', 'x'.repeat(129), 42]) {
            let caught: unknown
            try {
                await adapter.create({values: {...validCreateValues, masterUserPassword}})
            } catch (error) {
                caught = error
            }
            expect(caught).toBeInstanceOf(ValidationError)
            const exposesPassword = caught instanceof Error
                && typeof masterUserPassword === 'string'
                && masterUserPassword.length > 0
                && caught.message.includes(masterUserPassword)
            expect(exposesPassword).toBe(false)
        }
        expect(commands).toHaveLength(0)
    })

    test('rejects non-positive, fractional, and non-numeric storage before calling RDS', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))

        for (const allocatedStorage of [0, -1, 1.5, '0', '-1', '1.5', 'twenty', true]) {
            await expect(adapter.create({values: {
                ...validCreateValues,
                allocatedStorage,
            }})).rejects.toBeInstanceOf(ValidationError)
        }
        expect(commands).toHaveLength(0)
    })

    test('rejects storage that exceeds the safe integer range before calling RDS', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))

        await expect(adapter.create({values: {
            ...validCreateValues,
            allocatedStorage: '9'.repeat(400),
        }})).rejects.toBeInstanceOf(ValidationError)
        expect(commands).toHaveLength(0)
    })

    test('leaves provider failures for the shared AWS error mapper', async () => {
        const providerError = Object.assign(new Error('instance already exists'), {
            name: 'DBInstanceAlreadyExistsFault',
            $fault: 'client',
            $metadata: {httpStatusCode: 400},
        })
        const {adapter} = adapterWith(async () => {
            throw providerError
        })

        let caught: unknown
        try {
            await adapter.create({values: validCreateValues})
        } catch (error) {
            caught = error
        }

        expect(caught).toBe(providerError)
        expect(mapAwsSdkError(caught)).toBeInstanceOf(ConflictError)
        expect(caught instanceof Error && caught.message.includes(validCreateValues.masterUserPassword)).toBe(false)
    })

    test('deletes without a final snapshot', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))

        await adapter.delete('orders-db')

        const deleteCommand = commands[0] as DeleteDBInstanceCommand
        expect(deleteCommand).toBeInstanceOf(DeleteDBInstanceCommand)
        expect(deleteCommand.input).toEqual({
            DBInstanceIdentifier: 'orders-db',
            SkipFinalSnapshot: true,
        })
    })

    test('lists and normalizes database snapshots', async () => {
        const {adapter, commands} = adapterWith(async (command) => {
            expect(command).toBeInstanceOf(DescribeDBSnapshotsCommand)
            return {
                DBSnapshots: [{
                    DBSnapshotIdentifier: 'orders-db-snapshot-1',
                    DBInstanceIdentifier: 'orders-db',
                    DBSnapshotArn: 'arn:aws:rds:eu-west-2:000000000000:snapshot:orders-db-snapshot-1',
                    Status: 'available',
                    Engine: 'postgres',
                    EngineVersion: '16.4',
                    AllocatedStorage: 100,
                    SnapshotType: 'manual',
                    SnapshotCreateTime: new Date('2026-08-14T09:30:00.000Z'),
                    Port: 5432,
                    AvailabilityZone: 'eu-west-2a',
                    VpcId: 'vpc-123',
                }],
            }
        })

        const snapshots = await adapter.listDatabaseSnapshots('orders-db')

        expect((commands[0] as DescribeDBSnapshotsCommand).input).toEqual({
            DBInstanceIdentifier: 'orders-db',
            Marker: undefined,
        })
        expect(snapshots).toEqual([{
            id: 'orders-db-snapshot-1',
            name: 'orders-db-snapshot-1',
            instanceIdentifier: 'orders-db',
            status: 'available',
            engine: 'postgres',
            version: '16.4',
            createdAt: '2026-08-14T09:30:00.000Z',
            metadata: {
                arn: 'arn:aws:rds:eu-west-2:000000000000:snapshot:orders-db-snapshot-1',
                allocatedStorage: 100,
                snapshotType: 'manual',
                port: 5432,
                availabilityZone: 'eu-west-2a',
                vpcId: 'vpc-123',
            },
        }])
    })

    test('does not swallow snapshot provider failures', async () => {
        const providerError = Object.assign(new Error('operation unavailable'), {
            name: 'UnsupportedOperation',
            $fault: 'client',
            $metadata: {httpStatusCode: 501},
        })
        const {adapter} = adapterWith(async () => {
            throw providerError
        })

        await expect(adapter.listDatabaseSnapshots()).rejects.toBe(providerError)
    })

    test('creates and normalizes a database snapshot', async () => {
        const {adapter, commands} = adapterWith(async (command) => {
            expect(command).toBeInstanceOf(CreateDBSnapshotCommand)
            return {
                DBSnapshot: {
                    DBSnapshotIdentifier: 'orders-db-snapshot-1',
                    DBInstanceIdentifier: 'orders-db',
                    Status: 'creating',
                    Engine: 'postgres',
                    SnapshotType: 'manual',
                },
            }
        })

        const snapshot = await adapter.createDatabaseSnapshot({
            instanceIdentifier: ' orders-db ',
            snapshotIdentifier: ' orders-db-snapshot-1 ',
        })

        const createCommand = commands[0] as CreateDBSnapshotCommand
        expect(createCommand.input).toEqual({
            DBInstanceIdentifier: 'orders-db',
            DBSnapshotIdentifier: 'orders-db-snapshot-1',
        })
        expect(snapshot).toMatchObject({
            id: 'orders-db-snapshot-1',
            name: 'orders-db-snapshot-1',
            instanceIdentifier: 'orders-db',
            status: 'creating',
            engine: 'postgres',
            metadata: {snapshotType: 'manual'},
        })
    })

    test('rejects missing and invalid snapshot identifiers before calling RDS', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))
        const invalidInputs = [
            {instanceIdentifier: '', snapshotIdentifier: 'orders-db-snapshot-1'},
            {instanceIdentifier: 'orders-db', snapshotIdentifier: ''},
            {instanceIdentifier: 'orders db', snapshotIdentifier: 'orders-db-snapshot-1'},
            {instanceIdentifier: 'orders-db', snapshotIdentifier: '1-orders-snapshot'},
            {instanceIdentifier: 'orders-db', snapshotIdentifier: 'orders--snapshot'},
            {instanceIdentifier: 'orders-db', snapshotIdentifier: 'orders-snapshot-'},
            {instanceIdentifier: 'orders-db', snapshotIdentifier: 'a'.repeat(256)},
        ]

        for (const input of invalidInputs) {
            await expect(adapter.createDatabaseSnapshot(input)).rejects.toBeInstanceOf(ValidationError)
        }
        expect(commands).toHaveLength(0)
    })

    test('lists and deduplicates orderable instance classes', async () => {
        const {adapter, commands} = adapterWith(async (command) => {
            expect(command).toBeInstanceOf(DescribeOrderableDBInstanceOptionsCommand)
            return {
                OrderableDBInstanceOptions: [
                    {DBInstanceClass: 'db.t3.micro', Engine: 'postgres'},
                    {DBInstanceClass: 'db.m8g.large', Engine: 'postgres'},
                    {DBInstanceClass: 'db.t3.micro', Engine: 'postgres'},
                ],
            }
        })

        const classes = await adapter.listDatabaseOrderableInstanceClasses('postgres')

        expect((commands[0] as DescribeOrderableDBInstanceOptionsCommand).input).toEqual({
            Engine: 'postgres',
            Marker: undefined,
        })
        expect(classes).toEqual(['db.t3.micro', 'db.m8g.large'])
    })

    test('updates an instance with supported fields and excludes unsupported fields', async () => {
        const {adapter, commands} = adapterWith(async (command) => {
            expect(command).toBeInstanceOf(ModifyDBInstanceCommand)
            return {
                DBInstance: {
                    DBInstanceIdentifier: 'orders-db',
                    Engine: 'postgres',
                    DBInstanceStatus: 'available',
                    IAMDatabaseAuthenticationEnabled: false,
                    DBSubnetGroup: {DBSubnetGroupName: 'private-db'},
                    VpcSecurityGroups: [{VpcSecurityGroupId: 'sg-1', Status: 'active'}, {VpcSecurityGroupId: 'sg-2', Status: 'active'}],
                    OptionGroupMemberships: [{OptionGroupName: 'default-postgres', Status: 'in-sync'}],
                    AutoMinorVersionUpgrade: true,
                },
            }
        })

        const resource = await adapter.update('orders-db', {values: {
            masterUserPassword: 'new-secret',
            enableIamDatabaseAuthentication: 'false',
            dbSubnetGroupName: 'private-db',
            vpcSecurityGroupIds: 'sg-1, sg-2',
            optionGroupName: 'default-postgres',
            autoMinorVersionUpgrade: 'true',
        }})

        const modifyCommand = commands[0] as ModifyDBInstanceCommand
        expect(modifyCommand.input).toEqual({
            DBInstanceIdentifier: 'orders-db',
            MasterUserPassword: 'new-secret',
            EnableIAMDatabaseAuthentication: false,
            DBSubnetGroupName: 'private-db',
            VpcSecurityGroupIds: ['sg-1', 'sg-2'],
            OptionGroupName: 'default-postgres',
            AutoMinorVersionUpgrade: true,
        })
        expect(modifyCommand.input).not.toHaveProperty('DBInstanceClass')
        expect(modifyCommand.input).not.toHaveProperty('AllocatedStorage')
        expect(modifyCommand.input).not.toHaveProperty('Engine')
        expect(modifyCommand.input).not.toHaveProperty('EngineVersion')
        expect(modifyCommand.input).not.toHaveProperty('ApplyImmediately')

        expect(JSON.stringify(resource)).not.toContain('new-secret')
        expect(resource.metadata.optionGroupName).toBe('default-postgres')
        expect(resource.metadata.autoMinorVersionUpgrade).toBe(true)
        expect(resource.metadata.vpcSecurityGroupIds).toBe('sg-1, sg-2')
    })

    test('accepts boolean literals for boolean update fields', async () => {
        const {adapter, commands} = adapterWith(async (command) => ({
            DBInstance: {
                DBInstanceIdentifier: 'orders-db',
                Engine: 'postgres',
                DBInstanceStatus: 'available',
            },
        }))

        await adapter.update('orders-db', {values: {
            enableIamDatabaseAuthentication: true,
            autoMinorVersionUpgrade: false,
        }})

        const modifyCommand = commands[0] as ModifyDBInstanceCommand
        expect(modifyCommand.input.EnableIAMDatabaseAuthentication).toBe(true)
        expect(modifyCommand.input.AutoMinorVersionUpgrade).toBe(false)
    })

    test('omits blank strings from update and trims CSV', async () => {
        const {adapter, commands} = adapterWith(async () => ({
            DBInstance: {
                DBInstanceIdentifier: 'orders-db',
                Engine: 'postgres',
                DBInstanceStatus: 'available',
            },
        }))

        await adapter.update('orders-db', {values: {
            masterUserPassword: '',
            enableIamDatabaseAuthentication: '',
            dbSubnetGroupName: '  ',
            vpcSecurityGroupIds: '  sg-100 , sg-200  ',
            optionGroupName: '',
            autoMinorVersionUpgrade: '',
        }})

        const modifyCommand = commands[0] as ModifyDBInstanceCommand
        expect(modifyCommand.input).toEqual({
            DBInstanceIdentifier: 'orders-db',
            VpcSecurityGroupIds: ['sg-100', 'sg-200'],
        })
    })

    test('rejects malformed booleans and invalid passwords without echoing password', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))

        await expect(adapter.update('orders-db', {values: {
            enableIamDatabaseAuthentication: 'maybe',
        }})).rejects.toBeInstanceOf(ValidationError)

        await expect(adapter.update('orders-db', {values: {
            masterUserPassword: 'short',
        }})).rejects.toThrow('8 and 128')

        try {
            await adapter.update('orders-db', {values: {masterUserPassword: 'short'}})
        } catch (err) {
            expect(String(err)).not.toContain('short')
        }

        expect(commands).toHaveLength(0)
    })

    test('rejects update requests with zero effective supported changes', async () => {
        const {adapter, commands} = adapterWith(async () => ({}))

        await expect(adapter.update('orders-db', {values: {}})).rejects.toBeInstanceOf(ValidationError)
        await expect(adapter.update('orders-db', {values: {
            masterUserPassword: '',
            dbSubnetGroupName: '',
            unsupportedField: 'value',
        }})).rejects.toBeInstanceOf(ValidationError)

        expect(commands).toHaveLength(0)
    })
})
